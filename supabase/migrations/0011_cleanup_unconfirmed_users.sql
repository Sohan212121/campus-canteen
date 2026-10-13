-- =============================================================================
-- Migration: 0011_cleanup_unconfirmed_users.sql
-- Description: Cleanup routine for stale, unconfirmed registrations (e.g. > 48h).
--              Frees held college_id values and unconfirmed email records.
--
-- Architecture & Trade-Off Note (Scheduler vs Admin Procedure):
--   * An explicit admin-callable SECURITY DEFINER routine is chosen over an
--     in-database pg_cron background worker.
--   * Trade-offs:
--       1. Portability: pg_cron requires the pg_cron extension to be pre-installed
--          and enabled in postgresql.conf (often restricted on standard cloud tiers).
--       2. Auditing: In-database cron runs as background superuser with no caller
--          session context (auth.uid() is null). An admin-callable procedure allows
--          explicit audit logging with the actor's profile ID in admin_audit_log.
--       3. Automation: This procedure can be triggered automatically via an external
--          scheduled runner (e.g., Vercel Cron or GitHub Actions calling a Next.js
--          secured route handler using the service role) or run manually by an admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_cleanup_unconfirmed_users(
  p_older_than interval DEFAULT interval '48 hours'
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id       uuid;
  v_caller          public.profiles%ROWTYPE;
  v_deleted_ids     uuid[] := ARRAY[]::uuid[];
  v_deleted_count   integer := 0;
BEGIN
  -- 1. Authorisation: Allow active admin or service_role
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL THEN
    SELECT * INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR v_caller.is_active = false THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
    END IF;

    IF v_caller.role != 'admin'::public.user_role THEN
      RAISE EXCEPTION 'FORBIDDEN: Only administrators may clean up unconfirmed accounts';
    END IF;
  ELSE
    -- If called without an auth.uid(), verify current_user is service_role or postgres
    IF current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: Operation requires administrator authentication or service role';
    END IF;
  END IF;

  -- 2. Identify candidate unconfirmed users:
  -- - Email not confirmed (email_confirmed_at IS NULL)
  -- - Created older than specified interval (default 48 hours)
  -- - Safety: Zero orders (orders.user_id has ON DELETE RESTRICT)
  -- - Safety: Zero reviews (item_reviews.user_id)
  -- - Safety: Zero admin audit log actions (admin_audit_log.actor_id)
  -- - Safety: Zero allowed domain additions (allowed_email_domains.created_by)
  -- - Safety: Zero notifications (notifications.user_id)
  SELECT coalesce(array_agg(u.id), ARRAY[]::uuid[])
  INTO v_deleted_ids
  FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < (now() - p_older_than)
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.item_reviews r WHERE r.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_audit_log a WHERE a.actor_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.allowed_email_domains d WHERE d.created_by = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n WHERE n.user_id = u.id
    );

  v_deleted_count := coalesce(cardinality(v_deleted_ids), 0);

  -- 3. Perform deletion if targets found
  IF v_deleted_count > 0 THEN
    -- Deleting from auth.users cascades to public.profiles via FK ON DELETE CASCADE,
    -- which cleanly frees the unique college_id constraint index.
    DELETE FROM auth.users
    WHERE id = ANY(v_deleted_ids);

    -- 4. Audit log
    IF v_caller_id IS NOT NULL THEN
      INSERT INTO public.admin_audit_log (
        actor_id,
        action,
        target_type,
        target_id,
        details
      ) VALUES (
        v_caller_id,
        'CLEANUP_UNCONFIRMED_USERS',
        'auth_users',
        'batch',
        jsonb_build_object(
          'deleted_count', v_deleted_count,
          'older_than_interval', p_older_than::text,
          'deleted_ids', v_deleted_ids
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'deleted_user_ids', v_deleted_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_unconfirmed_users(interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_unconfirmed_users(interval) TO authenticated, service_role;
