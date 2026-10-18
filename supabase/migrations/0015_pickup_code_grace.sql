-- ==============================================================================
-- 0015_pickup_code_grace.sql: Limit previous pickup code to 10-second grace
--                              and bind preview-to-collect via 90-second marker
-- ==============================================================================
-- Updates:
-- 1. internal_get_pickup_code:
--    - NULL-safe offset check: only 0 (current) and -1 (previous) are accepted.
--      Any NULL or offset outside (0, -1) immediately returns NULL.
--    - Single epoch read: computes v_epoch once from clock_timestamp() and derives
--      both v_window (v_epoch / 60) and v_second_in_window (v_epoch % 60).
--    - 10-second grace window: offset -1 is valid strictly during seconds 0..10 of
--      the new window (c_grace_seconds constant = 10). If v_second_in_window > 10,
--      offset -1 returns NULL.
--    - Permissions: revoked from PUBLIC, anon, authenticated, and service_role.
--
-- 2. preview_collection:
--    - Inserts a PREVIEW/SUCCESS marker row into pickup_collect_attempts upon successful
--      verification to bridge the physical preview-to-collection time gap.
--    - Marker uses outcome = 'SUCCESS' so it is strictly excluded from rate-limit failure queries.
--
-- 3. collect_order:
--    - In method SCAN, accepts rotating code if valid now OR if a PREVIEW/SUCCESS marker
--      exists for the same staff member and order within the rolling 90 seconds.
--    - Amber security check, PIN requirements, order row locking, READY status check,
--      and canteen checks remain completely preserved.
-- ==============================================================================

BEGIN;

-- 1. internal_get_pickup_code: 10-second grace rule on previous window code
CREATE OR REPLACE FUNCTION public.internal_get_pickup_code(p_order_id uuid, p_window_offset integer DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_grace_seconds CONSTANT integer := 10;
  v_secret text;
  v_epoch bigint;
  v_window bigint;
  v_second_in_window integer;
  v_raw_hash bytea;
  v_num bigint;
BEGIN
  -- 1. NULL-safe offset check: only 0 (current) and -1 (previous) are supported
  IF p_window_offset IS NULL OR p_window_offset NOT IN (0, -1) THEN
    RETURN NULL;
  END IF;

  -- 2. Compute v_epoch once and derive BOTH window number and second-in-window
  v_epoch := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window := v_epoch / 60;
  v_second_in_window := (v_epoch % 60)::integer;

  -- 3. 10-second grace window rule for previous window (offset -1)
  -- Previous window code is strictly valid ONLY during seconds 0..10 of the new window
  IF p_window_offset = -1 AND v_second_in_window > c_grace_seconds THEN
    RETURN NULL;
  END IF;

  -- 4. Lookup cryptographic secret
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  -- 5. Calculate TOTP code for the target window
  v_raw_hash := public.pickup_hmac(v_secret, 'totp:' || (v_window + p_window_offset)::text);
  v_num := (('x' || substr(encode(v_raw_hash, 'hex'), 1, 8))::bit(32)::bigint) & 2147483647;
  RETURN lpad((v_num % 1000000)::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_code(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 2. Staff Preview RPC: preview_collection (with preview binding marker)
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

  SELECT * INTO v_order
  FROM public.orders
  WHERE (id::text = p_order_ref OR upper(order_code) = upper(p_order_ref));

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- For staff compare order's canteen to caller's OWN profile canteen_id with IS DISTINCT FROM.
  -- Return NOT_FOUND to avoid confirming order existence across canteens.
  IF v_staff_role = 'staff'::public.user_role THEN
    IF v_staff_canteen IS NULL OR v_staff_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'NOT_FOUND: Order not found';
    END IF;
  END IF;

  IF v_order.status != 'READY'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
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
    -- If PIN is locked on an amber order, amber verification cannot succeed
    IF v_is_pin_locked THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;

    IF NOT v_code_valid OR NOT v_pin_valid THEN
      -- If a wrong PIN was explicitly provided, record PIN attempt failure
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

      -- Incomplete amber credentials (e.g. scanning QR code before entering PIN) are NOT logged as failures
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

    -- If PIN path is attempted and PIN is locked
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

  -- Insert preview binding marker with outcome = 'SUCCESS'
  -- This bridges the physical handover time gap (up to 90 seconds) for collect_order
  -- and does not count towards staff or order failure rate limits
  INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
  VALUES (v_staff_id, v_order.id, v_order.canteen_id, 'PREVIEW', 'SUCCESS');

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

-- 3. Staff Collection Execution RPC: collect_order (with preview marker check)
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

  -- Strict IS NULL or NOT IN validation for collected_with and method
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

  -- For staff compare order's canteen to caller's OWN profile canteen_id with IS DISTINCT FROM (ignore client p_canteen_id).
  -- Return NOT_FOUND to avoid confirming order existence across canteens.
  IF v_staff_role = 'staff'::public.user_role THEN
    IF v_staff_canteen IS NULL OR v_staff_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'NOT_FOUND: Order not found';
    END IF;
  END IF;

  IF v_order.status = 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_COLLECTED');
  END IF;

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

    -- Staff manual override cap: 10 per staff per 24 hours
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

    -- Preview binding rule:
    -- If rotating code has refreshed and exceeded 10s grace during counter glance/payment,
    -- accept if the SAME staff member successfully verified this order via preview in the last 90 seconds.
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

      -- Amber strictly requires BOTH rotating code (or fresh preview marker) and PIN
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

        -- Incomplete amber credentials are not logged as failures
        RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_BOTH');
      END IF;
    ELSE
      -- Normal order scan: valid code (or fresh preview marker) succeeds even if PIN was previously locked
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

  INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome)
  VALUES (v_staff_id, v_order.id, v_order.canteen_id, p_method, 'SUCCESS');

  -- Write audit log row
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

NOTIFY pgrst, 'reload schema';

COMMIT;
