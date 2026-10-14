-- Migration 0014: Collection Cutover (Cutover Only)
-- Description:
--   Cutover step for smart counter pickup.
--   1. Replaces transition_order to strictly REFUSE COLLECTED.
--   2. Drops old 5-arg place_order and recreates with p_pickup_for_name (sanitized <= 40 chars, control chars stripped),
--      secret row generation, and NULL pickup_token.
--   3. Drops verify_pickup and clears existing pickup_tokens on orders.
--   4. Updates handle_order_status_notification trigger function to notify on COLLECTED (with manual override notice).

-- 1. Update transition_order: Refuse COLLECTED
CREATE OR REPLACE FUNCTION public.transition_order(
  p_order_id uuid,
  p_to_status public.order_status
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id   uuid;
  v_caller    public.profiles%ROWTYPE;
  v_order     public.orders%ROWTYPE;
BEGIN
  -- 1. Verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Load caller profile
  SELECT *
  INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'staff'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff may transition orders';
  END IF;

  -- Direct transition to COLLECTED is strictly forbidden; collect_order must be used
  IF p_to_status = 'COLLECTED'::public.order_status THEN
    RAISE EXCEPTION 'FORBIDDEN: Orders can only be collected via the collect_order function';
  END IF;

  -- 3. Lock target order row FOR UPDATE
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Order % does not exist', p_order_id;
  END IF;

  -- 4. Enforce canteen boundary for staff
  IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM v_order.canteen_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
  END IF;

  -- 5. Idempotent double-tap / retry check
  IF v_order.status = p_to_status THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'was_noop', true
    );
  END IF;

  -- 6. State Machine Transition Rules
  IF v_order.status = 'PLACED'::public.order_status AND p_to_status IN ('ACCEPTED'::public.order_status, 'REJECTED'::public.order_status) THEN
    -- Allowed
    NULL;
  ELSIF v_order.status = 'ACCEPTED'::public.order_status AND p_to_status = 'PREPARING'::public.order_status THEN
    -- Allowed
    NULL;
  ELSIF v_order.status = 'PREPARING'::public.order_status AND p_to_status = 'READY'::public.order_status THEN
    -- Allowed
    NULL;
  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION: Cannot transition order from % to %', v_order.status, p_to_status;
  END IF;

  -- 7. Execute Transition & Timestamps
  IF p_to_status = 'ACCEPTED'::public.order_status THEN
    UPDATE public.orders
    SET status = p_to_status,
        accepted_at = coalesce(accepted_at, now())
    WHERE id = v_order.id;

  ELSIF p_to_status = 'PREPARING'::public.order_status THEN
    UPDATE public.orders
    SET status = p_to_status,
        preparing_at = coalesce(preparing_at, now())
    WHERE id = v_order.id;

  ELSIF p_to_status = 'READY'::public.order_status THEN
    UPDATE public.orders
    SET status = p_to_status,
        ready_at = coalesce(ready_at, now())
    WHERE id = v_order.id;

  ELSIF p_to_status = 'REJECTED'::public.order_status THEN
    UPDATE public.orders
    SET status = p_to_status,
        rejected_at = coalesce(rejected_at, now())
    WHERE id = v_order.id;

    -- Restore stock on rejection (deadlock-free canonical locking)
    PERFORM id
    FROM public.menu_items
    WHERE id IN (
      SELECT menu_item_id
      FROM public.order_items
      WHERE order_id = v_order.id
    )
    ORDER BY id ASC
    FOR UPDATE;

    UPDATE public.menu_items mi
    SET stock = mi.stock + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id
      AND oi.menu_item_id = mi.id
      AND mi.stock IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', p_to_status,
    'was_noop', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) TO authenticated, service_role;

-- 2. Drop Old 5-Argument place_order and Create New Signature with p_pickup_for_name
DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, public.payment_method, text, timestamptz);

