-- =============================================================================
-- Migration: 0011_cleanup_unconfirmed_users.sql
-- Description: Cleanup routine for stale, unconfirmed registrations (e.g. > 48h).
--              Frees held college_id values and unconfirmed email records.
--
-- Enhancements (v2 Hardening):
--   * Authorisation: In SECURITY DEFINER, current_user switches to function owner (postgres).
--     When auth.uid() IS NULL, checks session_user IN ('postgres', 'service_role', 'supabase_admin')
--     OR coalesce(auth.role(), '') = 'service_role'. This rejects unauthenticated/anon callers.
--   * Validation: Rejects NULL or p_older_than below 24 hours with INVALID_INPUT.
--   * Candidate Protection:
--       - Excludes users with invited_at IS NOT NULL.
--       - Excludes users with (raw_app_meta_data->>'is_admin_created')::boolean = true.
--       - Excludes users with raw_app_meta_data role or profile role IN ('staff', 'admin').
--       - Excludes users with orders, reviews, audit logs, allowed domain creations, or notifications.
--   * Dry Run: Returns true candidate_count while capping candidates JSON at 200 rows.
--   * Batch Live Deletion: Caps deletions at 200 per run and returns remaining_count.
--   * Audit Logging: Always writes to admin_audit_log on live deletion, setting actor_id to
--     NULL with "sql editor or service role" noted in details when auth.uid() is null.
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
  -- 1. Input Validation: Reject NULL or intervals below 24 hours
  IF p_older_than IS NULL OR p_older_than < interval '24 hours' THEN
    RAISE EXCEPTION 'INVALID_INPUT: p_older_than must be specified and at least 24 hours';
  END IF;

  -- 2. Authorisation:
  -- When auth.uid() is present, verify caller is an active administrator.
  -- When auth.uid() is NULL:
  --   Note: Inside a SECURITY DEFINER routine, current_user is the function owner (postgres),
  --   so testing current_user never rejects unauthorized callers.
  --   Instead, session_user reflects the original connecting database user:
  --     - In Supabase SQL Editor: session_user is 'postgres' or 'supabase_admin'.
  --     - Under PostgREST (API calls): session_user is 'authenticator', and service-role requests
  --       set auth.role() = 'service_role'.
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
    IF session_user NOT IN ('postgres', 'service_role', 'supabase_admin')
       AND coalesce(auth.role(), '') != 'service_role' THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: Operation requires administrator authentication or service role';
    END IF;
  END IF;

  -- 3. DRY RUN MODE: Return candidate metadata without deleting any rows
  IF p_dry_run THEN
    -- 3a. True candidate count across database
    SELECT count(*)
    INTO v_total_count
    FROM auth.users u
    WHERE u.email_confirmed_at IS NULL
      AND u.created_at < (now() - p_older_than)
      AND u.invited_at IS NULL
      AND coalesce((u.raw_app_meta_data->>'is_admin_created')::boolean, false) = false
      AND coalesce(u.raw_app_meta_data->>'role', '') NOT IN ('staff', 'admin')
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

    -- 3b. Candidate array capped at c_batch_limit (200 rows)
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', sub.id,
          'email_domain', split_part(coalesce(sub.email, ''), '@', 2),
          'created_at', sub.created_at
        ) ORDER BY sub.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_candidates_json
    FROM (
      SELECT u.id, u.email, u.created_at
      FROM auth.users u
      WHERE u.email_confirmed_at IS NULL
        AND u.created_at < (now() - p_older_than)
        AND u.invited_at IS NULL
        AND coalesce((u.raw_app_meta_data->>'is_admin_created')::boolean, false) = false
        AND coalesce(u.raw_app_meta_data->>'role', '') NOT IN ('staff', 'admin')
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

    v_remaining_count := GREATEST(0, v_total_count - c_batch_limit);

    RETURN jsonb_build_object(
      'success', true,
      'dry_run', true,
      'candidate_count', v_total_count,
      'candidates', v_candidates_json,
      'remaining_count', v_remaining_count
    );
  END IF;

  -- 4. LIVE DELETION MODE (p_dry_run = false)
  -- 4a. Count total matching candidates across database
  SELECT count(*)
  INTO v_total_count
  FROM auth.users u
  WHERE u.email_confirmed_at IS NULL
    AND u.created_at < (now() - p_older_than)
    AND u.invited_at IS NULL
    AND coalesce((u.raw_app_meta_data->>'is_admin_created')::boolean, false) = false
    AND coalesce(u.raw_app_meta_data->>'role', '') NOT IN ('staff', 'admin')
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

  -- 4b. Select up to 200 oldest candidate IDs for batch deletion
  SELECT coalesce(array_agg(sub.id), ARRAY[]::uuid[])
  INTO v_batch_ids
  FROM (
    SELECT u.id
    FROM auth.users u
    WHERE u.email_confirmed_at IS NULL
      AND u.created_at < (now() - p_older_than)
      AND u.invited_at IS NULL
      AND coalesce((u.raw_app_meta_data->>'is_admin_created')::boolean, false) = false
      AND coalesce(u.raw_app_meta_data->>'role', '') NOT IN ('staff', 'admin')
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

  -- 4c. Perform deletion if targets found
  IF v_deleted_count > 0 THEN
    -- Deleting from auth.users cascades to public.profiles via FK ON DELETE CASCADE,
    -- which cleanly frees the unique college_id constraint index.
    DELETE FROM auth.users
    WHERE id = ANY(v_batch_ids);

    -- 4d. Always write audit row on live deletion (actor_id NULL if service role / SQL editor)
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
        'deleted_ids', v_batch_ids,
        'caller_type', CASE WHEN v_caller_id IS NOT NULL THEN 'admin' ELSE 'sql editor or service role' END
      )
    );
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
