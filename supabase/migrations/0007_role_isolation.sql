-- =============================================================================
-- Migration 0007: Defense-in-depth Database Role Isolation
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Procedure: public.place_order (restricts placement to role = 'student')
-- 2. Procedure: public.cancel_order (restricts cancellation to role = 'student')
-- 3. Procedure: public.transition_order (restricts kitchen workflow to role = 'staff')
-- 4. Procedure: public.verify_pickup (restricts counter pickup verification to role = 'staff')
-- 5. Procedure: public.set_item_availability (restricts stock/availability toggle to role = 'staff')
-- 6. Permissions & Grants
-- 7. PostgREST Schema Cache Reload
-- =============================================================================


-- =============================================================================
-- 1. PROCEDURE: public.place_order
-- =============================================================================

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


-- =============================================================================
-- 2. PROCEDURE: public.cancel_order
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  -- Allowed cancellation statuses constant. Mirrored in TypeScript by CANCELLABLE_STATUSES = ['PLACED']
  c_cancellable_statuses CONSTANT public.order_status[] := ARRAY['PLACED'::public.order_status];

  v_user_id        uuid;
  v_profile_role   public.user_role;
  v_profile_active boolean;
  v_order          public.orders%ROWTYPE;
BEGIN
  -- 1. Derive and verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT p.role, p.is_active INTO v_profile_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF NOT FOUND OR NOT v_profile_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile is deactivated or does not exist';
  END IF;

  IF v_profile_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can cancel orders';
  END IF;

  -- 2. Lock target order row FOR UPDATE
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- 3. Verify existence and caller ownership (NOT_FOUND)
  IF NOT FOUND OR v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'NOT_FOUND: Order % not found or not owned by user', p_order_id;
  END IF;

  -- 4. Idempotency Check: Already CANCELLED
  IF v_order.status = 'CANCELLED'::public.order_status THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'was_already_cancelled', true
    );
  END IF;

  -- 5. Status Policy Rule Check (NOT_CANCELLABLE)
  IF NOT (v_order.status = ANY(c_cancellable_statuses)) THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE: Order cannot be cancelled in status %', v_order.status;
  END IF;

  -- 6. Transition Order Status to CANCELLED
  UPDATE public.orders
  SET 
    status = 'CANCELLED'::public.order_status,
    cancelled_at = now()
  WHERE id = v_order.id;

  -- 7. Restore Deducted Stock (Ordered locking avoids concurrent deadlocks)
  -- Step 7a: Lock related menu_items in canonical id order
  PERFORM id
  FROM public.menu_items
  WHERE id IN (
    SELECT menu_item_id
    FROM public.order_items
    WHERE order_id = v_order.id
  )
  ORDER BY id ASC
  FOR UPDATE;

  -- Step 7b: Increment inventory quantities where tracking is active (stock IS NOT NULL)
  UPDATE public.menu_items mi
  SET stock = mi.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.menu_item_id = mi.id
    AND mi.stock IS NOT NULL;

  -- 8. Insert In-App Notification (PRD Section 13 copy)
  INSERT INTO public.notifications (
    user_id,
    order_id,
    title,
    body
  ) VALUES (
    v_user_id,
    v_order.id,
    'Order Cancelled',
    'Your order has been cancelled.'
  );

  -- 9. Return Successful Cancellation Result
  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', 'CANCELLED',
    'was_already_cancelled', false
  );
END;
$$;


-- =============================================================================
-- 3. PROCEDURE: public.transition_order
-- =============================================================================

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
  ELSIF v_order.status = 'READY'::public.order_status AND p_to_status = 'COLLECTED'::public.order_status THEN
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

  ELSIF p_to_status = 'COLLECTED'::public.order_status THEN
    UPDATE public.orders
    SET status = p_to_status,
        collected_at = coalesce(collected_at, now()),
        payment_status = CASE
          WHEN payment_method = 'PAY_AT_PICKUP'::public.payment_method THEN 'PAID'::public.payment_status
          ELSE payment_status
        END
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


