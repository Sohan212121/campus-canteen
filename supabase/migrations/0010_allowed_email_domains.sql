-- =============================================================================
-- Migration: 0010_allowed_email_domains.sql
-- Description: Campus Domain Restriction & Signup Hardening
--              1. Allowed email domains table (RLS enabled, zero policies, admin-managed).
--              2. Pre-check asserting no existing student profile violates college_id integrity.
--              3. chk_profiles_student_college_id and idx_profiles_student_college_id_unique.
--              4. Public lookup function: public.is_signup_email_allowed(p_email).
--              5. Student signup validation trigger BEFORE INSERT ON auth.users.
--              6. Updated handle_new_user() with role bypass, name sanitization, uppercase college_id.
--              7. Admin management procedures: admin_list_allowed_domains,
--                 admin_add_allowed_domain, admin_remove_allowed_domain.
--              8. Updated admin_set_user_role with college_id guard when assigning student role.
-- =============================================================================

-- =============================================================================
-- 1. PRE-CHECK: Abort if existing data violates student college_id constraints
-- =============================================================================
DO $$
DECLARE
  v_null_or_blank_count integer;
  v_dup_count           integer;
  v_format_fail_count   integer;
BEGIN
  -- Count student profiles with NULL or whitespace-only college_id
  SELECT count(*) INTO v_null_or_blank_count
  FROM public.profiles
  WHERE role = 'student'::public.user_role
    AND (college_id IS NULL OR trim(college_id) = '');

  IF v_null_or_blank_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 0010 ABORTED: Found % student profile(s) with NULL or empty college_id. Run the read-only audit query in docs/SCHEMA.md to identify and resolve offending rows before applying this migration.', v_null_or_blank_count;
  END IF;

  -- Count student profiles with invalid format (must be 3-30 chars, matching ^[A-Za-z0-9_./-]{3,30}$)
  SELECT count(*) INTO v_format_fail_count
  FROM public.profiles
  WHERE role = 'student'::public.user_role
    AND college_id IS NOT NULL
    AND trim(college_id) != ''
    AND college_id !~ '^[A-Za-z0-9_./-]{3,30}$';

  IF v_format_fail_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 0010 ABORTED: Found % student profile(s) with invalid college_id format (must be 3-30 characters matching ^[A-Za-z0-9_./-]{3,30}$). Run the read-only audit query in docs/SCHEMA.md to identify and resolve offending rows before applying this migration.', v_format_fail_count;
  END IF;

  -- Count student profiles with duplicate college_id (case-insensitive)
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT upper(trim(college_id))
    FROM public.profiles
    WHERE role = 'student'::public.user_role
      AND college_id IS NOT NULL
      AND trim(college_id) != ''
    GROUP BY upper(trim(college_id))
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION 0010 ABORTED: Found % duplicate college_id collision(s) among student profiles. Resolve duplicate college IDs before applying this migration.', v_dup_count;
  END IF;
END;
$$;


-- =============================================================================
-- 2. TABLE: public.allowed_email_domains
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.allowed_email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT chk_allowed_domain_format CHECK (
    domain = lower(trim(domain))
    AND domain NOT LIKE '%@%'
    AND domain !~ '\.$'
    AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  )
);

ALTER TABLE public.allowed_email_domains ENABLE ROW LEVEL SECURITY;

-- Revoke all table privileges; all mutations/reads go through SECURITY DEFINER routines
REVOKE ALL ON TABLE public.allowed_email_domains FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.allowed_email_domains TO service_role;

CREATE INDEX IF NOT EXISTS idx_allowed_email_domains_domain
  ON public.allowed_email_domains(domain);


-- =============================================================================
-- 3. PROFILES: Student College ID Constraints
-- =============================================================================
-- Ensure existing rows are uppercase trimmed for consistency
UPDATE public.profiles
SET college_id = upper(trim(college_id))
WHERE college_id IS NOT NULL AND college_id != upper(trim(college_id));

-- Constraint: Students must have a valid college_id matching 3-30 permitted characters
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_profiles_student_college_id'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_student_college_id
      CHECK (
        role != 'student'::public.user_role
        OR (
          college_id IS NOT NULL
          AND trim(college_id) != ''
          AND college_id ~ '^[A-Za-z0-9_./-]{3,30}$'
        )
      );
  END IF;
END;
$$;

-- Case-insensitive uniqueness for student college IDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_college_id_unique
  ON public.profiles (upper(trim(college_id)))
  WHERE role = 'student'::public.user_role;


