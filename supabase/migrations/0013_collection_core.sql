-- ==============================================================================
-- Migration: 0013_collection_core.sql
-- Description: Smart pickup collection core: TOTP rotating pickup code, PIN fallback,
--              amber threshold validation, preview & collect procedures, audit logging,
--              unauthorized collection reports ("Not me"), and pickup_token deprecation.
-- Campus Canteen Pre-Order & Smart Pickup Platform
-- ==============================================================================

-- 1. SCHEMA MODIFICATIONS ON public.orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pickup_for_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collected_with text CHECK (collected_with IN ('CASH', 'UPI'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS collection_method text CHECK (collection_method IN ('SCAN', 'PIN', 'MANUAL'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS manual_collection_reason text;

-- Make pickup_token nullable for existing & future orders and drop unique constraint
ALTER TABLE public.orders ALTER COLUMN pickup_token DROP NOT NULL;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_pickup_token_key;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS uq_orders_pickup_token;

-- 2. TABLE: public.order_pickup_secrets
-- Stores 64-char hex secret per order. Never stores plaintext PIN or pin_hash.
-- Accessible exclusively by SECURITY DEFINER routines and service_role.
CREATE TABLE IF NOT EXISTS public.order_pickup_secrets (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  secret text NOT NULL,
  failed_pin_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_pickup_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_pickup_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_pickup_secrets TO service_role;

-- 3. SCHEMA MODIFICATIONS ON public.pickup_verify_attempts
-- Add order_id reference to track failed attempts per order
ALTER TABLE public.pickup_verify_attempts ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pickup_verify_order_time ON public.pickup_verify_attempts(order_id, attempted_at DESC);

-- 4. TABLE: public.order_collection_reports ("Not me" student dispute reports)
CREATE TABLE IF NOT EXISTS public.order_collection_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  reported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
  reason text NOT NULL,
  admin_note text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_order_collection_report_order UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_collection_reports_reporter ON public.order_collection_reports(reporter_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_collection_reports_canteen ON public.order_collection_reports(canteen_id, reported_at DESC);

ALTER TABLE public.order_collection_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_collection_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.order_collection_reports TO service_role;

-- 5. INTERNAL PGCRYPTO WRAPPER: public.pickup_hmac
-- The ONLY place in the entire codebase where pgcrypto hmac is invoked.
-- Uses 'extensions' schema with fallback to 'public'. SET search_path = ''.
CREATE OR REPLACE FUNCTION public.pickup_hmac(p_key text, p_msg text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res bytea;
BEGIN
  BEGIN
    v_res := extensions.hmac(p_msg::bytea, p_key::bytea, 'sha256');
  EXCEPTION WHEN undefined_function THEN
    v_res := public.hmac(p_msg::bytea, p_key::bytea, 'sha256');
  END;
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.pickup_hmac(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pickup_hmac(text, text) TO service_role;

-- 6. INTERNAL HELPER: public.internal_get_pickup_code
-- Computes the 6-digit TOTP code for a given order and arbitrary window.
-- Definer-only, used by get_pickup_code, preview_collection, collect_order, and test harness.
CREATE OR REPLACE FUNCTION public.internal_get_pickup_code(
  p_order_id uuid,
  p_window bigint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_hmac   bytea;
  v_num    integer;
BEGIN
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_hmac := public.pickup_hmac(v_secret, p_order_id::text || ':' || p_window::text);

  -- Standard dynamic truncation into 6-digit numeric string
  v_num := (
    (get_byte(v_hmac, 0) & 127) * 16777216 +
    get_byte(v_hmac, 1) * 65536 +
    get_byte(v_hmac, 2) * 256 +
    get_byte(v_hmac, 3)
  ) % 1000000;

  RETURN lpad(v_num::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_code(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_get_pickup_code(uuid, bigint) TO service_role;

-- 7. INTERNAL HELPER: public.internal_get_pickup_pin
-- Derives the deterministic 4-digit PIN for an order: HMAC of 'pin:' || order_id
CREATE OR REPLACE FUNCTION public.internal_get_pickup_pin(
  p_order_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_hmac   bytea;
  v_num    integer;
BEGIN
  SELECT secret INTO v_secret
  FROM public.order_pickup_secrets
  WHERE order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_hmac := public.pickup_hmac(v_secret, 'pin:' || p_order_id::text);

  v_num := (
    (get_byte(v_hmac, 0) & 127) * 16777216 +
    get_byte(v_hmac, 1) * 65536 +
    get_byte(v_hmac, 2) * 256 +
    get_byte(v_hmac, 3)
  ) % 10000;

  RETURN lpad(v_num::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.internal_get_pickup_pin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_get_pickup_pin(uuid) TO service_role;

-- 8. STUDENT PROCEDURE: public.get_pickup_code
-- Returns current rotating 6-digit code, seconds remaining, and 4-digit PIN.
CREATE OR REPLACE FUNCTION public.get_pickup_code(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id           uuid;
  v_caller            public.profiles%ROWTYPE;
  v_order             public.orders%ROWTYPE;
  v_window            bigint;
  v_seconds_remaining integer;
  v_code              text;
  v_pin               text;
BEGIN
  -- 1. Verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Verify active student profile
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only students may retrieve pickup codes';
  END IF;

  -- 3. Load order & verify ownership
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_order.user_id <> v_user_id THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- 4. Check status: strictly READY
  IF v_order.status <> 'READY'::public.order_status THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ORDER_NOT_READY',
      'status', v_order.status
    );
  END IF;

  -- 5. Calculate 60-second window and seconds remaining
  v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_seconds_remaining := 60 - (floor(extract(epoch from clock_timestamp()))::int % 60);

  -- 6. Derive current code and PIN
  v_code := public.internal_get_pickup_code(v_order.id, v_window);
  v_pin := public.internal_get_pickup_pin(v_order.id);

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECRET_NOT_FOUND');
  END IF;

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
GRANT EXECUTE ON FUNCTION public.get_pickup_code(uuid) TO authenticated, service_role;

-- 9. PREVIEW COLLECTION PROCEDURE: public.preview_collection
-- Verifies code / PIN / amber rules without state changes and returns the scan card.
-- Failed checks record rate-limit attempts and return { ok: false, error: ... } without raising.
CREATE OR REPLACE FUNCTION public.preview_collection(
  p_canteen_id uuid,
  p_order_ref  text,
  p_code       text DEFAULT NULL,
  p_pin        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id            uuid;
  v_caller             public.profiles%ROWTYPE;
  v_order              public.orders%ROWTYPE;
  v_secret_rec         public.order_pickup_secrets%ROWTYPE;
  v_student            public.profiles%ROWTYPE;
  v_staff_fails        integer;
  v_order_fails        integer;
  v_item_count         integer;
  v_is_amber           boolean;
  v_window             bigint;
  v_code_curr          text;
  v_code_prev          text;
  v_expected_pin       text;
  v_items              jsonb;
  v_first_name         text;
  v_college_id_last4   text;
  v_code_valid         boolean := false;
  v_pin_valid          boolean := false;
BEGIN
  -- 1. Authorization checks (RAISE on authorization/malformed input)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff or administrators may preview collections';
  END IF;

  IF v_caller.role = 'staff'::public.user_role AND (v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM p_canteen_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
  END IF;

  IF p_order_ref IS NULL OR length(trim(p_order_ref)) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Order reference is required';
  END IF;

  -- 2. Locate order by UUID or order_code
  IF p_order_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_ref::uuid;
  ELSE
    SELECT * INTO v_order
    FROM public.orders
    WHERE upper(trim(order_code)) = upper(trim(p_order_ref));
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  -- Staff canteen check against order's canteen
  IF v_caller.role = 'staff'::public.user_role AND v_order.canteen_id IS DISTINCT FROM v_caller.canteen_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Order belongs to a different canteen';
  END IF;

  -- 3. Check Order Status
  IF v_order.status = 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_COLLECTED');
  END IF;

  IF v_order.status <> 'READY'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
  END IF;

  -- 4. Rate-limit checks (failed checks persist because we RETURN jsonb rather than RAISE)
  SELECT count(*) INTO v_staff_fails
  FROM public.pickup_verify_attempts
  WHERE user_id = v_user_id
    AND attempted_at >= now() - interval '5 minutes';

  IF v_staff_fails >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  END IF;

  SELECT count(*) INTO v_order_fails
  FROM public.pickup_verify_attempts
  WHERE order_id = v_order.id
    AND attempted_at >= now() - interval '10 minutes';

  IF v_order_fails >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  END IF;

  -- 5. Calculate Amber state: > 5 total items OR > 50000 paise (500 INR)
  SELECT coalesce(sum(quantity), 0) INTO v_item_count
  FROM public.order_items
  WHERE order_id = v_order.id;

  v_is_amber := (v_item_count > 5 OR v_order.total_paise > 50000);

  -- 6. Load Secret & Check PIN Lockout
  SELECT * INTO v_secret_rec
  FROM public.order_pickup_secrets
  WHERE order_id = v_order.id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECRET_NOT_FOUND');
  END IF;

  IF v_secret_rec.failed_pin_attempts >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
  END IF;

  -- 7. Compute Expected rotating code (current and previous window) & PIN
  v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_code_curr := public.internal_get_pickup_code(v_order.id, v_window);
  v_code_prev := public.internal_get_pickup_code(v_order.id, v_window - 1);
  v_expected_pin := public.internal_get_pickup_pin(v_order.id);

  IF p_code IS NOT NULL AND trim(p_code) IN (v_code_curr, v_code_prev) THEN
    v_code_valid := true;
  END IF;

  IF p_pin IS NOT NULL AND trim(p_pin) = v_expected_pin THEN
    v_pin_valid := true;
  END IF;

  -- 8. Validate Amber Rules
  IF v_is_amber THEN
    -- Amber requires BOTH code AND PIN. PIN-only is refused.
    IF NOT v_code_valid THEN
      INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
      VALUES (v_user_id, v_order.canteen_id, v_order.id);
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
    END IF;

    IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
      INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
      VALUES (v_user_id, v_order.canteen_id, v_order.id);
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_REQUIRED');
    END IF;

    IF NOT v_pin_valid THEN
      UPDATE public.order_pickup_secrets
      SET failed_pin_attempts = failed_pin_attempts + 1
      WHERE order_id = v_order.id;

      INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
      VALUES (v_user_id, v_order.canteen_id, v_order.id);

      IF v_secret_rec.failed_pin_attempts + 1 >= 3 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
      END IF;

      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PIN');
    END IF;

  ELSE
    -- Non-amber order: accepts code OR PIN
    IF p_code IS NOT NULL AND length(trim(p_code)) > 0 THEN
      IF NOT v_code_valid THEN
        INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
        VALUES (v_user_id, v_order.canteen_id, v_order.id);
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
      END IF;
    ELSIF p_pin IS NOT NULL AND length(trim(p_pin)) > 0 THEN
      IF NOT v_pin_valid THEN
        UPDATE public.order_pickup_secrets
        SET failed_pin_attempts = failed_pin_attempts + 1
        WHERE order_id = v_order.id;

        INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
        VALUES (v_user_id, v_order.canteen_id, v_order.id);

        IF v_secret_rec.failed_pin_attempts + 1 >= 3 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
        END IF;

        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PIN');
      END IF;
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'CODE_OR_PIN_REQUIRED');
    END IF;
  END IF;

  -- 9. Load Student scan card details (first name, last 4 of college_id)
  SELECT * INTO v_student
  FROM public.profiles
  WHERE id = v_order.user_id;

  v_first_name := split_part(trim(coalesce(v_student.full_name, 'Student')), ' ', 1);
  v_college_id_last4 := right(coalesce(v_student.college_id, ''), 4);

  -- 10. Load Order Items
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
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
    'first_name', v_first_name,
    'college_id_last4', v_college_id_last4,
    'pickup_for_name', v_order.pickup_for_name,
    'total_paise', v_order.total_paise,
    'is_amber', v_is_amber,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_collection(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_collection(uuid, text, text, text) TO authenticated, service_role;

-- 10. ATOMIC COLLECTION PROCEDURE: public.collect_order
-- Re-verifies credentials, locks the order FOR UPDATE, records payment & collection.
CREATE OR REPLACE FUNCTION public.collect_order(
  p_order_id        uuid,
  p_code            text DEFAULT NULL,
  p_collected_with  text DEFAULT 'CASH',
  p_method          text DEFAULT 'SCAN',
  p_pin             text DEFAULT NULL,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id            uuid;
  v_caller             public.profiles%ROWTYPE;
  v_order              public.orders%ROWTYPE;
  v_secret_rec         public.order_pickup_secrets%ROWTYPE;
  v_student            public.profiles%ROWTYPE;
  v_staff_fails        integer;
  v_order_fails        integer;
  v_manual_count       integer;
  v_item_count         integer;
  v_is_amber           boolean;
  v_window             bigint;
  v_code_curr          text;
  v_code_prev          text;
  v_expected_pin       text;
  v_items              jsonb;
  v_first_name         text;
  v_college_id_last4   text;
  v_code_valid         boolean := false;
  v_pin_valid          boolean := false;
  v_clean_reason       text;
BEGIN
  -- 1. Authorization checks
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only staff or administrators may collect orders';
  END IF;

  IF p_collected_with NOT IN ('CASH', 'UPI') THEN
    RAISE EXCEPTION 'INVALID_INPUT: collected_with must be CASH or UPI';
  END IF;

  IF p_method NOT IN ('SCAN', 'PIN', 'MANUAL') THEN
    RAISE EXCEPTION 'INVALID_INPUT: method must be SCAN, PIN, or MANUAL';
  END IF;

  -- 2. Lock Order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  IF v_caller.role = 'staff'::public.user_role AND (v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM v_order.canteen_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
  END IF;

  -- 3. Check Status
  IF v_order.status = 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_COLLECTED');
  END IF;

  IF v_order.status <> 'READY'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_READY', 'status', v_order.status);
  END IF;

  -- 4. Rate-limit checks
  SELECT count(*) INTO v_staff_fails
  FROM public.pickup_verify_attempts
  WHERE user_id = v_user_id
    AND attempted_at >= now() - interval '5 minutes';

  IF v_staff_fails >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  END IF;

  SELECT count(*) INTO v_order_fails
  FROM public.pickup_verify_attempts
  WHERE order_id = v_order.id
    AND attempted_at >= now() - interval '10 minutes';

  IF v_order_fails >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  END IF;

  -- 5. Calculate Amber state
  SELECT coalesce(sum(quantity), 0) INTO v_item_count
  FROM public.order_items
  WHERE order_id = v_order.id;

  v_is_amber := (v_item_count > 5 OR v_order.total_paise > 50000);

  -- 6. Method-specific verification
  IF p_method = 'MANUAL' THEN
    -- MANUAL requires reason >= 5 characters, capped at 10 per staff per 24 hours
    v_clean_reason := trim(p_reason);
    IF v_clean_reason IS NULL OR length(v_clean_reason) < 5 THEN
      RAISE EXCEPTION 'INVALID_INPUT: Manual collection requires a reason of at least 5 characters';
    END IF;

    SELECT count(*) INTO v_manual_count
    FROM public.orders
    WHERE collected_by = v_user_id
      AND collection_method = 'MANUAL'
      AND collected_at >= now() - interval '24 hours';

    IF v_manual_count >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MANUAL_LIMIT');
    END IF;

  ELSIF p_method = 'PIN' THEN
    -- PIN-only is refused for amber orders
    IF v_is_amber THEN
      RETURN jsonb_build_object('ok', false, 'error', 'AMBER_REQUIRES_CODE_AND_PIN');
    END IF;

    SELECT * INTO v_secret_rec
    FROM public.order_pickup_secrets
    WHERE order_id = v_order.id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SECRET_NOT_FOUND');
    END IF;

    IF v_secret_rec.failed_pin_attempts >= 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;

    v_expected_pin := public.internal_get_pickup_pin(v_order.id);

    IF p_pin IS NULL OR trim(p_pin) <> v_expected_pin THEN
      UPDATE public.order_pickup_secrets
      SET failed_pin_attempts = failed_pin_attempts + 1
      WHERE order_id = v_order.id;

      INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
      VALUES (v_user_id, v_order.canteen_id, v_order.id);

      IF v_secret_rec.failed_pin_attempts + 1 >= 3 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
      END IF;

      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PIN');
    END IF;

  ELSE -- p_method = 'SCAN'
    SELECT * INTO v_secret_rec
    FROM public.order_pickup_secrets
    WHERE order_id = v_order.id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SECRET_NOT_FOUND');
    END IF;

    IF v_secret_rec.failed_pin_attempts >= 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
    END IF;

    v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
    v_code_curr := public.internal_get_pickup_code(v_order.id, v_window);
    v_code_prev := public.internal_get_pickup_code(v_order.id, v_window - 1);
    v_expected_pin := public.internal_get_pickup_pin(v_order.id);

    IF p_code IS NOT NULL AND trim(p_code) IN (v_code_curr, v_code_prev) THEN
      v_code_valid := true;
    END IF;

    IF p_pin IS NOT NULL AND trim(p_pin) = v_expected_pin THEN
      v_pin_valid := true;
    END IF;

    IF NOT v_code_valid THEN
      INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
      VALUES (v_user_id, v_order.canteen_id, v_order.id);
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
    END IF;

    IF v_is_amber THEN
      IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
        INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
        VALUES (v_user_id, v_order.canteen_id, v_order.id);
        RETURN jsonb_build_object('ok', false, 'error', 'PIN_REQUIRED');
      END IF;

      IF NOT v_pin_valid THEN
        UPDATE public.order_pickup_secrets
        SET failed_pin_attempts = failed_pin_attempts + 1
        WHERE order_id = v_order.id;

        INSERT INTO public.pickup_verify_attempts (user_id, canteen_id, order_id)
        VALUES (v_user_id, v_order.canteen_id, v_order.id);

        IF v_secret_rec.failed_pin_attempts + 1 >= 3 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'PIN_LOCKED');
        END IF;

        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PIN');
      END IF;
    END IF;
  END IF;

  -- 7. Execute Collection & Record Settlement
  UPDATE public.orders
  SET status = 'COLLECTED'::public.order_status,
      collected_at = coalesce(collected_at, now()),
      payment_status = 'PAID'::public.payment_status,
      collected_with = p_collected_with,
      collection_method = p_method,
      collected_by = v_user_id,
      manual_collection_reason = CASE WHEN p_method = 'MANUAL' THEN v_clean_reason ELSE NULL END
  WHERE id = v_order.id;

  -- 8. If MANUAL, dispatch an explicit alert notification to student
  IF p_method = 'MANUAL' THEN
    INSERT INTO public.notifications (
      user_id,
      order_id,
      title,
      body
    ) VALUES (
      v_order.user_id,
      v_order.id,
      'Order Collected (Manual Override)',
      'Your order #' || v_order.order_code || ' was collected via staff manual override. Reason: ' || v_clean_reason
    );
  END IF;

  -- 9. Write Admin Audit Log entry
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_user_id,
    'COLLECT_ORDER',
    'order',
    v_order.id,
    jsonb_build_object(
      'order_code', v_order.order_code,
      'total_paise', v_order.total_paise,
      'collected_with', p_collected_with,
      'collection_method', p_method,
      'is_amber', v_is_amber,
      'manual_reason', CASE WHEN p_method = 'MANUAL' THEN v_clean_reason ELSE NULL END
    )
  );

  -- 10. Load student details for return card
  SELECT * INTO v_student
  FROM public.profiles
  WHERE id = v_order.user_id;

  v_first_name := split_part(trim(coalesce(v_student.full_name, 'Student')), ' ', 1);
  v_college_id_last4 := right(coalesce(v_student.college_id, ''), 4);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
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
    'first_name', v_first_name,
    'college_id_last4', v_college_id_last4,
    'pickup_for_name', v_order.pickup_for_name,
    'total_paise', v_order.total_paise,
    'collected_with', p_collected_with,
    'collection_method', p_method,
    'items', coalesce(v_items, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.collect_order(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_order(uuid, text, text, text, text, text) TO authenticated, service_role;

-- 11. REDEFINE public.transition_order: REFUSE COLLECTED
-- Ensures orders can only be collected via public.collect_order.
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

  -- Refuse COLLECTED: collection must occur exclusively through public.collect_order()
  IF p_to_status = 'COLLECTED'::public.order_status THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Orders cannot be directly transitioned to COLLECTED. Use public.collect_order instead.';
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

  -- 6. State Machine Transition Rules (COLLECTED removed)
  IF v_order.status = 'PLACED'::public.order_status AND p_to_status IN ('ACCEPTED'::public.order_status, 'REJECTED'::public.order_status) THEN
    NULL;
  ELSIF v_order.status = 'ACCEPTED'::public.order_status AND p_to_status = 'PREPARING'::public.order_status THEN
    NULL;
  ELSIF v_order.status = 'PREPARING'::public.order_status AND p_to_status = 'READY'::public.order_status THEN
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

    -- Restore stock on rejection
    PERFORM id
    FROM public.menu_items
    WHERE id IN (
      SELECT menu_item_id
      FROM public.order_items
      WHERE order_id = v_order.id
    )
    FOR UPDATE;

    UPDATE public.menu_items m
    SET stock = m.stock + sub.total_qty
    FROM (
      SELECT menu_item_id, SUM(quantity)::integer AS total_qty
      FROM public.order_items
      WHERE order_id = v_order.id
      GROUP BY menu_item_id
    ) sub
    WHERE m.id = sub.menu_item_id
      AND m.stock IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', p_to_status,
    'was_noop', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_order(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) TO authenticated, service_role;

-- 12. REDEFINE public.place_order: DROP OLD SIGNATURE & CREATE NEW ONE
-- Drops 5-arg signature and adds p_pickup_for_name, inserts secret, removes static token loop.
REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.place_order(uuid, jsonb, public.payment_method, text, timestamptz);

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
  v_clean_pickup_name text;

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

  -- 4. Sanitize pickup_for_name (control chars stripped, max 40 chars)
  IF p_pickup_for_name IS NOT NULL THEN
    v_clean_pickup_name := trim(regexp_replace(p_pickup_for_name, '[\x00-\x1F\x7F]+', ' ', 'g'));
    v_clean_pickup_name := regexp_replace(v_clean_pickup_name, '\s+', ' ', 'g');
    IF length(v_clean_pickup_name) = 0 THEN
      v_clean_pickup_name := NULL;
    ELSIF length(v_clean_pickup_name) > 40 THEN
      v_clean_pickup_name := substr(v_clean_pickup_name, 1, 40);
    END IF;
  ELSE
    v_clean_pickup_name := NULL;
  END IF;

  -- 5. Preliminary Idempotency Check (fast return if already placed)
  SELECT 
    o.id, o.order_code, o.status, o.total_paise, 
    o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at,
    o.pickup_for_name
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
      'pickup_for_name', v_existing_order.pickup_for_name,
      'was_duplicate', true
    );
  END IF;

  -- 6. Items Payload Validation & Aggregation
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
    COUNT(*)::integer
  INTO v_agg_items, v_distinct_count
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

  -- 7. Canteen Lock
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

  -- 8. RE-CHECK Idempotency immediately after acquiring the canteen row lock
  SELECT 
    o.id, o.order_code, o.status, o.total_paise, 
    o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at,
    o.pickup_for_name
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
      'pickup_for_name', v_existing_order.pickup_for_name,
      'was_duplicate', true
    );
  END IF;

  -- 9. Active Orders Limit Check
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

  -- 10. Lock Menu Items FOR UPDATE ordered by id
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

  -- 11. Dynamic Pickup Estimation
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

  -- 12. Generate 64-char hex secret from two gen_random_uuid() values (zero extension dependency)
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  -- 13. Atomic Sub-Block: Decrement stock, insert order & items & secret
  BEGIN
    -- 13.1 Decrement stock for tracked items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_agg_items) LOOP
      v_item_id := (v_item.value->>'menu_item_id')::uuid;
      v_qty := (v_item.value->>'quantity')::integer;

      UPDATE public.menu_items
      SET stock = stock - v_qty
      WHERE id = v_item_id AND stock IS NOT NULL;
    END LOOP;

    -- 13.2 Insert Order (pickup_token is explicitly NULL)
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
      v_clean_pickup_name,
      p_idempotency_key,
      p_requested_at,
      v_est_record.estimated_ready_at,
      v_est_record.pickup_window_end,
      v_est_record.prep_minutes_total,
      clock_timestamp()
    )
    RETURNING id, order_code INTO v_order_id, v_order_code;

    -- 13.3 Insert Order Items
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

    -- 13.4 Insert Secret in order_pickup_secrets
    INSERT INTO public.order_pickup_secrets (
      order_id,
      secret,
      failed_pin_attempts
    ) VALUES (
      v_order_id,
      v_secret,
      0
    );

    -- 13.5 Insert Notification
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
        o.estimated_ready_at, o.pickup_window_end, o.requested_pickup_at,
        o.pickup_for_name
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
          'pickup_for_name', v_existing_order.pickup_for_name,
          'was_duplicate', true
        );
      END IF;

      RAISE;
  END;

  -- 14. Return Success Payload
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'status', 'PLACED',
    'total_paise', v_total_paise,
    'estimated_ready_at', v_est_record.estimated_ready_at,
    'pickup_window_end', v_est_record.pickup_window_end,
    'requested_pickup_at', p_requested_at,
    'pickup_for_name', v_clean_pickup_name,
    'was_duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, jsonb, public.payment_method, text, timestamptz, text) TO authenticated, service_role;

-- 13. REVOKE & DROP verify_pickup AND NULLIFY pickup_token
REVOKE ALL ON FUNCTION public.verify_pickup(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.verify_pickup(uuid, text);

UPDATE public.orders
SET pickup_token = NULL
WHERE pickup_token IS NOT NULL;

-- 14. BACKFILL SECRETS FOR EXISTING ACTIVE/IN-FLIGHT ORDERS
INSERT INTO public.order_pickup_secrets (order_id, secret, failed_pin_attempts)
SELECT 
  o.id, 
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  0
FROM public.orders o
WHERE o.status NOT IN ('COLLECTED'::public.order_status, 'CANCELLED'::public.order_status, 'REJECTED'::public.order_status)
ON CONFLICT (order_id) DO NOTHING;

-- 15. UPDATE ORDER STATUS NOTIFICATION TRIGGER FUNCTION TO INCLUDE COLLECTED
CREATE OR REPLACE FUNCTION public.handle_order_status_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
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
      v_body  := 'Your order #' || NEW.order_code || ' was marked as collected. If this was not you, tap to report it in your order details within 24 hours.';

    WHEN 'REJECTED'::public.order_status THEN
      v_title := 'Order Rejected';
      v_body  := 'Your order was rejected by the canteen.';

    ELSE
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

-- 16. STUDENT PROCEDURE: public.report_unauthorized_collection ("Not me")
-- Allows students to dispute an order marked COLLECTED within 24h, capped at 3 per 30 rolling days.
CREATE OR REPLACE FUNCTION public.report_unauthorized_collection(
  p_order_id uuid,
  p_reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_caller       public.profiles%ROWTYPE;
  v_order        public.orders%ROWTYPE;
  v_clean_reason text;
  v_recent_reps  integer;
  v_report_id    uuid;
BEGIN
  -- 1. Verify caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only students may file unauthorized collection reports';
  END IF;

  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Reason must be at least 5 characters long';
  END IF;

  -- 2. Load order and verify ownership & status
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_order.user_id <> v_user_id THEN
    RAISE EXCEPTION 'NOT_FOUND: Order not found';
  END IF;

  IF v_order.status <> 'COLLECTED'::public.order_status THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COLLECTED');
  END IF;

  -- 3. 24-hour collection reporting window
  IF v_order.collected_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REPORT_WINDOW_EXPIRED');
  END IF;

  -- 4. Check if already reported
  IF EXISTS (SELECT 1 FROM public.order_collection_reports WHERE order_id = p_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REPORTED');
  END IF;

  -- 5. Rolling 30-day report cap (max 3 reports per student)
  SELECT count(*) INTO v_recent_reps
  FROM public.order_collection_reports
  WHERE reporter_id = v_user_id
    AND reported_at >= now() - interval '30 days';

  IF v_recent_reps >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REPORT_LIMIT_EXCEEDED');
  END IF;

  -- 6. Insert Report
  INSERT INTO public.order_collection_reports (
    order_id,
    reporter_id,
    canteen_id,
    reason
  ) VALUES (
    v_order.id,
    v_user_id,
    v_order.canteen_id,
    v_clean_reason
  )
  RETURNING id INTO v_report_id;

  -- 7. Audit log row
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_user_id,
    'REPORT_UNAUTHORIZED_COLLECTION',
    'order_collection_report',
    v_report_id,
    jsonb_build_object(
      'order_id', v_order.id,
      'order_code', v_order.order_code,
      'reason', v_clean_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', v_report_id,
    'order_id', v_order.id,
    'reported_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_unauthorized_collection(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_unauthorized_collection(uuid, text) TO authenticated, service_role;

-- 17. ADMIN PROCEDURES: LIST & RESOLVE COLLECTION DISPUTE REPORTS
CREATE OR REPLACE FUNCTION public.admin_list_collection_reports(
  p_status text DEFAULT 'all',
  p_limit  integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_caller       public.profiles%ROWTYPE;
  v_reports      jsonb;
  v_total        integer;
  v_clamped_lim  integer;
  v_clamped_off  integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may list collection reports';
  END IF;

  v_clamped_lim := GREATEST(1, LEAST(coalesce(p_limit, 20), 100));
  v_clamped_off := GREATEST(0, coalesce(p_offset, 0));

  SELECT count(*) INTO v_total
  FROM public.order_collection_reports r
  WHERE (p_status = 'all' OR r.status = p_status);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'order_id', r.order_id,
      'order_code', o.order_code,
      'canteen_id', r.canteen_id,
      'canteen_name', c.name,
      'reporter_id', r.reporter_id,
      'reporter_name', p.full_name,
      'reported_at', r.reported_at,
      'status', r.status,
      'reason', r.reason,
      'admin_note', r.admin_note,
      'resolved_at', r.resolved_at,
      'resolved_by', r.resolved_by,
      'order_total_paise', o.total_paise,
      'collected_at', o.collected_at,
      'collected_with', o.collected_with,
      'collection_method', o.collection_method
    )
    ORDER BY r.reported_at DESC
  ) INTO v_reports
  FROM (
    SELECT *
    FROM public.order_collection_reports
    WHERE (p_status = 'all' OR status = p_status)
    ORDER BY reported_at DESC
    LIMIT v_clamped_lim OFFSET v_clamped_off
  ) r
  JOIN public.orders o ON o.id = r.order_id
  JOIN public.canteens c ON c.id = r.canteen_id
  LEFT JOIN public.profiles p ON p.id = r.reporter_id;

  RETURN jsonb_build_object(
    'reports', coalesce(v_reports, '[]'::jsonb),
    'total_count', v_total,
    'limit', v_clamped_lim,
    'offset', v_clamped_off
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_collection_reports(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_collection_reports(text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_collection_report(
  p_report_id  uuid,
  p_resolution text,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id      uuid;
  v_caller       public.profiles%ROWTYPE;
  v_report       public.order_collection_reports%ROWTYPE;
  v_clean_note   text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile not found or inactive';
  END IF;

  IF v_caller.role <> 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may resolve collection reports';
  END IF;

  IF p_resolution NOT IN ('INVESTIGATING', 'RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'INVALID_INPUT: Resolution status must be INVESTIGATING, RESOLVED, or DISMISSED';
  END IF;

  v_clean_note := trim(p_admin_note);

  SELECT * INTO v_report
  FROM public.order_collection_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Collection report % not found', p_report_id;
  END IF;

  UPDATE public.order_collection_reports
  SET status = p_resolution,
      admin_note = v_clean_note,
      resolved_at = CASE WHEN p_resolution IN ('RESOLVED', 'DISMISSED') THEN now() ELSE NULL END,
      resolved_by = CASE WHEN p_resolution IN ('RESOLVED', 'DISMISSED') THEN v_user_id ELSE NULL END
  WHERE id = p_report_id;

  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_user_id,
    'RESOLVE_COLLECTION_REPORT',
    'order_collection_report',
    p_report_id,
    jsonb_build_object(
      'resolution', p_resolution,
      'admin_note', v_clean_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'status', p_resolution,
    'resolved_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_collection_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_collection_report(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
