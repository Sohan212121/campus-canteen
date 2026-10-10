-- =============================================================================
-- Migration 0006: Admin Operations, User Management & Analytics
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Table: public.admin_audit_log (Audit trail for administrative operations)
-- 2. Procedure: public.admin_set_user_role(p_user_id uuid, p_role public.user_role, p_canteen_id uuid)
-- 3. Procedure: public.admin_set_user_active(p_user_id uuid, p_active boolean)
-- 4. Procedure: public.admin_update_canteen_settings(...)
-- 5. Procedure: public.admin_dashboard_stats(p_from timestamptz, p_to timestamptz)
-- 6. Procedure: public.admin_list_orders(...)
-- 7. Procedure: public.admin_list_users(...)
-- 8. Storage: public bucket 'menu-images' and object policies
-- 9. Permissions & Schema Reload
-- =============================================================================

-- =============================================================================
-- 1. TABLE: public.admin_audit_log
-- =============================================================================
-- Immutable record of administrative mutations.
-- actor_id is nullable ON DELETE SET NULL so historical audit entries persist
-- even if an admin user profile is deleted in the future.
-- Protected by RLS with zero user-facing policies; written strictly by SECURITY DEFINER routines.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
  ON public.admin_audit_log(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON public.admin_audit_log(target_type, target_id, created_at DESC);


-- =============================================================================
-- 2. PROCEDURE: public.admin_set_user_role
-- =============================================================================
-- Changes user role and canteen association.
--
-- Security:
--   * Caller must be authenticated active administrator.
--   * Caller cannot modify their own role (CANNOT_MODIFY_SELF).
--   * Cannot demote the last remaining active administrator (LAST_ADMIN).
--   * Enforces staff canteen assignment (staff requires valid canteen_id;
--     student and admin set canteen_id to NULL).
--   * Note: prevent_profile_escalation trigger does NOT block this SECURITY DEFINER
--     function because current_user is the database owner, not 'authenticated' or 'anon'.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role public.user_role,
  p_canteen_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id    uuid;
  v_caller       public.profiles%ROWTYPE;
  v_target       public.profiles%ROWTYPE;
  v_admin_count  integer;
  v_canteen_ok   boolean;
  v_new_canteen  uuid;
BEGIN
  -- 1. Verify authenticated caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Verify caller is active admin
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
  END IF;

  IF v_caller.role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may change user roles';
  END IF;

  -- 3. Self-modification guard
  IF p_user_id = v_caller_id THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_SELF: Administrators cannot change their own role';
  END IF;

  -- 4. Load target user profile
  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Target user does not exist';
  END IF;

  -- 5. Last-admin protection:
  -- Lock active admin rows to prevent concurrent transactions from demoting
  -- the last two active administrators simultaneously down to zero.
  IF v_target.role = 'admin'::public.user_role AND p_role != 'admin'::public.user_role AND v_target.is_active = true THEN
    PERFORM id
    FROM public.profiles
    WHERE role = 'admin'::public.user_role AND is_active = true
    ORDER BY id
    FOR UPDATE;

    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin'::public.user_role AND is_active = true;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'LAST_ADMIN: Cannot demote the last remaining active administrator';
    END IF;
  END IF;

  -- 6. Validate role and canteen assignment
  IF p_role = 'staff'::public.user_role THEN
    IF p_canteen_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT: Staff members must be assigned to an existing canteen';
    END IF;

    SELECT exists(SELECT 1 FROM public.canteens WHERE id = p_canteen_id) INTO v_canteen_ok;
    IF NOT v_canteen_ok THEN
      RAISE EXCEPTION 'INVALID_INPUT: Specified canteen does not exist';
    END IF;

    v_new_canteen := p_canteen_id;
  ELSE
    -- student and admin roles must have NULL canteen_id
    v_new_canteen := NULL;
  END IF;

  -- 7. Update target profile
  -- Note: prevent_profile_escalation trigger allows this change because current_user
  -- is not 'authenticated' or 'anon' inside this SECURITY DEFINER procedure.
  UPDATE public.profiles
  SET role = p_role,
      canteen_id = v_new_canteen,
      updated_at = now()
  WHERE id = p_user_id;

  -- 8. Write audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    'SET_USER_ROLE',
    'user',
    p_user_id::text,
    jsonb_build_object(
      'previous_role', v_target.role,
      'new_role', p_role,
      'previous_canteen_id', v_target.canteen_id,
      'new_canteen_id', v_new_canteen
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'role', p_role,
    'canteen_id', v_new_canteen
  );
END;
$$;


-- =============================================================================
-- 3. PROCEDURE: public.admin_set_user_active
-- =============================================================================
-- Activates or deactivates a user account.
--
-- Security:
--   * Caller must be active administrator.
--   * Caller cannot deactivate their own account (CANNOT_MODIFY_SELF).
--   * Cannot deactivate the last remaining active administrator (LAST_ADMIN).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_user_id uuid,
  p_active boolean
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id    uuid;
  v_caller       public.profiles%ROWTYPE;
  v_target       public.profiles%ROWTYPE;
  v_admin_count  integer;
BEGIN
  -- 1. Verify authenticated caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Verify caller is active admin
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
  END IF;

  IF v_caller.role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may toggle user active status';
  END IF;

  -- 3. Self-deactivation guard
  IF p_user_id = v_caller_id AND p_active = false THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_SELF: Administrators cannot deactivate their own account';
  END IF;

  -- 4. Load target user profile
  SELECT * INTO v_target
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Target user does not exist';
  END IF;

  -- 5. Last-admin protection:
  -- Lock active admin rows to prevent race conditions when deactivating administrators.
  IF v_target.role = 'admin'::public.user_role AND v_target.is_active = true AND p_active = false THEN
    PERFORM id
    FROM public.profiles
    WHERE role = 'admin'::public.user_role AND is_active = true
    ORDER BY id
    FOR UPDATE;

    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin'::public.user_role AND is_active = true;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'LAST_ADMIN: Cannot deactivate the last remaining active administrator';
    END IF;
  END IF;

  -- 6. Update user active status
  UPDATE public.profiles
  SET is_active = p_active,
      updated_at = now()
  WHERE id = p_user_id;

  -- 7. Write audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    CASE WHEN p_active THEN 'REACTIVATE_USER' ELSE 'DEACTIVATE_USER' END,
    'user',
    p_user_id::text,
    jsonb_build_object(
      'previous_active', v_target.is_active,
      'new_active', p_active
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_active', p_active
  );
END;
$$;


-- =============================================================================
-- 4. PROCEDURE: public.admin_update_canteen_settings
-- =============================================================================
-- Updates operational parameters and schedule hours for a canteen.
--
-- Security & Validation:
--   * Caller must be active administrator.
--   * Validates capacity (1..50), lead minutes (0..120), hold minutes (0..120).
--   * Validates closing time > opening time.
--   * Validates last order time between opening and closing times.
--   * Returns clean INVALID_INPUT errors.
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
  v_caller_id    uuid;
  v_caller       public.profiles%ROWTYPE;
  v_canteen      public.canteens%ROWTYPE;
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may update canteen settings';
  END IF;

  -- 2. Range & Time Validations
  IF p_kitchen_capacity < 1 OR p_kitchen_capacity > 50 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Kitchen capacity must be between 1 and 50 units';
  END IF;

  IF p_min_lead_minutes < 0 OR p_min_lead_minutes > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Minimum lead buffer must be between 0 and 120 minutes';
  END IF;

  IF p_hold_minutes < 0 OR p_hold_minutes > 120 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Hold window must be between 0 and 120 minutes';
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
    'UPDATE_CANTEEN_SETTINGS',
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
    'success', true,
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


-- =============================================================================
-- 5. PROCEDURE: public.admin_dashboard_stats
-- =============================================================================
-- Computes aggregated operations & sales metrics for a specified time range.
--
-- Metrics computation semantics:
--   * Status counts & top items use order placed_at.
--   * Revenue uses order collected_at for COLLECTED orders only.
--   * Hourly orders return all 24 hours (0..23) in Asia/Kolkata timezone with zero fill.
--   * Range is strictly capped at 92 days.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats(
  p_from timestamptz,
  p_to timestamptz
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id         uuid;
  v_caller            public.profiles%ROWTYPE;
  v_orders_by_status  jsonb;
  v_revenue_paise     bigint;
  v_top_items         jsonb;
  v_orders_by_hour    jsonb;
  v_total_placed      bigint;
  v_total_cancelled   bigint;
  v_cancel_rate       numeric;
  v_avg_prep_mins     numeric;
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may view dashboard analytics';
  END IF;

  -- 2. Range Validation (max 92 days)
  IF p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_INPUT: End date must be greater than or equal to start date';
  END IF;

  IF (p_to - p_from) > interval '92 days' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Date range cannot exceed 92 days';
  END IF;

  -- 3. Orders by Status (filtered by placed_at)
  SELECT coalesce(
    jsonb_object_agg(status_val, cnt),
    '{}'::jsonb
  ) INTO v_orders_by_status
  FROM (
    SELECT status::text AS status_val, count(*)::bigint AS cnt
    FROM public.orders
    WHERE placed_at >= p_from AND placed_at <= p_to
    GROUP BY status
  ) s;

  -- 4. Revenue: sum of total_paise for COLLECTED orders filtered by collected_at
  SELECT coalesce(sum(total_paise), 0)::bigint
  INTO v_revenue_paise
  FROM public.orders
  WHERE status = 'COLLECTED'::public.order_status
    AND collected_at >= p_from AND collected_at <= p_to;

  -- 5. Top 10 Items by quantity (from order_items of non-cancelled/non-rejected orders placed in range)
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', item_name,
        'quantity', total_qty,
        'revenue_paise', total_rev
      )
    ),
    '[]'::jsonb
  ) INTO v_top_items
  FROM (
    SELECT 
      oi.name_snapshot AS item_name,
      sum(oi.quantity)::bigint AS total_qty,
      sum(oi.unit_price_paise * oi.quantity)::bigint AS total_rev
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.placed_at >= p_from AND o.placed_at <= p_to
      AND o.status NOT IN ('CANCELLED'::public.order_status, 'REJECTED'::public.order_status)
    GROUP BY oi.name_snapshot
    ORDER BY total_qty DESC
    LIMIT 10
  ) top_sub;

  -- 6. Orders by Hour in Asia/Kolkata (all 24 hours 0..23 with zero fill)
  SELECT jsonb_agg(
    jsonb_build_object(
      'hour', h.hr,
      'count', coalesce(oc.cnt, 0)
    )
    ORDER BY h.hr
  ) INTO v_orders_by_hour
  FROM generate_series(0, 23) AS h(hr)
  LEFT JOIN (
    SELECT 
      extract(hour FROM (placed_at AT TIME ZONE 'Asia/Kolkata'))::int AS hr,
      count(*)::bigint AS cnt
    FROM public.orders
    WHERE placed_at >= p_from AND placed_at <= p_to
    GROUP BY extract(hour FROM (placed_at AT TIME ZONE 'Asia/Kolkata'))::int
  ) oc ON oc.hr = h.hr;

  -- 7. Cancellation Rate
  SELECT 
    count(*)::bigint,
    count(*) FILTER (WHERE status = 'CANCELLED'::public.order_status)::bigint
  INTO v_total_placed, v_total_cancelled
  FROM public.orders
  WHERE placed_at >= p_from AND placed_at <= p_to;

  IF v_total_placed > 0 THEN
    v_cancel_rate := round((v_total_cancelled::numeric / v_total_placed::numeric) * 100, 2);
  ELSE
    v_cancel_rate := 0.00;
  END IF;

  -- 8. Average prep-to-ready duration in minutes
  SELECT coalesce(
    round(avg(extract(epoch FROM (ready_at - preparing_at)) / 60.0)::numeric, 1),
    0.0
  ) INTO v_avg_prep_mins
  FROM public.orders
  WHERE placed_at >= p_from AND placed_at <= p_to
    AND preparing_at IS NOT NULL
    AND ready_at IS NOT NULL;

  RETURN jsonb_build_object(
    'orders_by_status', v_orders_by_status,
    'revenue_paise', v_revenue_paise,
    'top_items', v_top_items,
    'orders_by_hour', v_orders_by_hour,
    'total_placed', v_total_placed,
    'total_cancelled', v_total_cancelled,
    'cancellation_rate', v_cancel_rate,
    'avg_prep_minutes', v_avg_prep_mins
  );