-- =============================================================================
-- 4. FUNCTION: public.is_signup_email_allowed (Public Pre-check)
-- =============================================================================
-- Callable by anon and authenticated.
-- Inspects domain only; reveals ZERO info about whether an account exists.
-- Returns false if table is empty (fail closed), email is invalid, or domain not allowed.
CREATE OR REPLACE FUNCTION public.is_signup_email_allowed(p_email text)
RETURNS boolean
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_email text;
  v_domain      text;
  v_local       text;
  v_is_allowed  boolean;
BEGIN
  IF p_email IS NULL THEN
    RETURN false;
  END IF;

  v_clean_email := lower(trim(p_email));

  -- Must contain exactly one '@'
  IF v_clean_email = ''
     OR (length(v_clean_email) - length(replace(v_clean_email, '@', '')) != 1) THEN
    RETURN false;
  END IF;

  v_local := split_part(v_clean_email, '@', 1);
  v_domain := split_part(v_clean_email, '@', 2);

  -- Reject empty local, plus-alias in local part, trailing dot in domain
  IF v_local = '' OR v_local LIKE '%+%' OR v_domain = '' OR v_domain ~ '\.$' THEN
    RETURN false;
  END IF;

  -- Validate domain format regex
  IF v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RETURN false;
  END IF;

  -- Exact case-insensitive match against allowed_email_domains
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_email_domains
    WHERE domain = v_domain
  ) INTO v_is_allowed;

  RETURN coalesce(v_is_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_signup_email_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_signup_email_allowed(text) TO anon, authenticated, service_role;


-- =============================================================================
-- 5. TRIGGER FUNCTION: public.validate_student_signup
-- =============================================================================
-- Enforces allowed domains and college_id requirements BEFORE INSERT ON auth.users.
CREATE OR REPLACE FUNCTION public.validate_student_signup()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_email text;
  v_domain      text;
  v_local       text;
  v_college_id  text;
  v_is_allowed  boolean;
  v_is_bypassed boolean := false;
BEGIN
  -- 1. Check if user creation is bypassed (Admin invite or admin-created staff/admin)
  -- Public signUp cannot set invited_at or raw_app_meta_data.
  IF NEW.invited_at IS NOT NULL
     OR COALESCE(NEW.raw_app_meta_data->>'role', '') IN ('staff', 'admin')
     OR (NEW.raw_app_meta_data->>'is_admin_created')::boolean = true THEN
    v_is_bypassed := true;
  END IF;

  -- If bypassed, allow creation without student domain or student college_id check
  IF v_is_bypassed THEN
    RETURN NEW;
  END IF;

  -- 2. Validate email structure
  IF NEW.email IS NULL THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Email address cannot be null' USING ERRCODE = 'P0001';
  END IF;

  v_clean_email := lower(trim(NEW.email));

  IF v_clean_email = '' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Email address cannot be empty' USING ERRCODE = 'P0001';
  END IF;

  IF (length(v_clean_email) - length(replace(v_clean_email, '@', '')) != 1) THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Email address must contain exactly one @ symbol' USING ERRCODE = 'P0001';
  END IF;

  v_local := split_part(v_clean_email, '@', 1);
  v_domain := split_part(v_clean_email, '@', 2);

  IF v_local = '' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Local part of email cannot be empty' USING ERRCODE = 'P0001';
  END IF;

  -- Reject plus-addressing for student registration
  IF v_local LIKE '%+%' THEN
    RAISE EXCEPTION 'PLUS_ALIAS_NOT_ALLOWED: Plus-addressing (+) is not permitted for student registration' USING ERRCODE = 'P0001';
  END IF;

  IF v_domain = '' OR v_domain ~ '\.$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Domain part is invalid or has a trailing dot' USING ERRCODE = 'P0001';
  END IF;

  IF v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Domain label format is invalid' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Fail closed: Check against allowed_email_domains
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_email_domains
    WHERE domain = v_domain
  ) INTO v_is_allowed;

  IF NOT coalesce(v_is_allowed, false) THEN
    RAISE EXCEPTION 'DOMAIN_NOT_ALLOWED: Registration is restricted to authorized campus email domains' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Validate college_id format from user metadata
  v_college_id := upper(trim(COALESCE(NEW.raw_user_meta_data->>'college_id', '')));

  IF v_college_id = '' THEN
    RAISE EXCEPTION 'MISSING_COLLEGE_ID: College ID is required for student registration' USING ERRCODE = 'P0001';
  END IF;

  IF v_college_id !~ '^[A-Za-z0-9_./-]{3,30}$' THEN
    RAISE EXCEPTION 'INVALID_COLLEGE_ID_FORMAT: College ID must be 3-30 characters and contain only letters, numbers, and _ . / -' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Duplicate check on college_id
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE role = 'student'::public.user_role
      AND upper(trim(college_id)) = v_college_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_COLLEGE_ID: An account with this College ID already exists' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_student_signup ON auth.users;
CREATE TRIGGER trg_validate_student_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_signup();

