-- ==============================================================================
-- Migration: 0003_place_order.sql
-- Description: Dynamic pickup estimation updates & public.place_order transactional function
-- Campus Canteen Pre-Order & Smart Pickup System
-- ==============================================================================

-- 1. UPDATE ESTIMATE_READY_TIME WITH STABLE ERROR CODE PREFIXES
-- Logic is identical to 0001_schema.sql, but adds standard error code prefixes
-- to all RAISE EXCEPTION calls for programmatic handling in Server Actions.

CREATE OR REPLACE FUNCTION public.estimate_ready_time(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": int}
  p_requested_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  estimated_ready_at timestamptz,
  pickup_window_end timestamptz,
  prep_minutes_total integer
)
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_canteen record;
  v_now_ist timestamp;
  v_today_ist date;
  v_current_time_ist time;
  v_req_ist timestamp;
  v_req_time_ist time;
  v_ready_ist timestamp;
  v_ready_time_ist time;
  v_order_prep integer := 0;
  v_max_prep integer := 0;
  v_total_units integer := 0;
  v_candidate_ready_initial timestamptz;
  v_cutoff_time timestamptz;
  v_queued_load integer := 0;
  v_wait_minutes integer := 0;
  v_earliest_ready timestamptz;
  v_final_ready timestamptz;
  v_final_window_end timestamptz;
  v_item record;
  v_menu_item record;
  v_item_id uuid;
  v_qty integer;