CREATE OR REPLACE FUNCTION public.place_order(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": integer}
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_requested_at timestamptz DEFAULT NULL,
  p_pickup_for_name text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  MAX_ACTIVE_ORDERS CONSTANT integer := 3;
  MAX_DISTINCT_ITEMS CONSTANT integer := 20;
  MAX_ITEM_QTY CONSTANT integer := 10;

  v_user_id uuid;
  v_profile_active boolean;
  v_profile_role public.user_role;
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
  v_secret text;
  v_pickup_for_name text;

  v_err_msg text;
  v_err_hint text;
BEGIN
  -- 1. Authentication & Active Profile Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT p.is_active, p.role INTO v_profile_active, v_profile_role
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF NOT FOUND OR NOT v_profile_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile is deactivated or does not exist';
  END IF;

  IF v_profile_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can place pre-orders';
  END IF;

  -- 2. Payment Method Validation
  IF p_payment_method <> 'PAY_AT_PICKUP'::public.payment_method THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: Only PAY_AT_PICKUP is supported currently';
  END IF;

  -- 3. Idempotency Key Validation
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 OR length(p_idempotency_key) > 64 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: Valid idempotency key is required';
  END IF;

  -- Validate and sanitize pickup designee name (trimmed, max 40 chars, control chars stripped)
  v_pickup_for_name := regexp_replace(trim(coalesce(p_pickup_for_name, '')), '[\x00-\x1F\x7F]', '', 'g');
  IF length(v_pickup_for_name) = 0 THEN
    v_pickup_for_name := NULL;
  ELSIF length(v_pickup_for_name) > 40 THEN
    RAISE EXCEPTION 'INVALID_INPUT: pickup_for_name cannot exceed 40 characters';
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

      IF v_err_hint IS NOT NULL AND length(v_err_hint) > 0 THEN
        RAISE EXCEPTION '%', v_err_msg USING HINT = v_err_hint;
      ELSE
        RAISE EXCEPTION '%', v_err_msg;
      END IF;
  END;

  -- 11. Atomic Sub-Block: Decrement stock, insert order & items, handle unique_violation
  BEGIN
    -- 11.1 Decrement stock for tracked items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      UPDATE public.menu_items
      SET stock = stock - v_qty
      WHERE id = v_item_id AND stock IS NOT NULL;
    END LOOP;

    -- 11.2 Insert Order (with NULL pickup_token and pickup_for_name)
    INSERT INTO public.orders (
      user_id,
      canteen_id,
      status,
      payment_method,
      payment_status,
      total_paise,
      pickup_token,
      pickup_for_name,
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
      NULL,
      v_pickup_for_name,
      p_idempotency_key,
      p_requested_at,
      v_est_record.estimated_ready_at,
      v_est_record.pickup_window_end,
      v_est_record.prep_minutes_total,
      clock_timestamp()
    )
    RETURNING id, order_code INTO v_order_id, v_order_code;

    -- 11.3 Insert Order Pickup Secret (using two gen_random_uuid hex strings)
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_id, v_secret);

    -- 11.4 Insert Order Items with name_snapshot and unit_price_paise
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

    -- 11.5 Insert Notification
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

      RAISE;
  END;

  -- 12. Return Success Payload
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'status', 'PLACED',
    'total_paise', v_total_paise,
    'estimated_ready_at', v_est_record.estimated_ready_at,
    'pickup_window_end', v_est_record.pickup_window_end,
    'prep_minutes_total', v_est_record.prep_minutes_total,
    'requested_pickup_at', p_requested_at,
    'pickup_for_name', v_pickup_for_name,
    'was_duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) TO authenticated, service_role;

-- 3. Drop verify_pickup and Clear pickup_token on orders
DROP FUNCTION IF EXISTS public.verify_pickup(uuid, text);

ALTER TABLE public.orders ALTER COLUMN pickup_token DROP NOT NULL;
UPDATE public.orders SET pickup_token = NULL WHERE pickup_token IS NOT NULL;

-- 4. Update Status Notification Trigger: Add COLLECTED (Keep ACCEPTED, PREPARING, READY, REJECTED)
CREATE OR REPLACE FUNCTION public.handle_order_status_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  -- Only process status modifications
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map new status to PRD Section 13 notification copy
  CASE NEW.status
    WHEN 'ACCEPTED'::public.order_status THEN
      v_title := 'Order Accepted';
      v_body  := 'Your order has been accepted by the canteen.';

    WHEN 'PREPARING'::public.order_status THEN
      v_title := 'Order Preparing';
      v_body  := 'Your order is being prepared.';

    WHEN 'READY'::public.order_status THEN
      v_title := 'Order Ready';
      v_body  := 'Your order is ready for pickup.';

    WHEN 'COLLECTED'::public.order_status THEN
      v_title := 'Order Collected';
      IF NEW.is_manual_override THEN
        v_body := 'Your order ' || NEW.order_code || ' was marked collected manually by canteen staff. If this was not you or your designated representative, please report it immediately.';
      ELSE
        v_body := 'Your order ' || NEW.order_code || ' has been collected. Thank you for ordering!';
      END IF;

    WHEN 'REJECTED'::public.order_status THEN
      v_title := 'Order Rejected';
      v_body  := 'Your order was rejected by the canteen.';

    ELSE
      -- CANCELLED handled by cancel_order
      RETURN NEW;
  END CASE;

  -- Insert notification for the ordering student
  INSERT INTO public.notifications (
    user_id,
    order_id,
    title,
    body
  ) VALUES (
    NEW.user_id,
    NEW.id,
    v_title,
    v_body
  );

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