REVOKE ALL ON FUNCTION public.validate_student_signup() FROM PUBLIC;


-- =============================================================================
-- 6. PROFILE CREATION TRIGGER: public.handle_new_user (Updated)
-- =============================================================================
-- Sanitizes full_name, sets uppercase college_id, and safely defaults
-- admin-invited/created users to inactive staff until admin completes setup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_raw_name     text;
  v_clean_name   text;
  v_raw_cid      text;
  v_clean_cid    text;
  v_role         public.user_role := 'student'::public.user_role;
  v_is_active    boolean := true;
  v_is_bypassed  boolean := false;
BEGIN
  -- 1. Identify admin invite or admin creation
  IF NEW.invited_at IS NOT NULL
     OR COALESCE(NEW.raw_app_meta_data->>'role', '') IN ('staff', 'admin')
     OR (NEW.raw_app_meta_data->>'is_admin_created')::boolean = true THEN
    v_is_bypassed := true;
  END IF;

  IF v_is_bypassed THEN
    -- If admin specified role in app_metadata, adopt it; otherwise default to staff
    IF NEW.raw_app_meta_data->>'role' = 'admin' THEN
      v_role := 'admin'::public.user_role;
    ELSE
      v_role := 'staff'::public.user_role;
    END IF;
    -- Non-student bypassed users remain inactive until admin assigns canteen or activates
    v_is_active := false;
  END IF;

  -- 2. Sanitise full_name:
  -- - Step 1: Turn control characters and newlines into a single space
  -- - Step 2: Strip zero-width, bidi, and byte-order overrides
  -- - Step 3: Collapse whitespace and trim
  -- - Max 80 characters; blank becomes NULL
  v_raw_name := NEW.raw_user_meta_data->>'full_name';
  IF v_raw_name IS NOT NULL THEN
    -- Step 1: Turn control characters and newlines into a single space
    v_clean_name := regexp_replace(v_raw_name, '[[:cntrl:]]+', ' ', 'g');
    -- Step 2: Strip zero-width, bidi, and byte-order overrides
    v_clean_name := regexp_replace(v_clean_name, '[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', '', 'g');
    -- Step 3: Collapse whitespace and trim
    v_clean_name := regexp_replace(v_clean_name, '\s+', ' ', 'g');
    v_clean_name := trim(v_clean_name);
    IF length(v_clean_name) > 80 THEN
      v_clean_name := substring(v_clean_name, 1, 80);
    END IF;
    IF v_clean_name = '' THEN
      v_clean_name := NULL;
    END IF;
  ELSE
    v_clean_name := NULL;
  END IF;

  -- 3. Sanitise college_id:
  v_raw_cid := NEW.raw_user_meta_data->>'college_id';
  IF v_raw_cid IS NOT NULL AND trim(v_raw_cid) != '' THEN
    v_clean_cid := upper(trim(v_raw_cid));
  ELSE
    v_clean_cid := NULL;
  END IF;

  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (
    NEW.id,
    v_clean_name,
    v_clean_cid,
    v_role,
    v_is_active
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


-- =============================================================================
-- 7. ADMIN PROCEDURE: public.admin_list_allowed_domains
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_allowed_domains()
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id   uuid;
  v_caller      public.profiles%ROWTYPE;
  v_result      jsonb;
BEGIN
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may list allowed email domains';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'domain', d.domain,
      'created_at', d.created_at,
      'created_by', d.created_by,
      'creator_name', p.full_name
    ) ORDER BY d.domain ASC
  ), '[]'::jsonb) INTO v_result
  FROM public.allowed_email_domains d
  LEFT JOIN public.profiles p ON p.id = d.created_by;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_allowed_domains() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_allowed_domains() TO authenticated, service_role;