BEGIN
  -- 1. Fetch and validate canteen
  SELECT 
    c.id, c.opens_at, c.closes_at, c.last_order_time, 
    c.kitchen_capacity, c.min_lead_minutes, c.hold_minutes, c.is_active
  INTO v_canteen
  FROM public.canteens c
  WHERE c.id = p_canteen_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANTEEN_NOT_FOUND: Canteen % not found', p_canteen_id;
  END IF;

  IF NOT v_canteen.is_active THEN
    RAISE EXCEPTION 'CANTEEN_CLOSED: Canteen is currently inactive';
  END IF;

  -- Time in Asia/Kolkata (stored as wall-clock timestamp)
  v_now_ist := clock_timestamp() AT TIME ZONE 'Asia/Kolkata';
  v_today_ist := v_now_ist::date;
  v_current_time_ist := v_now_ist::time;

  -- Validate current operating hours
  IF v_current_time_ist > v_canteen.last_order_time THEN
    RAISE EXCEPTION 'ORDERS_CLOSED: Orders are closed for today. Last order time was % IST', v_canteen.last_order_time;
  END IF;

  IF v_current_time_ist < v_canteen.opens_at THEN
    RAISE EXCEPTION 'CANTEEN_CLOSED: Canteen is not open yet. Operating hours: % to % IST', v_canteen.opens_at, v_canteen.closes_at;
  END IF;

  -- 2. Validate items array and compute order_prep from active, available menu items
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Order items payload cannot be empty';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item.value->>'menu_item_id')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_INPUT: Invalid quantity % for item %', v_qty, v_item_id;
    END IF;

    SELECT m.prep_minutes, m.is_available, m.is_active
    INTO v_menu_item
    FROM public.menu_items m
    WHERE m.id = v_item_id AND m.canteen_id = p_canteen_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Menu item % does not exist in this canteen', v_item_id;
    END IF;

    IF NOT v_menu_item.is_active OR NOT v_menu_item.is_available THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Menu item % is currently unavailable', v_item_id;
    END IF;

    IF v_menu_item.prep_minutes > v_max_prep THEN
      v_max_prep := v_menu_item.prep_minutes;
    END IF;

    v_total_units := v_total_units + v_qty;
  END LOOP;

  -- order_prep = max(prep_minutes) + 1 minute per extra unit
  v_order_prep := v_max_prep + GREATEST(v_total_units - 1, 0);

  -- 3. Calculate candidate_ready_initial and cutoff time for queued load
  v_candidate_ready_initial := clock_timestamp() + (v_canteen.min_lead_minutes * interval '1 minute') + (v_order_prep * interval '1 minute');

  IF p_requested_at IS NOT NULL THEN
    v_cutoff_time := p_requested_at;
  ELSE
    v_cutoff_time := v_candidate_ready_initial;
  END IF;

  -- 4. Calculate queued_load of active orders in this canteen up to cutoff_time
  SELECT COALESCE(SUM(o.prep_minutes_total), 0)
  INTO v_queued_load
  FROM public.orders o
  WHERE o.canteen_id = p_canteen_id
    AND o.status IN ('PLACED'::public.order_status, 'ACCEPTED'::public.order_status, 'PREPARING'::public.order_status)
    AND o.estimated_ready_at <= v_cutoff_time;

  -- Wait from queue
  v_wait_minutes := ceil(v_queued_load::numeric / v_canteen.kitchen_capacity)::integer;

  -- Earliest possible ready time = now + min_lead + wait + order_prep
  v_earliest_ready := clock_timestamp() + (v_canteen.min_lead_minutes * interval '1 minute') + (v_wait_minutes * interval '1 minute') + (v_order_prep * interval '1 minute');

  -- 5. Determine final ready time based on mode
  IF p_requested_at IS NULL THEN
    -- ASAP Mode: ready is earliest achievable
    v_final_ready := v_earliest_ready;
  ELSE
    -- Scheduled Mode: requested_pickup_at is desired ready time
    v_req_ist := p_requested_at AT TIME ZONE 'Asia/Kolkata';
    v_req_time_ist := v_req_ist::time;

    -- Must be on the same IST day
    IF v_req_ist::date <> v_today_ist THEN
      RAISE EXCEPTION 'INVALID_SCHEDULE: Scheduled pickup time must be on the same day (%)', v_today_ist;
    END IF;

    IF v_req_time_ist < v_canteen.opens_at OR v_req_time_ist > v_canteen.closes_at THEN
      RAISE EXCEPTION 'INVALID_SCHEDULE: Scheduled pickup time % IST is outside canteen operating hours (% to % IST)',
        v_req_time_ist, v_canteen.opens_at, v_canteen.closes_at;
    END IF;

    IF p_requested_at >= v_earliest_ready THEN
      v_final_ready := p_requested_at;
    ELSE
      -- NOTE: The HINT string format 'YYYY-MM-DD"T"HH24:MI:SS' represents wall-clock IST time without offset.
      RAISE EXCEPTION 'SCHEDULE_TOO_EARLY: Requested pickup time % is earlier than earliest achievable time %',
        to_char(v_req_ist, 'HH24:MI:SS'),
        to_char(v_earliest_ready AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS')
        USING HINT = to_char(v_earliest_ready AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SSOF');
    END IF;
  END IF;

  -- Validate ready time does not exceed closing time
  v_ready_ist := v_final_ready AT TIME ZONE 'Asia/Kolkata';
  v_ready_time_ist := v_ready_ist::time;
  IF v_ready_time_ist > v_canteen.closes_at THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Ready time % IST exceeds canteen closing time % IST',
      v_ready_time_ist, v_canteen.closes_at;
  END IF;

  v_final_window_end := v_final_ready + (v_canteen.hold_minutes * interval '1 minute');

  RETURN QUERY SELECT v_final_ready, v_final_window_end, v_order_prep;
END;
$$;


-- 2. PUBLIC.PLACE_ORDER TRANSACTIONAL FUNCTION
-- Encapsulates atomic order placement, inventory deduction, queue estimation,
-- token generation, idempotency handling, and notification insertion.

CREATE OR REPLACE FUNCTION public.place_order(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": integer}
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_requested_at timestamptz DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  MAX_ACTIVE_ORDERS CONSTANT integer := 3;
  MAX_DISTINCT_ITEMS CONSTANT integer := 20;
  MAX_ITEM_QTY CONSTANT integer := 10;
  TOKEN_MAX_ATTEMPTS CONSTANT integer := 10;

  v_user_id uuid;
  v_profile_active boolean;
  v_canteen_id uuid;
  v_canteen_active boolean;
  v_existing_order record;
  v_active_count integer;

  v_agg_items jsonb := '[]'::jsonb;
  v_item record;
  v_menu_item record;
  v_item_id uuid;
  v_qty integer;
  v_distinct_count integer := 0;

  v_est_record record;
  v_total_paise integer := 0;
  v_order_id uuid;
  v_order_code text;
  v_pickup_token text;
  v_token_attempt integer := 0;
  v_token_collision boolean;

  v_err_msg text;
  v_err_hint text;
BEGIN
  -- 1. Authentication & Active Profile Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT p.is_active INTO v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF NOT FOUND OR NOT v_profile_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile is deactivated or does not exist';
  END IF;

  -- 2. Payment Method Validation
  IF p_payment_method <> 'PAY_AT_PICKUP'::public.payment_method THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: Only PAY_AT_PICKUP is supported currently';
  END IF;

  -- 3. Idempotency Key Validation
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 OR length(p_idempotency_key) > 64 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: Valid idempotency key is required';
  END IF;

  -- 4. Preliminary Idempotency Check (fast return if already placed)
  SELECT 
    o.id, o.order_code, o.status, o.total_paise, 
    o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at
  INTO v_existing_order
  FROM public.orders o
  WHERE o.user_id = v_user_id AND o.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing_order.id,
      'order_code', v_existing_order.order_code,
      'status', v_existing_order.status,
      'total_paise', v_existing_order.total_paise,
      'estimated_ready_at', v_existing_order.estimated_ready_at,
      'pickup_window_end', v_existing_order.pickup_window_end,
      'requested_pickup_at', v_existing_order.requested_pickup_at,
      'was_duplicate', true
    );
  END IF;

  -- 5. Items Payload Validation & Aggregation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Order items payload cannot be empty';
  END IF;

  -- Aggregate duplicate menu_item_id entries by summing quantities
  WITH raw_items AS (
    SELECT 
      (elem->>'menu_item_id')::uuid AS item_id,
      (elem->>'quantity')::integer AS qty
    FROM jsonb_array_elements(p_items) AS elem
  ),
  aggregated AS (
    SELECT 
      item_id, 
      SUM(qty)::integer AS total_qty
    FROM raw_items
    GROUP BY item_id
  )
  SELECT 
    jsonb_agg(
      jsonb_build_object('menu_item_id', item_id, 'quantity', total_qty)
      ORDER BY item_id ASC
    ),
    COUNT(*)::integer
  INTO v_agg_items, v_distinct_count
  FROM aggregated;

  IF v_distinct_count = 0 OR v_distinct_count > MAX_DISTINCT_ITEMS THEN
    RAISE EXCEPTION 'INVALID_INPUT: Order must contain between 1 and % distinct items', MAX_DISTINCT_ITEMS;
  END IF;

  -- Verify each aggregated quantity is between 1 and MAX_ITEM_QTY (10)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
    v_qty := (v_item.value->>'quantity')::integer;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > MAX_ITEM_QTY THEN
      RAISE EXCEPTION 'INVALID_INPUT: Item quantity must be between 1 and % (got %)', MAX_ITEM_QTY, v_qty;
    END IF;
  END LOOP;

  -- 6. Canteen Lock
  SELECT c.id, c.is_active
  INTO v_canteen_id, v_canteen_active
  FROM public.canteens c
  WHERE c.id = p_canteen_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANTEEN_NOT_FOUND: Canteen % not found', p_canteen_id;
  END IF;

  IF NOT v_canteen_active THEN
    RAISE EXCEPTION 'CANTEEN_CLOSED: Canteen is currently inactive';
  END IF;

  -- 7. RE-CHECK Idempotency immediately after acquiring the canteen row lock
  SELECT 
    o.id, o.order_code, o.status, o.total_paise, 
    o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at
  INTO v_existing_order
  FROM public.orders o
  WHERE o.user_id = v_user_id AND o.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing_order.id,
      'order_code', v_existing_order.order_code,
      'status', v_existing_order.status,
      'total_paise', v_existing_order.total_paise,
      'estimated_ready_at', v_existing_order.estimated_ready_at,
      'pickup_window_end', v_existing_order.pickup_window_end,
      'requested_pickup_at', v_existing_order.requested_pickup_at,
      'was_duplicate', true
    );
  END IF;

  -- 8. Active Orders Limit Check (after canteen lock)
  SELECT count(*) INTO v_active_count
  FROM public.orders o
  WHERE o.user_id = v_user_id
    AND o.status IN (
      'PLACED'::public.order_status, 
      'ACCEPTED'::public.order_status, 
      'PREPARING'::public.order_status, 
      'READY'::public.order_status
    );

  IF v_active_count >= MAX_ACTIVE_ORDERS THEN
    RAISE EXCEPTION 'TOO_MANY_ACTIVE_ORDERS: You have reached the maximum limit of % active orders', MAX_ACTIVE_ORDERS;
  END IF;

  -- 9. Lock Menu Items FOR UPDATE ordered by id (deadlock prevention)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
    v_item_id := (v_item.value->>'menu_item_id')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;

    SELECT m.id, m.name, m.price_paise, m.is_active, m.is_available, m.stock
    INTO v_menu_item
    FROM public.menu_items m
    WHERE m.id = v_item_id AND m.canteen_id = p_canteen_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Menu item % does not exist in this canteen', v_item_id;
    END IF;

    IF NOT v_menu_item.is_active OR NOT v_menu_item.is_available THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: Menu item "%" is currently unavailable', v_menu_item.name;
    END IF;

    IF v_menu_item.stock IS NOT NULL AND v_menu_item.stock < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: Item "%" only has % available (requested %)',
        v_menu_item.name, v_menu_item.stock, v_qty;
    END IF;

    -- Accumulate total price from locked fresh row values
    v_total_paise := v_total_paise + (v_menu_item.price_paise * v_qty);
  END LOOP;

  -- 10. Call Dynamic Pickup Estimation (preserves HINT and error codes)
  BEGIN
    SELECT * INTO v_est_record
    FROM public.estimate_ready_time(p_canteen_id, v_agg_items, p_requested_at);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS 
        v_err_msg = MESSAGE_TEXT,
        v_err_hint = PG_EXCEPTION_HINT;

      -- Re-raise with the same message and hint preserved
      IF v_err_hint IS NOT NULL AND length(v_err_hint) > 0 THEN
        RAISE EXCEPTION '%', v_err_msg USING HINT = v_err_hint;
      ELSE
        RAISE EXCEPTION '%', v_err_msg;
      END IF;
  END;

  -- 11. Generate Pickup Token (6-digit numeric string)
  -- NOTE: pickup_token is currently globally UNIQUE on public.orders.
  -- In a large-scale system, a partial unique index on active orders may be preferred.
  LOOP
    v_token_attempt := v_token_attempt + 1;
    v_pickup_token := (100000 + floor(random() * 900000)::int)::text;

    SELECT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.pickup_token = v_pickup_token
    ) INTO v_token_collision;

    IF NOT v_token_collision THEN
      EXIT;
    END IF;

    IF v_token_attempt >= TOKEN_MAX_ATTEMPTS THEN
      RAISE EXCEPTION 'TOKEN_GENERATION_FAILED: Failed to allocate unique pickup token after % attempts', TOKEN_MAX_ATTEMPTS;
    END IF;
  END LOOP;

  -- 12. Atomic Sub-Block: Decrement stock, insert order & items, handle unique_violation
  BEGIN
    -- 12.1 Decrement stock for tracked items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      UPDATE public.menu_items
      SET stock = stock - v_qty
      WHERE id = v_item_id AND stock IS NOT NULL;
    END LOOP;

    -- 12.2 Insert Order
    INSERT INTO public.orders (
      user_id,
      canteen_id,
      status,
      payment_method,
      payment_status,
      total_paise,
      pickup_token,
      idempotency_key,
      requested_pickup_at,
      estimated_ready_at,
      pickup_window_end,
      prep_minutes_total,
      placed_at
    ) VALUES (
      v_user_id,
      p_canteen_id,
      'PLACED'::public.order_status,
      p_payment_method,
      'PENDING'::public.payment_status,
      v_total_paise,
      v_pickup_token,
      p_idempotency_key,
      p_requested_at,
      v_est_record.estimated_ready_at,
      v_est_record.pickup_window_end,
      v_est_record.prep_minutes_total,
      clock_timestamp()
    )
    RETURNING id, order_code INTO v_order_id, v_order_code;

    -- 12.3 Insert Order Items with name_snapshot and unit_price_paise
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      SELECT m.name, m.price_paise INTO v_menu_item
      FROM public.menu_items m
      WHERE m.id = v_item_id;

      INSERT INTO public.order_items (
        order_id,
        menu_item_id,
        name_snapshot,
        unit_price_paise,
        quantity
      ) VALUES (
        v_order_id,
        v_item_id,
        v_menu_item.name,
        v_menu_item.price_paise,
        v_qty
      );
    END LOOP;

    -- 12.4 Insert Notification
    INSERT INTO public.notifications (
      user_id,
      order_id,
      title,
      body
    ) VALUES (
      v_user_id,
      v_order_id,
      'Order Placed',
      'Your order has been successfully placed.'
    );

  EXCEPTION
    WHEN unique_violation THEN
      -- In the event of a simultaneous race condition on (user_id, idempotency_key),
      -- this sub-block automatically rolls back the stock decrement.
      -- Fetch and return the previously committed order.
      SELECT 
        o.id, o.order_code, o.status, o.total_paise, 
        o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at
      INTO v_existing_order
      FROM public.orders o
      WHERE o.user_id = v_user_id AND o.idempotency_key = p_idempotency_key;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'order_id', v_existing_order.id,
          'order_code', v_existing_order.order_code,
          'status', v_existing_order.status,
          'total_paise', v_existing_order.total_paise,
          'estimated_ready_at', v_existing_order.estimated_ready_at,
          'pickup_window_end', v_existing_order.pickup_window_end,
          'requested_pickup_at', v_existing_order.requested_pickup_at,
          'was_duplicate', true
        );
      END IF;

      RAISE; -- Re-raise if not idempotency violation
  END;

  -- 13. Return Success Payload
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'status', 'PLACED',
    'total_paise', v_total_paise,
    'estimated_ready_at', v_est_record.estimated_ready_at,
    'pickup_window_end', v_est_record.pickup_window_end,
    'requested_pickup_at', p_requested_at,
    'was_duplicate', false
  );
END;
$$;

-- 3. PERMISSIONS
REVOKE EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz) TO authenticated, service_role;
