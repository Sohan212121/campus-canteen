-- Migration 0013: Collection Core v2 (Additive Only)
-- Description:
--   Additive schema changes for smart counter pickup.
--   Does NOT alter, drop, or rewrite any existing function (place_order, transition_order, verify_pickup untouched).
--   Safe to apply alone before cutover.
--
-- Contents:
--   1. New enums: collection_method_enum ('SCAN', 'PIN', 'MANUAL'), collected_with_enum ('CASH', 'UPI')
--   2. New columns on public.orders (real schema names, collected_at already exists)
--   3. Secure order_pickup_secrets table (RLS on, NO policies, revoked from PUBLIC, anon, authenticated, service_role)
--   4. NEW pickup_collect_attempts table (leaves pickup_verify_attempts untouched)
--   5. pgcrypto wrapper public.pickup_hmac() using extensions schema with SET search_path = ''
--   6. Internal helpers: internal_get_pickup_pin, internal_get_pickup_code
--   7. Student RPC: get_pickup_code
--   8. Staff Preview RPC: preview_collection
--   9. Staff Collection RPC: collect_order
--  10. Dispute Reporting: order_collection_reports table (RLS on, NO policies)
--      and functions: report_unauthorized_collection, admin_list_collection_reports, admin_resolve_collection_report
--  11. Backfill secrets for in-flight orders

BEGIN;

-- 1. Custom Types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_method_enum') THEN
    CREATE TYPE public.collection_method_enum AS ENUM ('SCAN', 'PIN', 'MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collected_with_enum') THEN
    CREATE TYPE public.collected_with_enum AS ENUM ('CASH', 'UPI');
  END IF;
END $$;

-- 2. New columns on public.orders (additive only, collected_at was created in 0001)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS collection_method public.collection_method_enum,
  ADD COLUMN IF NOT EXISTS collected_with public.collected_with_enum,
  ADD COLUMN IF NOT EXISTS pickup_for_name text,
  ADD COLUMN IF NOT EXISTS is_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_override_reason text,
  ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3. Secure Order Secrets Table (RLS on, no policies, revoked from everyone including service_role)