-- =============================================================================
-- 4. PROCEDURE: public.verify_pickup
-- =============================================================================

CREATE OR REPLACE FUNCTION public.verify_pickup(
  p_canteen_id uuid,
  p_token text
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id      uuid;
  v_caller       public.profiles%ROWTYPE;
  v_fail_count   integer;
  v_order_rec    record;
  v_items_json   jsonb;
BEGIN
  -- 1. Verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Verify staff role and canteen assignment
  SELECT *
  INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'staff'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff may verify pickup';
  END IF;

  IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM p_canteen_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
  END IF;

  -- 3. Prune ledger attempts older than 24 hours
  DELETE FROM public.pickup_verify_attempts
  WHERE attempted_at < now() - interval '1 day';

  -- 4. Check Rate Limit (10+ failures in last 5 minutes)
  SELECT count(*)
  INTO v_fail_count
  FROM public.pickup_verify_attempts
  WHERE user_id = v_user_id
    AND attempted_at >= now() - interval '5 minutes';

  IF v_fail_count >= 10 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Too many failed pickup verification attempts. Please wait 5 minutes before trying again.';
  END IF;

  -- 5. Query matching READY order in the specified canteen
  SELECT 
    o.id,
    o.order_code,
    o.status,
    o.total_paise,
    o.payment_method,
    o.payment_status,
    p.full_name AS student_name
  INTO v_order_rec
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.user_id
  WHERE o.canteen_id = p_canteen_id
    AND o.pickup_token = p_token
    AND o.status = 'READY'::public.order_status;

  -- 6. Handle Miss: Log failure and return { found: false }
  IF NOT FOUND THEN
    INSERT INTO public.pickup_verify_attempts (user_id, canteen_id)
    VALUES (v_user_id, p_canteen_id);

    RETURN jsonb_build_object('found', false);
  END IF;

  -- 7. Handle Hit: Aggregate line items
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'name_snapshot', oi.name_snapshot,
      'quantity', oi.quantity,
      'unit_price_paise', oi.unit_price_paise
    )
  ) INTO v_items_json
  FROM public.order_items oi
  WHERE oi.order_id = v_order_rec.id;

  RETURN jsonb_build_object(
    'found', true,
    'order_id', v_order_rec.id,
    'order_code', v_order_rec.order_code,
    'status', v_order_rec.status,
    'total_paise', v_order_rec.total_paise,
    'payment_method', v_order_rec.payment_method,
    'payment_status', v_order_rec.payment_status,
    'student_name', coalesce(v_order_rec.student_name, 'Student'),
    'items', coalesce(v_items_json, '[]'::jsonb)
  );
END;
$$;


-- =============================================================================
-- 5. PROCEDURE: public.set_item_availability
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_item_availability(
  p_item_id uuid,
  p_is_available boolean
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id   uuid;
  v_caller    public.profiles%ROWTYPE;
  v_item      public.menu_items%ROWTYPE;
BEGIN
  -- 1. Verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Verify staff profile
  SELECT *
  INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'staff'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff may update menu item availability';
  END IF;

  -- 3. Lock target menu item
  SELECT *
  INTO v_item
  FROM public.menu_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Menu item % not found', p_item_id;
  END IF;

  -- 4. Enforce canteen boundary for staff
  IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM v_item.canteen_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this item''s canteen';
  END IF;

  -- 5. Update availability
  UPDATE public.menu_items
  SET is_available = p_is_available,
      updated_at = now()
  WHERE id = v_item.id;

  RETURN jsonb_build_object(
    'item_id', v_item.id,
    'is_available', p_is_available
  );
END;
$$;


-- =============================================================================
-- 6. PERMISSIONS & GRANTS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.verify_pickup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_item_availability(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_availability(uuid, boolean) TO authenticated, service_role;


-- =============================================================================
-- 7. RELOAD SCHEMA CACHE
-- =============================================================================

NOTIFY pgrst, 'reload schema';