END;
$$;


-- =============================================================================
-- 6. PROCEDURE: public.admin_list_orders
-- =============================================================================
-- Returns paginated orders list with search and status filters.
--
-- Security Invariant:
--   * NEVER selects or exposes pickup_token.
--   * Escapes \, %, and _ with an explicit ESCAPE '\' clause.
--   * Clamps limit to 1..100 and offset to >= 0.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_from timestamptz,
  p_to timestamptz,
  p_status public.order_status[] DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id     uuid;
  v_caller        public.profiles%ROWTYPE;
  v_limit         integer;
  v_offset        integer;
  v_clean_search  text;
  v_total_count   bigint;
  v_orders_json   jsonb;
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may list orders';
  END IF;

  -- 2. Clamp limit (1..100) and offset (>= 0)
  v_limit := GREATEST(1, LEAST(coalesce(p_limit, 25), 100));
  v_offset := GREATEST(0, coalesce(p_offset, 0));

  -- 3. Sanitize and escape search string (escape \, %, _)
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_clean_search := replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', '\_');
  ELSE
    v_clean_search := NULL;
  END IF;

  -- 4. Count total matching orders
  SELECT count(*)
  INTO v_total_count
  FROM public.orders o
  LEFT JOIN public.profiles p ON p.id = o.user_id
  WHERE o.placed_at >= p_from AND o.placed_at <= p_to
    AND (p_status IS NULL OR o.status = ANY(p_status))
    AND (
      v_clean_search IS NULL
      OR o.order_code ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
      OR p.full_name ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
    );

  -- 5. Query matching rows (STRICT SECURITY INVARIANT: never select pickup_token)
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'order_code', q.order_code,
        'status', q.status,
        'total_paise', q.total_paise,
        'payment_method', q.payment_method,
        'payment_status', q.payment_status,
        'placed_at', q.placed_at,
        'estimated_ready_at', q.estimated_ready_at,
        'canteen_name', q.canteen_name,
        'student_name', q.student_name,
        'item_count', q.item_count
      )
    ),
    '[]'::jsonb
  ) INTO v_orders_json
  FROM (
    SELECT 
      o.id,
      o.order_code,
      o.status,
      o.total_paise,
      o.payment_method,
      o.payment_status,
      o.placed_at,
      o.estimated_ready_at,
      c.name AS canteen_name,
      coalesce(p.full_name, 'Unknown Student') AS student_name,
      (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id)::int AS item_count
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN public.canteens c ON c.id = o.canteen_id
    WHERE o.placed_at >= p_from AND o.placed_at <= p_to
      AND (p_status IS NULL OR o.status = ANY(p_status))
      AND (
        v_clean_search IS NULL
        OR o.order_code ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
        OR p.full_name ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
      )
    ORDER BY o.placed_at DESC
    LIMIT v_limit OFFSET v_offset
  ) q;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'orders', v_orders_json
  );