-- =============================================================================
-- 8. ADMIN PROCEDURE: public.admin_add_allowed_domain
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_add_allowed_domain(
  p_domain text,
  p_confirm_freemail boolean DEFAULT false
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id     uuid;
  v_caller        public.profiles%ROWTYPE;
  v_clean_domain  text;
  v_existing_id   uuid;
  v_new_id        uuid;
  v_is_freemail   boolean := false;
BEGIN
  -- 1. Caller auth check
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may manage allowed email domains';
  END IF;

  -- 2. Domain validation & normalisation
  IF p_domain IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Domain cannot be null';
  END IF;

  v_clean_domain := lower(trim(p_domain));

  IF v_clean_domain = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Domain cannot be empty';
  END IF;

  IF v_clean_domain LIKE '%@%' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Domain must not contain @ character';
  END IF;

  IF v_clean_domain ~ '\.$' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Domain must not have a trailing dot';
  END IF;

  IF v_clean_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Invalid domain name format';
  END IF;

  -- 3. Common freemail provider & public-suffix check
  IF v_clean_domain IN (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com', 'rediffmail.com',
    'zoho.com', 'aol.com', 'gmx.com', 'yandex.com', 'mail.com'
  ) THEN
    v_is_freemail := true;
    IF NOT coalesce(p_confirm_freemail, false) THEN
      RAISE EXCEPTION 'FREEMAIL_CONFIRMATION_REQUIRED: % is a public consumer email provider. Confirm explicitly to allow it.', v_clean_domain;
    END IF;
  ELSIF v_clean_domain IN (
    'ac.in', 'edu.in', 'res.in', 'gov.in', 'nic.in', 'mil.in', 'co.in', 'net.in', 'org.in',
    'edu', 'ac.uk', 'gov.uk', 'edu.au', 'com.au', 'ac.nz', 'edu.sg',
    'com', 'org', 'net', 'info', 'biz', 'io', 'co', 'in', 'us', 'uk'
  ) THEN
    v_is_freemail := true;
    IF NOT coalesce(p_confirm_freemail, false) THEN
      RAISE EXCEPTION 'PUBLIC_SUFFIX_CONFIRMATION_REQUIRED: % is a public top-level or second-level suffix, not an institution domain (e.g. use campus.%). Confirm explicitly to allow it.', v_clean_domain, v_clean_domain;
    END IF;
  END IF;

  -- 4. Check for existing row
  SELECT id INTO v_existing_id
  FROM public.allowed_email_domains
  WHERE domain = v_clean_domain;

  IF FOUND THEN
    -- Idempotent: return changed: false, zero audit row written
    RETURN jsonb_build_object(
      'success', true,
      'changed', false,
      'id', v_existing_id,
      'domain', v_clean_domain,
      'is_freemail', v_is_freemail
    );
  END IF;

  -- 5. Insert new domain
  INSERT INTO public.allowed_email_domains (domain, created_by)
  VALUES (v_clean_domain, v_caller_id)
  RETURNING id INTO v_new_id;

  -- 6. Write admin audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    'ADD_ALLOWED_DOMAIN',
    'allowed_email_domain',
    v_new_id::text,
    jsonb_build_object(
      'domain', v_clean_domain,
      'is_freemail', v_is_freemail
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'id', v_new_id,
    'domain', v_clean_domain,
    'is_freemail', v_is_freemail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_allowed_domain(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_allowed_domain(text, boolean) TO authenticated, service_role;


-- =============================================================================
-- 9. ADMIN PROCEDURE: public.admin_remove_allowed_domain
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_remove_allowed_domain(
  p_domain text
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id     uuid;
  v_caller        public.profiles%ROWTYPE;
  v_clean_domain  text;
  v_existing_id   uuid;
BEGIN
  -- 1. Caller auth check
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
    RAISE EXCEPTION 'FORBIDDEN: Only administrators may manage allowed email domains';
  END IF;

  IF p_domain IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Domain cannot be null';
  END IF;

  v_clean_domain := lower(trim(p_domain));

  -- 2. Lookup target domain
  SELECT id INTO v_existing_id
  FROM public.allowed_email_domains
  WHERE domain = v_clean_domain;

  IF NOT FOUND THEN
    -- Domain already absent: return changed: false, zero audit row written
    RETURN jsonb_build_object(
      'success', true,
      'changed', false,
      'domain', v_clean_domain
    );
  END IF;

  -- 3. Delete domain
  DELETE FROM public.allowed_email_domains
  WHERE id = v_existing_id;

  -- 4. Write audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    'REMOVE_ALLOWED_DOMAIN',
    'allowed_email_domain',
    v_existing_id::text,
    jsonb_build_object('domain', v_clean_domain)
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'domain', v_clean_domain
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_allowed_domain(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_allowed_domain(text) TO authenticated, service_role;


-- =============================================================================
-- 10. PROCEDURE: public.admin_set_user_role (Updated with College ID Guard)
-- =============================================================================
-- Extends existing admin_set_user_role so changing staff/admin -> student
-- cleanly raises an INVALID_INPUT error if the account lacks a valid college_id.
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

  -- 5. Last-admin protection
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
  ELSIF p_role = 'student'::public.user_role THEN
    -- Student role requires a non-null, valid College ID matching format
    IF v_target.college_id IS NULL 
       OR trim(v_target.college_id) = '' 
       OR v_target.college_id !~ '^[A-Za-z0-9_./-]{3,30}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT: Cannot assign student role to an account without a valid College ID';
    END IF;
    v_new_canteen := NULL;
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

REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.user_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.user_role, uuid) TO authenticated, service_role;


-- =============================================================================
-- 11. POSTGREST SCHEMA RELOAD
-- =============================================================================
NOTIFY pgrst, 'reload schema';
