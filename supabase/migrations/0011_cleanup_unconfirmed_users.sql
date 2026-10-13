-- =============================================================================
-- Migration: 0011_cleanup_unconfirmed_users.sql
-- Description: Cleanup routine for stale, unconfirmed registrations (e.g. > 48h).
--              Frees held college_id values and unconfirmed email records.
--
-- Enhancements:
--   * Excludes any user with invited_at IS NOT NULL (e.g. invited staff/admin).
--   * Excludes any user whose profile role is 'staff' or 'admin'.
--   * Adds p_dry_run boolean DEFAULT true: inspects candidates without deleting,
--     returning candidate count, id, email domain only, and created_at.
--   * Caps live deletions at 200 users per run and reports remaining candidates.
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

DROP FUNCTION IF EXISTS public.admin_cleanup_unconfirmed_users(interval);
DROP FUNCTION IF EXISTS public.admin_cleanup_unconfirmed_users(interval, boolean);

CREATE OR REPLACE FUNCTION public.admin_cleanup_unconfirmed_users(
  p_older_than interval DEFAULT interval '48 hours',
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id       uuid;
  v_caller          public.profiles%ROWTYPE;
  c_batch_limit     constant integer := 200;
  v_total_count     integer := 0;
  v_batch_ids       uuid[] := ARRAY[]::uuid[];
  v_candidates_json jsonb := '[]'::jsonb;
  v_deleted_count   integer := 0;
  v_remaining_count integer := 0;
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

  -- 2. DRY RUN MODE: Return candidate metadata without deleting any rows
  IF p_dry_run THEN
    SELECT
      count(*),
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', sub.id,
            'email_domain', split_part(coalesce(sub.email, ''), '@', 2),
            'created_at', sub.created_at
          ) ORDER BY sub.created_at ASC
        ),
        '[]'::jsonb
      )
    INTO v_total_count, v_candidates_json
    FROM (
      SELECT u.id, u.email, u.created_at
      FROM auth.users u
      WHERE u.email_confirmed_at IS NULL
        AND u.created_at < (now() - p_older_than)
        AND u.invited_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = u.id AND p.role IN ('staff'::public.user_role, 'admin'::public.user_role)
        )
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
        )
    ) sub;

    v_remaining_count := GREATEST(0, v_total_count - c_batch_limit);

    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'candidate_count', v_total_count,
      'candidates', v_candidates_json,
      'remaining_count', v_remaining_count
    );
  END IF;

  -- 3. LIVE DELETION MODE (p_dry_run = false)
  -- 3a. Count total matching candidates across database
  SELECT count(*)
  INTO v_total_count
  FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < (now() - p_older_than)
    AND u.invited_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = u.id AND p.role IN ('staff'::public.user_role, 'admin'::public.user_role)
    )
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

  -- 3b. Select up to 200 oldest candidate IDs for batch deletion
  SELECT coalesce(array_agg(sub.id), ARRAY[]::uuid[])
  INTO v_batch_ids
  FROM (
    SELECT u.id
    FROM auth.users u
    WHERE u.email_confirmed_at IS NULL
      AND u.created_at < (now() - p_older_than)
      AND u.invited_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = u.id AND p.role IN ('staff'::public.user_role, 'admin'::public.user_role)
      )
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
      )
    ORDER BY u.created_at ASC
    LIMIT c_batch_limit
  ) sub;

  v_deleted_count := coalesce(cardinality(v_batch_ids), 0);
  v_remaining_count := GREATEST(0, v_total_count - v_deleted_count);

  -- 3c. Perform deletion if targets found
  IF v_deleted_count > 0 THEN
    -- Deleting from auth.users cascades to public.profiles via FK ON DELETE CASCADE,
    -- which cleanly frees the unique college_id constraint index.
    DELETE FROM auth.users
    WHERE id = ANY(v_batch_ids);

    -- 3d. Audit log
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
          'remaining_count', v_remaining_count,
          'total_candidates', v_total_count,
          'batch_limit', c_batch_limit,
          'older_than_interval', p_older_than::text,
          'deleted_ids', v_batch_ids
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'deleted_count', v_deleted_count,
    'remaining_count', v_remaining_count,
    'deleted_user_ids', v_batch_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_unconfirmed_users(interval, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_unconfirmed_users(interval, boolean) TO authenticated, service_role;
