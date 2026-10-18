-- =============================================================================
-- Migration 0017: Order Expiration, No-Show Lifecycle, Strikes & Reconciliation
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Table: public.student_strike_resets (Audited strike clearing per student)
-- 2. Index: idx_orders_status_ready_at (Performance index for sweep routine)
-- 3. Helper: public.is_order_expired(p_order_id uuid)
-- 4. Lazy Expiry in Student RPC: public.get_pickup_code(p_order_id uuid)
-- 5. Lazy Expiry in Staff Preview: public.preview_collection(...)
-- 6. Lazy Expiry & Late Handover in Staff Collection: public.collect_order(...)
-- 7. Canteen Sweep Routine: public.mark_no_shows(p_canteen_id uuid)
-- 8. Student Account Status RPC: public.get_my_account_status()
-- 9. Strike Enforcement in Pre-Order: public.place_order(...)
-- 10. Admin Strikes Management: public.admin_list_student_strikes() & admin_clear_student_strikes(...)
-- 11. Admin Daily Reconciliation: public.get_daily_reconciliation(...)
-- 12. Canteen Settings Validation Update: public.admin_update_canteen_settings(...)
-- 13. Order Notification Trigger Update: public.handle_order_status_notification()
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TABLE: public.student_strike_resets
-- =============================================================================
-- Tracks administrative strike resets without rewriting historical order records.
-- Only NO_SHOW orders occurring strictly after cleared_at count toward active strikes.

CREATE TABLE IF NOT EXISTS public.student_strike_resets (
  student_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text
);

ALTER TABLE public.student_strike_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_strike_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.student_strike_resets TO service_role;

-- =============================================================================
-- 2. PERFORMANCE INDEX FOR SWEEP ROUTINE
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_orders_status_ready_at 
  ON public.orders(status, ready_at);

-- =============================================================================
-- 3. HELPER FUNCTION: public.is_order_expired
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_order_expired(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_hold_minutes integer;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT o.status, o.ready_at, c.hold_minutes
  INTO v_order
  FROM public.orders o
  JOIN public.canteens c ON c.id = o.canteen_id
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_order.ready_at IS NULL THEN
    RETURN false;
  END IF;

  v_hold_minutes := coalesce(v_order.hold_minutes, 15);
  RETURN (clock_timestamp() > (v_order.ready_at + (v_hold_minutes * interval '1 minute')));
END;
$$;

REVOKE ALL ON FUNCTION public.is_order_expired(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_order_expired(uuid) TO authenticated, service_role;

-- =============================================================================
-- 4. STUDENT RPC: public.get_pickup_code (with Row Locking & Lazy Expiry)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_pickup_code(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_order record;
  v_code text;
  v_pin text;
  v_seconds_remaining integer;
  v_hold_minutes integer;
  v_is_expired boolean := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile is deactivated or does not exist';
  END IF;

  IF v_profile.role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can retrieve pickup codes';
  END IF;

  -- Lock order row FOR UPDATE to prevent race with staff collection or sweep
  SELECT o.id, o.order_code, o.user_id, o.status, o.pickup_for_name, o.ready_at, o.canteen_id
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  IF v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only view pickup codes for your own orders';
  END IF;

  -- If status is already NO_SHOW, return PICKUP_EXPIRED immediately
  IF v_order.status = 'NO_SHOW'::public.order_status THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PICKUP_EXPIRED'
    );
  END IF;

  IF v_order.status != 'READY'::public.order_status THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ORDER_NOT_READY'
    );
  END IF;

  -- Check if READY order is expired based on actual ready_at + canteen hold_minutes
  SELECT c.hold_minutes INTO v_hold_minutes
  FROM public.canteens c
  WHERE c.id = v_order.canteen_id;

  v_hold_minutes := coalesce(v_hold_minutes, 15);
  v_is_expired := (v_order.ready_at IS NOT NULL AND clock_timestamp() > (v_order.ready_at + (v_hold_minutes * interval '1 minute')));

  IF v_is_expired THEN
    -- Lazy enforcement: move READY order to NO_SHOW with guarded status update
    UPDATE public.orders
    SET status = 'NO_SHOW'::public.order_status
    WHERE id = v_order.id
      AND status = 'READY'::public.order_status;

    IF FOUND THEN
      INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, details)
      VALUES (
        v_user_id,
        'ORDER_NO_SHOW_LAZY',
        'order',
        v_order.id::text,
        jsonb_build_object(
          'order_code', v_order.order_code,
          'canteen_id', v_order.canteen_id,
          'caller_rpc', 'get_pickup_code',
          'ready_at', v_order.ready_at,
          'hold_minutes', v_hold_minutes
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PICKUP_EXPIRED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_pickup_secrets WHERE order_id = p_order_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PICKUP_UNAVAILABLE'
    );
  END IF;

  v_code := public.internal_get_pickup_code(p_order_id, 0);
  v_pin := public.internal_get_pickup_pin(p_order_id);

  IF v_code IS NULL OR v_pin IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PICKUP_UNAVAILABLE'
    );
  END IF;

  v_seconds_remaining := 60 - (floor(extract(epoch from clock_timestamp()))::bigint % 60);

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'code', v_code,
    'seconds_remaining', v_seconds_remaining,
    'pin', v_pin,
    'pickup_for_name', v_order.pickup_for_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pickup_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pickup_code(uuid) TO authenticated;

