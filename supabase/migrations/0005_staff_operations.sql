-- =============================================================================
-- Migration 0005: Staff Operations, Order Transitions & Pickup Verification
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Table: public.pickup_verify_attempts (Rate-limiting ledger for counter pickup)
-- 2. Procedure: public.transition_order(p_order_id uuid, p_to_status public.order_status)
-- 3. Procedure: public.verify_pickup(p_canteen_id uuid, p_token text)
-- 4. Procedure: public.set_item_availability(p_item_id uuid, p_is_available boolean)
-- 5. Permissions & Security Hardening
-- 6. PostgREST Schema Cache Reload
-- =============================================================================

-- =============================================================================
-- 1. TABLE: public.pickup_verify_attempts
-- =============================================================================
-- Stores failed pickup token verification attempts for brute-force mitigation.
-- Protected by RLS with zero user-facing policies: accessible strictly by
-- internal SECURITY DEFINER routines.

CREATE TABLE IF NOT EXISTS public.pickup_verify_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pickup_verify_attempts ENABLE ROW LEVEL SECURITY;

-- Zero public access: accessible exclusively by service_role and SECURITY DEFINER procedures
REVOKE ALL ON TABLE public.pickup_verify_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pickup_verify_attempts TO service_role;

CREATE INDEX IF NOT EXISTS idx_pickup_verify_attempts_lookup
  ON public.pickup_verify_attempts(user_id, attempted_at);


-- =============================================================================
-- 2. PROCEDURE: public.transition_order
-- =============================================================================
-- Advances order state along the physical kitchen workflow:
--   PLACED -> ACCEPTED or REJECTED
--   ACCEPTED -> PREPARING
--   PREPARING -> READY
--   READY -> COLLECTED
--
-- Security:
--   * Caller must be active authenticated user with role 'staff' or 'admin'.
--   * Staff must have matching canteen_id (NULL canteen_id is rejected with FORBIDDEN).
--   * Admin can act on orders across any canteen.
--
-- Behavior:
--   * Row lock acquired FOR UPDATE on orders.
--   * Same-status requests return was_noop = true (idempotent; double-taps safe).
--   * Invalid transition jumps raise INVALID_TRANSITION.
--   * Sets matching timestamp (accepted_at, preparing_at, ready_at, collected_at, rejected_at).
--   * On COLLECTED: if payment_method is PAY_AT_PICKUP, payment_status is marked PAID.
--   * On REJECTED: restores inventory stock (ordered row locks on menu_items).
--   * Notifications are created automatically by existing trigger trg_order_status_notification.
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

  IF v_caller.role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff or administrators may transition orders';
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
  IF v_caller.role = 'staff'::public.user_role THEN
    IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM v_order.canteen_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
    END IF;
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
    'order_code', v_order.order_code,
    'status', p_to_status,
    'was_noop', false
  );
END;
$$;


-- =============================================================================
-- 3. PROCEDURE: public.verify_pickup
-- =============================================================================
-- Verifies a student's pickup token against orders in status READY.
--
-- Security:
--   * Caller must be active staff assigned to p_canteen_id, or admin.
--   * Rate limited: 10+ failed attempts in 5 minutes raises RATE_LIMITED.
--   * On token miss: inserts failed attempt into pickup_verify_attempts and
--     returns { "found": false } (does not raise, so the failure row commits).
--   * On hit: returns order details, items, student name, total, and payment status.
--   * Does NOT alter order status (collection must use transition_order).
--   * Purges attempts older than 1 day to keep ledger compact.
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

  -- 2. Verify staff/admin role and canteen assignment
  SELECT *
  INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found or inactive';
  END IF;

  IF v_caller.role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff or administrators may verify pickup';
  END IF;

  IF v_caller.role = 'staff'::public.user_role THEN
    IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM p_canteen_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this canteen';
    END IF;
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
-- 4. PROCEDURE: public.set_item_availability
-- =============================================================================
-- Allows canteen staff to toggle item availability on the counter menu.
--
-- Security:
--   * Caller must be active staff assigned to the item's canteen, or admin.
--   * Compares canteen IDs with IS DISTINCT FROM.
--   * Updates exclusively is_available and updated_at.
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

  -- 2. Verify staff/admin profile
  SELECT *
  INTO v_caller
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User profile not found or inactive';
  END IF;

  IF v_caller.role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: Only canteen staff or administrators may update menu item availability';
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
  IF v_caller.role = 'staff'::public.user_role THEN
    IF v_caller.canteen_id IS NULL OR v_caller.canteen_id IS DISTINCT FROM v_item.canteen_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Staff member is not assigned to this item''s canteen';
    END IF;
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
-- 5. PERMISSIONS & SECURITY HARDENING
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid, public.order_status) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.verify_pickup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_item_availability(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_availability(uuid, boolean) TO authenticated, service_role;


-- =============================================================================
-- 6. RELOAD SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';