END;
$$;


-- =============================================================================
-- 7. PROCEDURE: public.admin_list_users
-- =============================================================================
-- Returns paginated users with joined email from auth.users.
--
-- Security:
--   * Caller must be active administrator.
--   * Returns email strictly from auth.users (necessitating SECURITY DEFINER).
--   * Escapes \, %, and _ with an explicit ESCAPE '\' clause.
--   * Clamps limit to 1..100 and offset to >= 0.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_role public.user_role DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id     uuid;
  v_caller        public.profiles%ROWTYPE;
  v_limit         integer;
  v_offset        integer;
  v_clean_search  text;
  v_total_count   bigint;
  v_users_json    jsonb;
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may list users';
  END IF;

  -- 2. Clamp limit (1..100) and offset (>= 0)
  v_limit := GREATEST(1, LEAST(coalesce(p_limit, 25), 100));
  v_offset := GREATEST(0, coalesce(p_offset, 0));

  -- 3. Sanitize and escape search
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_clean_search := replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', '\_');
  ELSE
    v_clean_search := NULL;
  END IF;

  -- 4. Count total matching users
  SELECT count(*)
  INTO v_total_count
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE (p_role IS NULL OR p.role = p_role)
    AND (
      v_clean_search IS NULL
      OR u.email ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
      OR p.full_name ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
      OR p.college_id ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
    );

  -- 5. Query matching users
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'email', q.email,
        'full_name', q.full_name,
        'college_id', q.college_id,
        'role', q.role,
        'canteen_id', q.canteen_id,
        'canteen_name', q.canteen_name,
        'is_active', q.is_active,
        'created_at', q.created_at
      )
    ),
    '[]'::jsonb
  ) INTO v_users_json
  FROM (
    SELECT 
      p.id,
      u.email,
      p.full_name,
      p.college_id,
      p.role,
      p.canteen_id,
      c.name AS canteen_name,
      p.is_active,
      p.created_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.canteens c ON c.id = p.canteen_id
    WHERE (p_role IS NULL OR p.role = p_role)
      AND (
        v_clean_search IS NULL
        OR u.email ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
        OR p.full_name ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
        OR p.college_id ILIKE ('%' || v_clean_search || '%') ESCAPE '\'
      )
    ORDER BY p.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) q;

  RETURN jsonb_build_object(
    'total_count', v_total_count,
    'users', v_users_json
  );
END;
$$;


-- =============================================================================
-- 8. STORAGE: Public bucket 'menu-images' & RLS Policies
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  2097152, -- 2 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Drop only our own policies on storage.objects
DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_admin_delete" ON storage.objects;

-- 1. Anyone may read objects in the menu-images bucket
CREATE POLICY "menu_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

-- 2. Only active administrators may upload objects to menu-images
CREATE POLICY "menu_images_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.is_admin()
  );

-- 3. Only active administrators may update objects in menu-images
CREATE POLICY "menu_images_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.is_admin()
  )
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.is_admin()
  );

-- 4. Only active administrators may delete objects in menu-images
CREATE POLICY "menu_images_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.is_admin()
  );


-- =============================================================================
-- 9. PERMISSIONS & SCHEMA RELOAD
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.user_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.user_role, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_canteen_settings(uuid, time, time, time, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_canteen_settings(uuid, time, time, time, integer, integer, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats(timestamptz, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_orders(timestamptz, timestamptz, public.order_status[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_orders(timestamptz, timestamptz, public.order_status[], text, integer, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_users(text, public.user_role, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, public.user_role, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