-- =============================================================================
-- 5. STAFF PREVIEW RPC: public.preview_collection (with Locking & Lazy Expiry)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.preview_collection(
  p_canteen_id uuid DEFAULT NULL,
  p_order_ref text DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_pin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff_id uuid;
  v_staff_role public.user_role;
  v_staff_active boolean;
  v_staff_canteen uuid;
  v_order record;
  v_secret_row record;
  v_student record;
  v_items jsonb;
  v_total_items integer;
  v_is_amber boolean;
  v_expected_code_curr text;
  v_expected_code_prev text;
  v_expected_pin text;
  v_staff_failures integer;
  v_order_failures integer;
  v_code_valid boolean := false;
  v_pin_valid boolean := false;
  v_is_pin_locked boolean := false;
  v_hold_minutes integer;
  v_is_expired boolean := false;
BEGIN
  v_staff_id := auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active, canteen_id INTO v_staff_role, v_staff_active, v_staff_canteen
  FROM public.profiles
  WHERE id = v_staff_id;

  IF NOT FOUND OR NOT v_staff_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
  END IF;

  IF v_staff_role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff or admin role required';
  END IF;

  IF p_order_ref IS NULL OR btrim(p_order_ref) = '' THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- Lock order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE (id::text = p_order_ref OR upper(order_code) = upper(p_order_ref))
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- For staff compare order's canteen to caller's OWN profile canteen_id with IS DISTINCT FROM.
  IF v_staff_role = 'staff'::public.user_role THEN
    IF v_staff_canteen IS NULL OR v_staff_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'NOT_FOUND: Order not found';
    END IF;
  END IF;

  -- If status is already NO_SHOW, return PICKUP_EXPIRED
  IF v_order.status = 'NO_SHOW'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_EXPIRED', 'status', 'NO_SHOW');
  END IF;

  -- Check if order is READY
  IF v_order.status != 'READY'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
  END IF;

  -- Check actual hold window expiration
  SELECT c.hold_minutes INTO v_hold_minutes
  FROM public.canteens c
  WHERE c.id = v_order.canteen_id;

  v_hold_minutes := coalesce(v_hold_minutes, 15);
  v_is_expired := (v_order.ready_at IS NOT NULL AND clock_timestamp() > (v_order.ready_at + (v_hold_minutes * interval '1 minute')));

  IF v_is_expired THEN
    -- Lazy enforcement: move READY order to NO_SHOW with guarded status update
    UPDATE public.orders
    SET status = 'NO_SHOW'::public.order_status
    WHERE id = v_order.id
      AND status = 'READY'::public.order_status;

    IF FOUND THEN
      INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, details)
      VALUES (
        v_staff_id,
        'ORDER_NO_SHOW_LAZY',
        'order',
        v_order.id::text,
        jsonb_build_object(
          'order_code', v_order.order_code,
          'canteen_id', v_order.canteen_id,
          'caller_rpc', 'preview_collection',
          'ready_at', v_order.ready_at,
          'hold_minutes', v_hold_minutes
        )
      );
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_EXPIRED', 'status', 'NO_SHOW');
  END IF;

  -- Read PIN counter & lock status from secure order_pickup_secrets
  SELECT * INTO v_secret_row
  FROM public.order_pickup_secrets
  WHERE order_id = v_order.id;

  IF v_secret_row.order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PICKUP_SECRET');
  END IF;

  v_is_pin_locked := coalesce(v_secret_row.is_pin_locked, false);

  -- Rate limit check per staff (10 failures in 5 min) and per order (10 failures in 10 min)
  SELECT count(*) INTO v_staff_failures
  FROM public.pickup_collect_attempts
  WHERE staff_id = v_staff_id
    AND outcome != 'SUCCESS'
    AND attempted_at > now() - interval '5 minutes';

  IF v_staff_failures >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED_STAFF');
  END IF;

  SELECT count(*) INTO v_order_failures
  FROM public.pickup_collect_attempts
  WHERE order_id = v_order.id
    AND outcome != 'SUCCESS'
    AND attempted_at > now() - interval '10 minutes';

  IF v_order_failures >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED_ORDER');
  END IF;

  SELECT coalesce(sum(quantity), 0) INTO v_total_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  -- Amber rules: > 5 total items or > 50000 paise (500 INR)
  v_is_amber := (v_total_items > 5 OR v_order.total_paise > 50000);

  IF p_code IS NOT NULL AND btrim(p_code) != '' THEN
    v_expected_code_curr := public.internal_get_pickup_code(v_order.id, 0);
    v_expected_code_prev := public.internal_get_pickup_code(v_order.id, -1);
    IF p_code = v_expected_code_curr OR p_code = v_expected_code_prev THEN
      v_code_valid := true;
    END IF;
  END IF;

  IF p_pin IS NOT NULL AND btrim(p_pin) != '' THEN
    v_expected_pin := public.internal_get_pickup_pin(v_order.id);
    IF p_pin = v_expected_pin THEN
      v_pin_valid := true;
    END IF;
  END IF;

  IF v_is_amber THEN
    IF v_is_pin_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;

    IF NOT v_code_valid OR NOT v_pin_valid THEN
      IF p_pin IS NOT NULL AND btrim(p_pin) != '' AND NOT v_pin_valid THEN
        UPDATE public.order_pickup_secrets
        SET failed_pin_attempts = failed_pin_attempts + 1,
            is_pin_locked = CASE WHEN failed_pin_attempts + 1 >= 3 THEN true ELSE false END
        WHERE order_id = v_order.id;

        INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
        VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PREVIEW_AMBER', 'WRONG_PIN');
      ELSIF p_code IS NOT NULL AND btrim(p_code) != '' AND NOT v_code_valid THEN
        INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
        VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PREVIEW_AMBER', 'INVALID_CODE');
      END IF;

      RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_BOTH');
    END IF;
  ELSE
    IF NOT v_code_valid AND NOT v_pin_valid THEN
      INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
      VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PREVIEW', 'INVALID_CREDENTIALS');

      IF p_pin IS NOT NULL AND btrim(p_pin) != '' AND NOT v_pin_valid THEN
        UPDATE public.order_pickup_secrets
        SET failed_pin_attempts = failed_pin_attempts + 1,
            is_pin_locked = CASE WHEN failed_pin_attempts + 1 >= 3 THEN true ELSE false END
        WHERE order_id = v_order.id;
      END IF;

      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
    END IF;

    IF NOT v_code_valid AND v_pin_valid AND v_is_pin_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;
  END IF;

  SELECT p.full_name, p.college_id INTO v_student
  FROM public.profiles p
  WHERE p.id = v_order.user_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'name', oi.name_snapshot,
      'quantity', oi.quantity,
      'unit_price_paise', oi.unit_price_paise
    )
  ) INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  IF v_code_valid THEN
    INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
    VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PREVIEW', 'SUCCESS');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'first_name', split_part(coalesce(v_student.full_name, 'Student'), ' ', 1),
    'college_id_last4', right(coalesce(v_student.college_id, '0000'), 4),
    'pickup_for_name', v_order.pickup_for_name,
    'total_paise', v_order.total_paise,
    'total_items', v_total_items,
    'is_amber', v_is_amber,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_collection(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_collection(uuid, text, text, text) TO authenticated;

-- =============================================================================
-- 6. STAFF COLLECTION RPC: public.collect_order (with Late Handover & Expiry)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.collect_order(
  p_canteen_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_collected_with text DEFAULT NULL,
  p_method text DEFAULT 'SCAN',
  p_code text DEFAULT NULL,
  p_pin text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff_id uuid;
  v_staff_role public.user_role;
  v_staff_active boolean;
  v_staff_canteen uuid;
  v_order record;
  v_secret_row record;
  v_total_items integer;
  v_is_amber boolean;
  v_expected_code_curr text;
  v_expected_code_prev text;
  v_expected_pin text;
  v_code_valid boolean := false;
  v_pin_valid boolean := false;
  v_is_pin_locked boolean := false;
  v_manual_count integer;
  v_staff_failures integer;
  v_order_failures integer;
  v_collected_at timestamptz;
  v_hold_minutes integer;
  v_is_expired boolean := false;
  v_expiry_time timestamptz;
BEGIN
  v_staff_id := auth.uid();
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active, canteen_id INTO v_staff_role, v_staff_active, v_staff_canteen
  FROM public.profiles
  WHERE id = v_staff_id;

  IF NOT FOUND OR NOT v_staff_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
  END IF;

  IF v_staff_role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff or admin role required';
  END IF;

  IF p_collected_with IS NULL OR p_collected_with NOT IN ('CASH', 'UPI') THEN
    RAISE EXCEPTION 'INVALID_INPUT: collected_with must be CASH or UPI';
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('SCAN', 'PIN', 'MANUAL') THEN
    RAISE EXCEPTION 'INVALID_INPUT: method must be SCAN, PIN, or MANUAL';
  END IF;

  -- Lock order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- For staff compare order's canteen to caller's OWN profile canteen_id with IS DISTINCT FROM.
  IF v_staff_role = 'staff'::public.user_role THEN
    IF v_staff_canteen IS NULL OR v_staff_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'NOT_FOUND: Order not found';
    END IF;
  END IF;

  IF v_order.status = 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_COLLECTED');
  END IF;

  -- Determine hold window expiry
  SELECT c.hold_minutes INTO v_hold_minutes
  FROM public.canteens c
  WHERE c.id = v_order.canteen_id;

  v_hold_minutes := coalesce(v_hold_minutes, 15);
  v_expiry_time := v_order.ready_at + (v_hold_minutes * interval '1 minute');
  v_is_expired := (v_order.ready_at IS NOT NULL AND clock_timestamp() > v_expiry_time);

  -- Handle expired order or existing NO_SHOW status
  IF v_is_expired OR v_order.status = 'NO_SHOW'::public.order_status THEN
    IF p_method IN ('SCAN', 'PIN') THEN
      -- If order is still marked READY, transition lazily to NO_SHOW with guarded lock
      IF v_order.status = 'READY'::public.order_status THEN
        UPDATE public.orders
        SET status = 'NO_SHOW'::public.order_status
        WHERE id = v_order.id
          AND status = 'READY'::public.order_status;

        IF FOUND THEN
          INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, details)
          VALUES (
            v_staff_id,
            'ORDER_NO_SHOW_LAZY',
            'order',
            v_order.id::text,
            jsonb_build_object(
              'order_code', v_order.order_code,
              'caller_rpc', 'collect_order',
              'attempted_method', p_method
            )
          );
        END IF;
      END IF;

      RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_EXPIRED');

    ELSIF p_method = 'MANUAL' THEN
      -- Late Handover Policy: Allowed while order is READY-but-expired or NO_SHOW for up to 6 hours after expiry
      IF v_expiry_time IS NULL OR clock_timestamp() > (v_expiry_time + interval '6 hours') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PICKUP_EXPIRED');
      END IF;

      IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MANUAL_REASON_REQUIRED');
      END IF;

      -- Staff manual limit check: 10 per staff per 24 hours
      SELECT count(*) INTO v_manual_count
      FROM public.orders
      WHERE collected_by = v_staff_id
        AND is_manual_override = true
        AND collected_at > now() - interval '24 hours';

      IF v_manual_count >= 10 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MANUAL_LIMIT');
      END IF;

      v_collected_at := clock_timestamp();

      -- Guarded transition: only from READY or NO_SHOW
      UPDATE public.orders
      SET status = 'COLLECTED'::public.order_status,
          collection_method = 'MANUAL'::public.collection_method_enum,
          collected_with = p_collected_with::public.collected_with_enum,
          collected_by = v_staff_id,
          collected_at = v_collected_at,
          payment_status = 'PAID'::public.payment_status,
          is_manual_override = true,
          manual_override_reason = btrim(p_reason)
      WHERE id = v_order.id
        AND status IN ('READY'::public.order_status, 'NO_SHOW'::public.order_status);

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
      END IF;

      INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
      VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'MANUAL', 'SUCCESS');

      -- Flagged audit log for late handover
      INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, details)
      VALUES (
        v_staff_id,
        'ORDER_COLLECTED_LATE',
        'order',
        v_order.id::text,
        jsonb_build_object(
          'order_code', v_order.order_code,
          'collection_method', 'MANUAL',
          'collected_with', p_collected_with,
          'total_paise', v_order.total_paise,
          'is_late_handover', true,
          'previous_status', v_order.status,
          'manual_override_reason', btrim(p_reason),
          'expiry_time', v_expiry_time
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order.id,
        'order_code', v_order.order_code,
        'status', 'COLLECTED',
        'collected_at', v_collected_at,
        'is_late_handover', true
      );
    END IF;
  END IF;

  -- For non-expired orders, status must strictly be READY
  IF v_order.status != 'READY'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
  END IF;

  -- Lock and read secrets row
  SELECT * INTO v_secret_row
  FROM public.order_pickup_secrets
  WHERE order_id = v_order.id
  FOR UPDATE;

  IF p_method IN ('SCAN', 'PIN') AND v_secret_row.order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PICKUP_SECRET');
  END IF;

  v_is_pin_locked := coalesce(v_secret_row.is_pin_locked, false);

  -- Rate limit checks
  SELECT count(*) INTO v_staff_failures
  FROM public.pickup_collect_attempts
  WHERE staff_id = v_staff_id
    AND outcome != 'SUCCESS'
    AND attempted_at > now() - interval '5 minutes';

  IF v_staff_failures >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED_STAFF');
  END IF;

  SELECT count(*) INTO v_order_failures
  FROM public.pickup_collect_attempts
  WHERE order_id = v_order.id
    AND outcome != 'SUCCESS'
    AND attempted_at > now() - interval '10 minutes';

  IF v_order_failures >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED_ORDER');
  END IF;

  SELECT coalesce(sum(quantity), 0) INTO v_total_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  v_is_amber := (v_total_items > 5 OR v_order.total_paise > 50000);

  IF p_method = 'MANUAL' THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MANUAL_REASON_REQUIRED');
    END IF;

    SELECT count(*) INTO v_manual_count
    FROM public.orders
    WHERE collected_by = v_staff_id
      AND is_manual_override = true
      AND collected_at > now() - interval '24 hours';

    IF v_manual_count >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MANUAL_LIMIT');
    END IF;

  ELSIF p_method = 'PIN' THEN
    IF v_is_amber THEN
      IF v_is_pin_locked THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_BOTH');
    END IF;

    IF v_is_pin_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;

    v_expected_pin := public.internal_get_pickup_pin(v_order.id);
    IF p_pin IS NULL OR v_expected_pin IS NULL OR p_pin IS DISTINCT FROM v_expected_pin THEN
      INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
      VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PIN', 'WRONG_PIN');

      UPDATE public.order_pickup_secrets
      SET failed_pin_attempts = failed_pin_attempts + 1,
          is_pin_locked = CASE WHEN failed_pin_attempts + 1 >= 3 THEN true ELSE false END
      WHERE order_id = v_order.id;

      RETURN jsonb_build_object('ok', false, 'error', 'WRONG_PIN');
    END IF;

  ELSIF p_method = 'SCAN' THEN
    IF p_code IS NOT NULL AND btrim(p_code) != '' THEN
      v_expected_code_curr := public.internal_get_pickup_code(v_order.id, 0);
      v_expected_code_prev := public.internal_get_pickup_code(v_order.id, -1);
      IF p_code = v_expected_code_curr OR p_code = v_expected_code_prev THEN
        v_code_valid := true;
      END IF;
    END IF;

    IF NOT v_code_valid THEN
      IF EXISTS (
        SELECT 1
        FROM public.pickup_collect_attempts
        WHERE staff_id = v_staff_id
          AND order_id = v_order.id
          AND method = 'PREVIEW'
          AND outcome = 'SUCCESS'
          AND attempted_at >= now() - interval '90 seconds'
      ) THEN
        v_code_valid := true;
      END IF;
    END IF;

    IF p_pin IS NOT NULL AND btrim(p_pin) != '' THEN
      v_expected_pin := public.internal_get_pickup_pin(v_order.id);
      IF p_pin = v_expected_pin THEN
        v_pin_valid := true;
      END IF;
    END IF;

    IF v_is_amber THEN
      IF v_is_pin_locked THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
      END IF;

      IF NOT v_code_valid OR NOT v_pin_valid THEN
        IF p_pin IS NOT NULL AND btrim(p_pin) != '' AND NOT v_pin_valid THEN
          UPDATE public.order_pickup_secrets
          SET failed_pin_attempts = failed_pin_attempts + 1,
              is_pin_locked = CASE WHEN failed_pin_attempts + 1 >= 3 THEN true ELSE false END
          WHERE order_id = v_order.id;

          INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
          VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'SCAN_AMBER', 'WRONG_PIN');
        ELSIF p_code IS NOT NULL AND btrim(p_code) != '' AND NOT v_code_valid THEN
          INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
          VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'SCAN_AMBER', 'INVALID_CODE');
        END IF;

        RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_BOTH');
      END IF;
    ELSE
      IF NOT v_code_valid THEN
        INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
        VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'SCAN', 'INVALID_CODE');
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
      END IF;
    END IF;
  END IF;

  v_collected_at := clock_timestamp();

  UPDATE public.orders
  SET status = 'COLLECTED'::public.order_status,
      collection_method = p_method::public.collection_method_enum,
      collected_with = p_collected_with::public.collected_with_enum,
      collected_by = v_staff_id,
      collected_at = v_collected_at,
      payment_status = 'PAID'::public.payment_status,
      is_manual_override = (p_method = 'MANUAL'),
      manual_override_reason = CASE WHEN p_method = 'MANUAL' THEN btrim(p_reason) ELSE NULL END
  WHERE id = v_order.id
    AND status = 'READY'::public.order_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
  END IF;

  INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
  VALUES (v_staff_id, v_order.id, v_order.canteen_id, p_method, 'SUCCESS');

  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_staff_id,
    'ORDER_COLLECTED',
    'order',
    v_order.id::text,
    jsonb_build_object(
      'order_code', v_order.order_code,
      'collection_method', p_method,
      'collected_with', p_collected_with,
      'total_paise', v_order.total_paise,
      'is_manual_override', (p_method = 'MANUAL'),
      'manual_override_reason', CASE WHEN p_method = 'MANUAL' THEN btrim(p_reason) ELSE NULL END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', 'COLLECTED',
    'collected_at', v_collected_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.collect_order(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_order(uuid, uuid, text, text, text, text, text) TO authenticated;

-- =============================================================================
-- 7. CANTEEN SWEEP ROUTINE: public.mark_no_shows(p_canteen_id uuid)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_no_shows(p_canteen_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role public.user_role;
  v_caller_active boolean;
  v_caller_canteen uuid;
  v_order_ids uuid[];
  v_count integer := 0;
BEGIN
  v_caller_id := auth.uid();

  -- Support execution from internal background / pg_cron (executing as postgres / service role)
  IF v_caller_id IS NULL THEN
    IF current_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
    END IF;
  ELSE
    SELECT role, is_active, canteen_id INTO v_caller_role, v_caller_active, v_caller_canteen
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller_active THEN
      RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
    END IF;

    IF v_caller_role = 'staff'::public.user_role THEN
      IF v_caller_canteen IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff has no assigned canteen';
      END IF;
      IF p_canteen_id IS NOT NULL AND p_canteen_id IS DISTINCT FROM v_caller_canteen THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff can only sweep their assigned canteen';
      END IF;
      p_canteen_id := v_caller_canteen;
    ELSIF v_caller_role = 'admin'::public.user_role THEN
      -- Admin may pass any canteen or NULL (all canteens)
      NULL;
    ELSE
      RAISE EXCEPTION 'FORBIDDEN: Only staff and admin may execute mark_no_shows';
    END IF;
  END IF;

  -- Select and lock expired READY orders (batch capped at 200, SKIP LOCKED avoids concurrency blocks)
  SELECT array_agg(sub.id) INTO v_order_ids
  FROM (
    SELECT o.id
    FROM public.orders o
    JOIN public.canteens c ON c.id = o.canteen_id
    WHERE o.status = 'READY'::public.order_status
      AND (p_canteen_id IS NULL OR o.canteen_id = p_canteen_id)
      AND o.ready_at IS NOT NULL
      AND (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) < clock_timestamp()
    ORDER BY o.ready_at ASC
    LIMIT 200
    FOR UPDATE OF o SKIP LOCKED
  ) sub;

  IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
    -- Guarded update: only update if status is still READY
    UPDATE public.orders
    SET status = 'NO_SHOW'::public.order_status
    WHERE id = ANY(v_order_ids)
      AND status = 'READY'::public.order_status;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
      INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, details)
      VALUES (
        v_caller_id,
        'ORDERS_MARKED_NO_SHOW',
        'canteen',
        coalesce(p_canteen_id::text, 'ALL'),
        jsonb_build_object(
          'canteen_id', p_canteen_id,
          'count', v_count,
          'order_ids', v_order_ids
        )
      );
    END IF;
  END IF;

  -- Housekeeping: prune pickup_collect_attempts older than 7 days
  DELETE FROM public.pickup_collect_attempts
  WHERE attempted_at < (clock_timestamp() - interval '7 days');

  RETURN jsonb_build_object(
    'ok', true,
    'marked_count', v_count,
    'canteen_id', p_canteen_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_no_shows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_no_shows(uuid) TO authenticated, service_role;

-- =============================================================================
-- 8. STUDENT RPC: public.get_my_account_status()
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_account_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_strike_count integer := 0;
  v_active_count integer := 0;
  v_is_limited boolean := false;
  v_active_limit integer := 3;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
  END IF;

  IF v_profile.role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only students can check account status';
  END IF;

  -- Count strikes: rolling 30 days, status NO_SHOW, verified READY notification, after cleared_at
  SELECT count(*) INTO v_strike_count
  FROM public.orders o
  LEFT JOIN public.student_strike_resets ssr ON ssr.student_id = v_user_id
  WHERE o.user_id = v_user_id
    AND o.status = 'NO_SHOW'::public.order_status
    AND o.ready_at >= (clock_timestamp() - interval '30 days')
    AND (ssr.cleared_at IS NULL OR o.ready_at > ssr.cleared_at)
    AND EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.order_id = o.id AND n.title = 'Order Ready'
    );

  v_is_limited := (v_strike_count >= 3);
  v_active_limit := CASE WHEN v_is_limited THEN 2 ELSE 3 END;

  SELECT count(*) INTO v_active_count
  FROM public.orders
  WHERE user_id = v_user_id
    AND status IN (
      'PLACED'::public.order_status,
      'ACCEPTED'::public.order_status,
      'PREPARING'::public.order_status,
      'READY'::public.order_status
    );

  RETURN jsonb_build_object(
    'is_limited', v_is_limited,
    'strike_count', v_strike_count,
    'active_order_limit', v_active_limit,
    'current_active_orders', v_active_count,
    'max_items_per_order', CASE WHEN v_is_limited THEN 2 ELSE NULL END,
    'max_paise_per_order', CASE WHEN v_is_limited THEN 20000 ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_status() TO authenticated;

-- =============================================================================
-- 9. PRE-ORDER RPC: public.place_order (with Strike Limits & Total Checks)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.place_order(
  p_canteen_id uuid,
  p_items jsonb,
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
  MAX_DISTINCT_ITEMS CONSTANT integer := 20;
  MAX_ITEM_QTY CONSTANT integer := 10;

  v_user_id uuid;
  v_profile_active boolean;
  v_profile_role public.user_role;
  v_canteen_id uuid;
  v_canteen_active boolean;
  v_existing_order record;
  v_active_count integer;

  v_strike_count integer := 0;
  v_is_limited boolean := false;
  v_max_active_orders integer := 3;

  v_agg_items jsonb := '[]'::jsonb;
  v_item record;
  v_menu_item record;
  v_item_id uuid;
  v_qty integer;
  v_distinct_count integer := 0;
  v_total_units integer := 0;

  v_est_record record;
  v_total_paise integer := 0;
  v_order_id uuid;
  v_order_code text;
  v_pickup_for_name text;
  v_secret text;

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

  -- 3.1 Sanitization of pickup designee name
  IF p_pickup_for_name IS NOT NULL THEN
    v_pickup_for_name := p_pickup_for_name;
    v_pickup_for_name := regexp_replace(v_pickup_for_name, '[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', '', 'g');
    v_pickup_for_name := regexp_replace(v_pickup_for_name, '\s+', ' ', 'g');
    v_pickup_for_name := regexp_replace(v_pickup_for_name, '[\x00-\x1F\x7F]', '', 'g');
    v_pickup_for_name := btrim(v_pickup_for_name);
    v_pickup_for_name := left(v_pickup_for_name, 40);
    v_pickup_for_name := btrim(v_pickup_for_name);
    IF v_pickup_for_name = '' THEN
      v_pickup_for_name := NULL;
    END IF;
  ELSE
    v_pickup_for_name := NULL;
  END IF;

  -- 4. Preliminary Idempotency Check
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
    COUNT(*)::integer,
    coalesce(SUM(total_qty), 0)::integer
  INTO v_agg_items, v_distinct_count, v_total_units
  FROM aggregated;

  IF v_distinct_count = 0 OR v_distinct_count > MAX_DISTINCT_ITEMS THEN
    RAISE EXCEPTION 'INVALID_INPUT: Order must contain between 1 and % distinct items', MAX_DISTINCT_ITEMS;
  END IF;

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

  -- 8. Strike Counting & Account Limitation Check
  SELECT count(*) INTO v_strike_count
  FROM public.orders o
  LEFT JOIN public.student_strike_resets ssr ON ssr.student_id = v_user_id
  WHERE o.user_id = v_user_id
    AND o.status = 'NO_SHOW'::public.order_status
    AND o.ready_at >= (clock_timestamp() - interval '30 days')
    AND (ssr.cleared_at IS NULL OR o.ready_at > ssr.cleared_at)
    AND EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.order_id = o.id AND n.title = 'Order Ready'
    );

  v_is_limited := (v_strike_count >= 3);
  v_max_active_orders := CASE WHEN v_is_limited THEN 2 ELSE 3 END;

  -- If limited, enforce maximum 2 total units across all order items
  IF v_is_limited AND v_total_units > 2 THEN
    RAISE EXCEPTION 'ACCOUNT_LIMITED: Account limited due to 3 or more no-shows. Maximum 2 items total allowed per order (got %)', v_total_units;
  END IF;

  -- Active Orders Limit Check
  SELECT count(*) INTO v_active_count
  FROM public.orders o
  WHERE o.user_id = v_user_id
  AND o.status IN (
    'PLACED'::public.order_status, 
    'ACCEPTED'::public.order_status, 
    'PREPARING'::public.order_status, 
    'READY'::public.order_status
  );

  IF v_active_count >= v_max_active_orders THEN
    RAISE EXCEPTION 'TOO_MANY_ACTIVE_ORDERS: You have reached the maximum limit of % active orders%',
      v_max_active_orders,
      CASE WHEN v_is_limited THEN ' (account restricted due to 3 or more no-shows)' ELSE '' END;
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

  -- If limited, enforce maximum 20000 paise (₹200) total order amount
  IF v_is_limited AND v_total_paise > 20000 THEN
    RAISE EXCEPTION 'ACCOUNT_LIMITED: Account limited due to 3 or more no-shows. Maximum order amount is ₹200 (got % paise)', v_total_paise;
  END IF;

  -- 10. Call Dynamic Pickup Estimation
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

  -- 11. Atomic Sub-Block: Decrement stock, insert order & items
  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      UPDATE public.menu_items
      SET stock = stock - v_qty
      WHERE id = v_item_id AND stock IS NOT NULL;
    END LOOP;

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

    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_id, v_secret);

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      SELECT name, price_paise INTO v_menu_item
      FROM public.menu_items
      WHERE id = v_item_id;

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
      ELSE
        RAISE EXCEPTION 'CONFLICT: A concurrent conflict occurred while processing order';
      END IF;
  END;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'status', 'PLACED'::public.order_status,
    'total_paise', v_total_paise,
    'estimated_ready_at', v_est_record.estimated_ready_at,
    'pickup_window_end', v_est_record.pickup_window_end,
    'requested_pickup_at', p_requested_at,
    'was_duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) TO authenticated, service_role;

-- =============================================================================
-- 10. ADMIN STRIKES PROCEDURES
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_student_strikes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_role public.user_role;
  v_active boolean;
  v_result jsonb;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_role, v_active
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT FOUND OR NOT v_active OR v_role <> 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin role required';
  END IF;

  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'student_id', p.id,
      'student_name', coalesce(p.full_name, 'Student'),
      'college_id_last4', right(coalesce(p.college_id, '0000'), 4),
      'strike_count', count(o.id)::integer,
      'last_no_show_at', max(o.ready_at),
      'is_limited', (count(o.id) >= 3)
    ) AS item
    FROM public.profiles p
    JOIN public.orders o ON o.user_id = p.id
    LEFT JOIN public.student_strike_resets ssr ON ssr.student_id = p.id
    WHERE p.role = 'student'::public.user_role
      AND o.status = 'NO_SHOW'::public.order_status
      AND o.ready_at >= (clock_timestamp() - interval '30 days')
      AND (ssr.cleared_at IS NULL OR o.ready_at > ssr.cleared_at)
      AND EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.order_id = o.id AND n.title = 'Order Ready'
      )
    GROUP BY p.id, p.full_name, p.college_id
    HAVING count(o.id) > 0
    ORDER BY count(o.id) DESC, max(o.ready_at) DESC
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_student_strikes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_student_strikes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_clear_student_strikes(
  p_student_id uuid,
  p_reason text DEFAULT 'Cleared by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_role public.user_role;
  v_active boolean;
  v_student record;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_role, v_active
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT FOUND OR NOT v_active OR v_role <> 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin role required';
  END IF;

  SELECT id, full_name, college_id INTO v_student
  FROM public.profiles
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Student profile not found';
  END IF;

  INSERT INTO public.student_strike_resets (
    student_id,
    cleared_at,
    cleared_by,
    reason
  ) VALUES (
    p_student_id,
    v_now,
    v_admin_id,
    coalesce(btrim(p_reason), 'Cleared by admin')
  )
  ON CONFLICT (student_id) DO UPDATE SET
    cleared_at = v_now,
    cleared_by = v_admin_id,
    reason = coalesce(btrim(p_reason), 'Cleared by admin');

  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'STUDENT_STRIKES_CLEARED',
    'student',
    p_student_id::text,
    jsonb_build_object(
      'student_id', p_student_id,
      'cleared_at', v_now,
      'reason', coalesce(btrim(p_reason), 'Cleared by admin')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'cleared_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_student_strikes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clear_student_strikes(uuid, text) TO authenticated;

-- =============================================================================
-- 11. ADMIN RECONCILIATION: public.get_daily_reconciliation
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_daily_reconciliation(
  p_date date DEFAULT NULL,
  p_canteen_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_role public.user_role;
  v_active boolean;
  v_target_date date;
  v_current_ist_date date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_canteen_breakdown jsonb;
  v_staff_breakdown jsonb;
  v_grand_totals jsonb;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_role, v_active
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT FOUND OR NOT v_active OR v_role <> 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Admin role required';
  END IF;

  v_current_ist_date := (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
  v_target_date := coalesce(p_date, v_current_ist_date);

  IF v_target_date > v_current_ist_date THEN
    RAISE EXCEPTION 'INVALID_INPUT: Date cannot be in the future';
  END IF;

  IF v_target_date < (v_current_ist_date - interval '365 days') THEN
    RAISE EXCEPTION 'INVALID_INPUT: Date cannot be older than 365 days';
  END IF;

  -- IST day boundaries
  v_day_start := (v_target_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_day_end   := (v_target_date::text || ' 23:59:59.999999')::timestamp AT TIME ZONE 'Asia/Kolkata';

  -- Canteen breakdown
  SELECT coalesce(jsonb_agg(c_item), '[]'::jsonb) INTO v_canteen_breakdown
  FROM (
    SELECT jsonb_build_object(
      'canteen_id', c.id,
      'canteen_name', c.name,
      'collected_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status)::integer,
      'total_collected_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status), 0)::bigint,
      'cash_collected_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'CASH'::public.collected_with_enum)::integer,
      'cash_collected_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'CASH'::public.collected_with_enum), 0)::bigint,
      'upi_collected_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'UPI'::public.collected_with_enum)::integer,
      'upi_collected_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'UPI'::public.collected_with_enum), 0)::bigint,
      'manual_override_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.is_manual_override = true)::integer,
      'late_handover_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.is_manual_override = true AND o.collected_at > (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')))::integer,
      'no_show_count', (
        SELECT count(*)::integer
        FROM public.orders ns
        WHERE ns.canteen_id = c.id
          AND ns.status = 'NO_SHOW'::public.order_status
          AND ns.ready_at >= v_day_start AND ns.ready_at <= v_day_end
      )
    ) AS c_item
    FROM public.canteens c
    LEFT JOIN public.orders o ON o.canteen_id = c.id
      AND o.collected_at >= v_day_start AND o.collected_at <= v_day_end
    WHERE (p_canteen_id IS NULL OR c.id = p_canteen_id)
    GROUP BY c.id, c.name, c.hold_minutes
    ORDER BY c.name ASC
  ) c_sub;

  -- Staff breakdown (per canteen and staff member)
  SELECT coalesce(jsonb_agg(s_item), '[]'::jsonb) INTO v_staff_breakdown
  FROM (
    SELECT jsonb_build_object(
      'canteen_id', o.canteen_id,
      'canteen_name', c.name,
      'staff_id', p.id,
      'staff_name', coalesce(p.full_name, 'Staff Member'),
      'collected_count', count(o.id)::integer,
      'total_collected_paise', coalesce(sum(o.total_paise), 0)::bigint,
      'cash_count', count(o.id) FILTER (WHERE o.collected_with = 'CASH'::public.collected_with_enum)::integer,
      'cash_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.collected_with = 'CASH'::public.collected_with_enum), 0)::bigint,
      'upi_count', count(o.id) FILTER (WHERE o.collected_with = 'UPI'::public.collected_with_enum)::integer,
      'upi_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.collected_with = 'UPI'::public.collected_with_enum), 0)::bigint,
      'manual_count', count(o.id) FILTER (WHERE o.is_manual_override = true)::integer,
      'manual_rate_pct', CASE WHEN count(o.id) > 0 THEN round((count(o.id) FILTER (WHERE o.is_manual_override = true)::numeric / count(o.id)::numeric) * 100, 1) ELSE 0.0 END,
      'late_handover_count', count(o.id) FILTER (WHERE o.is_manual_override = true AND o.collected_at > (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')))::integer
    ) AS s_item
    FROM public.orders o
    JOIN public.profiles p ON p.id = o.collected_by
    JOIN public.canteens c ON c.id = o.canteen_id
    WHERE o.status = 'COLLECTED'::public.order_status
      AND o.collected_at >= v_day_start AND o.collected_at <= v_day_end
      AND (p_canteen_id IS NULL OR o.canteen_id = p_canteen_id)
    GROUP BY o.canteen_id, c.name, c.hold_minutes, p.id, p.full_name
    ORDER BY c.name ASC, p.full_name ASC
  ) s_sub;

  -- Grand Totals
  SELECT jsonb_build_object(
    'target_date', v_target_date,
    'total_collected_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status)::integer,
    'total_collected_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status), 0)::bigint,
    'total_cash_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'CASH'::public.collected_with_enum), 0)::bigint,
    'total_upi_paise', coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.collected_with = 'UPI'::public.collected_with_enum), 0)::bigint,
    'total_manual_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.is_manual_override = true)::integer,
    'total_late_handover_count', count(o.id) FILTER (WHERE o.status = 'COLLECTED'::public.order_status AND o.is_manual_override = true AND o.collected_at > (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')))::integer,
    'total_no_show_count', (
      SELECT count(*)::integer
      FROM public.orders ns
      WHERE (p_canteen_id IS NULL OR ns.canteen_id = p_canteen_id)
        AND ns.status = 'NO_SHOW'::public.order_status
        AND ns.ready_at >= v_day_start AND ns.ready_at <= v_day_end
    )
  ) INTO v_grand_totals
  FROM public.orders o
  JOIN public.canteens c ON c.id = o.canteen_id
  WHERE (p_canteen_id IS NULL OR o.canteen_id = p_canteen_id)
    AND o.collected_at >= v_day_start AND o.collected_at <= v_day_end;

  RETURN jsonb_build_object(
    'date', v_target_date,
    'canteen_id', p_canteen_id,
    'canteens', v_canteen_breakdown,
    'staff', v_staff_breakdown,
    'summary', v_grand_totals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_reconciliation(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_reconciliation(date, uuid) TO authenticated;

-- =============================================================================
-- 12. CANTEEN SETTINGS: public.admin_update_canteen_settings (5-120 Validation)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_update_canteen_settings(
  p_canteen_id uuid,
  p_opens_at time,
  p_closes_at time,
  p_last_order_time time,
  p_kitchen_capacity integer,
  p_min_lead_minutes integer,
  p_hold_minutes integer
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller    public.profiles%ROWTYPE;
  v_canteen   public.canteens%ROWTYPE;
BEGIN
  -- 1. Verify caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
  END IF;

  IF v_caller.role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may update canteen configuration';
  END IF;

  -- 2. Validate inputs (Hold window must be between 5 and 120 minutes)
  IF p_kitchen_capacity <= 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Kitchen capacity must be greater than zero';
  END IF;

  IF p_min_lead_minutes < 0 OR p_min_lead_minutes > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Minimum lead buffer must be between 0 and 120 minutes';
  END IF;

  IF p_hold_minutes < 5 OR p_hold_minutes > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Hold window must be between 5 and 120 minutes';
  END IF;

  IF p_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'INVALID_INPUT: Closing time must be strictly after opening time';
  END IF;

  IF p_last_order_time > p_closes_at OR p_last_order_time < p_opens_at THEN
    RAISE EXCEPTION 'INVALID_INPUT: Last order cutoff time must be between opening and closing time';
  END IF;

  -- 3. Lock canteen row FOR UPDATE
  SELECT * INTO v_canteen
  FROM public.canteens
  WHERE id = p_canteen_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Canteen does not exist';
  END IF;

  -- 4. Apply updates
  UPDATE public.canteens
  SET opens_at = p_opens_at,
      closes_at = p_closes_at,
      last_order_time = p_last_order_time,
      kitchen_capacity = p_kitchen_capacity,
      min_lead_minutes = p_min_lead_minutes,
      hold_minutes = p_hold_minutes
  WHERE id = p_canteen_id;

  -- 5. Audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    'CANTEEN_SETTINGS_UPDATED',
    'canteen',
    p_canteen_id::text,
    jsonb_build_object(
      'opens_at', p_opens_at,
      'closes_at', p_closes_at,
      'last_order_time', p_last_order_time,
      'kitchen_capacity', p_kitchen_capacity,
      'min_lead_minutes', p_min_lead_minutes,
      'hold_minutes', p_hold_minutes
    )
  );

  RETURN jsonb_build_object(
    'canteen_id', p_canteen_id,
    'opens_at', p_opens_at,
    'closes_at', p_closes_at,
    'last_order_time', p_last_order_time,
    'kitchen_capacity', p_kitchen_capacity,
    'min_lead_minutes', p_min_lead_minutes,
    'hold_minutes', p_hold_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_canteen_settings(uuid, time, time, time, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_canteen_settings(uuid, time, time, time, integer, integer, integer) TO authenticated, service_role;

-- =============================================================================
-- 13. NOTIFICATION TRIGGER: public.handle_order_status_notification
-- =============================================================================
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
        IF OLD.status = 'NO_SHOW'::public.order_status OR (NEW.manual_override_reason IS NOT NULL AND NEW.manual_override_reason ILIKE '%late%') THEN
          v_body := 'Your order ' || NEW.order_code || ' was handed over late by canteen staff. Thank you for collecting!';
        ELSE
          v_body := 'Your order ' || NEW.order_code || ' was marked collected manually by canteen staff. If this was not you or your designated representative, please report it immediately.';
        END IF;
      ELSE
        v_body := 'Your order ' || NEW.order_code || ' has been collected. Thank you for ordering!';
      END IF;

    WHEN 'NO_SHOW'::public.order_status THEN
      v_title := 'Order Expired';
      v_body  := 'Your order ' || NEW.order_code || ' was not collected within the pickup window and has expired.';

    WHEN 'REJECTED'::public.order_status THEN
      v_title := 'Order Rejected';
      v_body  := 'Your order was rejected by the canteen.';

    ELSE
      -- CANCELLED handled by cancel_order
      RETURN NEW;
  END CASE;

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

REVOKE ALL ON FUNCTION public.handle_order_status_notification() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