CREATE TABLE IF NOT EXISTS public.order_pickup_secrets (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  secret text NOT NULL,
  failed_pin_attempts integer NOT NULL DEFAULT 0,
  is_pin_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_pickup_secrets
  ADD COLUMN IF NOT EXISTS failed_pin_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_pin_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.order_pickup_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_pickup_secrets FROM PUBLIC, anon, authenticated, service_role;

-- 4. NEW Attempts Table: pickup_collect_attempts (leaves pickup_verify_attempts untouched)
CREATE TABLE IF NOT EXISTS public.pickup_collect_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  canteen_id uuid REFERENCES public.canteens(id) ON DELETE SET NULL,
  method text NOT NULL,
  outcome text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pickup_collect_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pickup_collect_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_pickup_collect_attempts_staff_time
  ON public.pickup_collect_attempts(staff_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickup_collect_attempts_order_time
  ON public.pickup_collect_attempts(order_id, attempted_at DESC);

-- 5. Unified pgcrypto wrapper function in extensions schema
CREATE OR REPLACE FUNCTION public.pickup_hmac(p_key text, p_msg text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN extensions.hmac(convert_to(p_msg, 'utf-8'), convert_to(p_key, 'utf-8'), 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.pickup_hmac(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- 6. Internal Helpers for PIN and TOTP Code (Revoked from PUBLIC, anon, authenticated, service_role)
CREATE OR REPLACE FUNCTION public.internal_get_pickup_pin(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_raw_hash bytea;
  v_num bigint;
BEGIN
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  v_raw_hash := public.pickup_hmac(v_secret, 'pin:' || p_order_id::text);
  v_num := (('x' || substr(encode(v_raw_hash, 'hex'), 1, 8))::bit(32)::bigint) & 2147483647;
  RETURN lpad((v_num % 10000)::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_pin(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.internal_get_pickup_code(p_order_id uuid, p_window_offset integer DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_epoch bigint;
  v_window bigint;
  v_raw_hash bytea;
  v_num bigint;
BEGIN
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  v_epoch := floor(extract(epoch from clock_timestamp()))::bigint;
  v_window := (v_epoch / 60) + p_window_offset;
  v_raw_hash := public.pickup_hmac(v_secret, 'totp:' || v_window::text);
  v_num := (('x' || substr(encode(v_raw_hash, 'hex'), 1, 8))::bit(32)::bigint) & 2147483647;
  RETURN lpad((v_num % 1000000)::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_code(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 7. Student RPC: get_pickup_code (requires active student who owns the order)
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

  SELECT o.id, o.order_code, o.user_id, o.status, o.pickup_for_name
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  IF v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only view pickup codes for your own orders';
  END IF;

  IF v_order.status != 'READY'::public.order_status THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ORDER_NOT_READY'
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

-- 8. Staff Preview RPC: preview_collection
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

-- 9. Staff Collection Execution RPC: collect_order
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

      -- Amber strictly requires BOTH rotating code and PIN
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

        -- Incomplete amber credentials (e.g. code provided but PIN not yet entered) are not logged as failures
        RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_BOTH');
      END IF;
    ELSE
      -- Normal order scan: valid code succeeds even if PIN was previously locked
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

-- 10. Dispute Reporting System (RLS on, NO policies, function-gated)
CREATE TABLE IF NOT EXISTS public.order_collection_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'DISMISSED')),
  admin_notes text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_collection_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_collection_reports FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_unauthorized_collection(
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_order record;
  v_recent_reports_count integer;
  v_reason text;
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

  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Reason must be at least 5 characters long';
  END IF;

  -- Sanitize reason: strip invisible/bidi, collapse spaces, strip controls, trim, truncate 500, trim again, empty -> NULL
  v_reason := p_reason;
  v_reason := regexp_replace(v_reason, '[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', '', 'g');
  v_reason := regexp_replace(v_reason, '\s+', ' ', 'g');
  v_reason := regexp_replace(v_reason, '[\x00-\x1F\x7F]', '', 'g');
  v_reason := btrim(v_reason);
  v_reason := left(v_reason, 500);
  v_reason := btrim(v_reason);
  IF v_reason = '' THEN
    v_reason := NULL;
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Reason must be at least 5 characters long';
  END IF;

  SELECT id, user_id, status, collected_at, order_code
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  IF v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN: You can only report issues for your own orders';
  END IF;

  IF v_order.status != 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COLLECTED');
  END IF;

  IF v_order.collected_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REPORT_WINDOW_EXPIRED');
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_collection_reports WHERE order_id = p_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REPORTED');
  END IF;

  SELECT count(*) INTO v_recent_reports_count
  FROM public.order_collection_reports
  WHERE user_id = v_user_id
    AND created_at > now() - interval '30 days';

  IF v_recent_reports_count >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REPORT_LIMIT_EXCEEDED');
  END IF;

  BEGIN
    INSERT INTO public.order_collection_reports (
      order_id,
      user_id,
      reason
    ) VALUES (
      v_order.id,
      v_user_id,
      v_reason
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REPORTED');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_unauthorized_collection(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_unauthorized_collection(uuid, text) TO authenticated;

-- Admin report management functions
CREATE OR REPLACE FUNCTION public.admin_list_collection_reports(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
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
  v_result jsonb;
  v_limit integer;
  v_offset integer;
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

  IF p_status IS NOT NULL AND p_status NOT IN ('PENDING', 'RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'INVALID_INPUT: Status must be PENDING, RESOLVED, or DISMISSED';
  END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'order_id', r.order_id,
      'order_code', o.order_code,
      'user_id', r.user_id,
      'student_name', p.full_name,
      'student_college_id', p.college_id,
      'canteen_name', c.name,
      'reason', r.reason,
      'status', r.status,
      'admin_notes', r.admin_notes,
      'created_at', r.created_at,
      'resolved_at', r.resolved_at,
      'collection_method', o.collection_method,
      'collected_with', o.collected_with,
      'is_manual_override', o.is_manual_override,
      'manual_override_reason', o.manual_override_reason,
      'collected_at', o.collected_at,
      'collecting_staff_name', staff.full_name,
      'collected_by_name', staff.full_name
    ) AS item
    FROM public.order_collection_reports r
    JOIN public.orders o ON o.id = r.order_id
    JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.canteens c ON c.id = o.canteen_id
    LEFT JOIN public.profiles staff ON staff.id = o.collected_by
    WHERE (p_status IS NULL OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_collection_reports(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_collection_reports(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_collection_report(
  p_report_id uuid,
  p_resolution text,
  p_notes text DEFAULT NULL
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
  v_report record;
  v_notes text;
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

  IF p_resolution NOT IN ('RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'INVALID_INPUT: Resolution must be RESOLVED or DISMISSED';
  END IF;

  -- Sanitize admin notes
  IF p_notes IS NOT NULL THEN
    v_notes := p_notes;
    v_notes := regexp_replace(v_notes, '[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', '', 'g');
    v_notes := regexp_replace(v_notes, '\s+', ' ', 'g');
    v_notes := regexp_replace(v_notes, '[\x00-\x1F\x7F]', '', 'g');
    v_notes := btrim(v_notes);
    v_notes := left(v_notes, 500);
    v_notes := btrim(v_notes);
    IF v_notes = '' THEN
      v_notes := NULL;
    END IF;
  ELSE
    v_notes := NULL;
  END IF;

  -- Lock report row FOR UPDATE
  SELECT * INTO v_report
  FROM public.order_collection_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Report % does not exist', p_report_id;
  END IF;

  -- Idempotent check: if already resolved, return changed: false with zero audit rows written
  IF v_report.status != 'PENDING' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'report_id', p_report_id,
      'status', v_report.status
    );
  END IF;

  UPDATE public.order_collection_reports
  SET status = p_resolution,
      admin_notes = v_notes,
      resolved_at = now(),
      resolved_by = v_admin_id
  WHERE id = p_report_id;

  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'RESOLVE_COLLECTION_REPORT',
    'order_collection_report',
    p_report_id::text,
    jsonb_build_object('order_id', v_report.order_id, 'resolution', p_resolution, 'notes', v_notes)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'report_id', p_report_id,
    'status', p_resolution
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_collection_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_collection_report(uuid, text, text) TO authenticated;

-- 11. Backfill Secrets for Existing In-Flight Orders
INSERT INTO public.order_pickup_secrets (order_id, secret)
SELECT o.id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
FROM public.orders o
WHERE o.status NOT IN ('COLLECTED'::public.order_status, 'CANCELLED'::public.order_status, 'REJECTED'::public.order_status)
  AND NOT EXISTS (
    SELECT 1 FROM public.order_pickup_secrets s WHERE s.order_id = o.id
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
