-- =============================================================================
-- Migration: 0021_student_avatar.sql
-- Description: Persistent student profile photo with secure private storage,
--              path validation, ownership policies, and escalation guard update.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. PROFILES TABLE: Add avatar_path with length & safe pattern constraint
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_path text NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_path_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_path_check
  CHECK (
    avatar_path IS NULL
    OR (
      length(avatar_path) <= 120
      AND avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$'
    )
  );

-- -----------------------------------------------------------------------------
-- 2. STORAGE: Private bucket 'avatars' (public = false, 1MB limit)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  1048576, -- 1 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 1048576,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- -----------------------------------------------------------------------------
-- 3. STORAGE POLICIES: storage.objects policies for 'avatars' bucket only
--    Enforces (storage.foldername(name))[1] = auth.uid()::text
--    Zero anonymous access. Authenticated users access only their own folder.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_authenticated_select_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_delete_own" ON storage.objects;

CREATE POLICY "avatars_authenticated_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_authenticated_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_authenticated_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_authenticated_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 4. PROFILE ESCALATION GUARD: Updated from latest definition (0002_rls.sql)
--    Allows authenticated non-admin to update avatar_path ONLY within their
--    own user folder (or set to NULL). Continues strictly blocking role,
--    canteen_id, and is_active modifications.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_profile_escalation()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  -- Allow postgres / service_role / background processes / SECURITY DEFINER functions
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_caller_role := public.current_user_role();

  -- Admin can modify any profile column
  IF v_caller_role = 'admin'::public.user_role THEN
    RETURN NEW;
  END IF;

  -- Authenticated non-admin: block role, canteen_id, is_active changes
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their role';
  END IF;

  IF NEW.canteen_id IS DISTINCT FROM OLD.canteen_id THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their canteen_id';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their active status';
  END IF;

  -- Authenticated non-admin: ensure avatar_path can only be set to user's own folder or NULL
  IF NEW.avatar_path IS DISTINCT FROM OLD.avatar_path THEN
    IF NEW.avatar_path IS NOT NULL AND NEW.avatar_path NOT LIKE (OLD.id::text || '/%') THEN
      RAISE EXCEPTION 'Non-admin users cannot set avatar_path outside their own folder';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. PERMISSIONS & SCHEMA RELOAD
-- -----------------------------------------------------------------------------
GRANT SELECT (avatar_path), UPDATE (avatar_path) ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

