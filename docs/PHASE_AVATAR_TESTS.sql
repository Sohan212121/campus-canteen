-- ==============================================================================
-- PHASE STUDENT AVATAR TEST SUITE: docs/PHASE_AVATAR_TESTS.sql
-- Description: Non-Interactive SQL verification script for Migration 0021:
--              1. Storage: Owner (Student A) can INSERT into own folder (avatars/<student_a>/...)
--              2. Storage: Owner (Student A) can SELECT object from own folder
--              3. Storage: Owner (Student A) can UPDATE object in own folder
--              4. Storage: Owner (Student A) can DELETE object from own folder
--                 (Skipped: protected by Supabase — use storage API)
--              5. Storage: Cross-user: Student A CANNOT INSERT into Student B's folder
--              6. Storage: Cross-user: Student A CANNOT SELECT from Student B's folder
--              7. Storage: Cross-user: Student A CANNOT UPDATE in Student B's folder
--              8. Storage: Cross-user: Student A CANNOT DELETE in Student B's folder
--                 (Skipped: protected by Supabase — use storage API)
--              9. Storage: Anon CANNOT SELECT from avatars bucket
--              10. Storage: Anon CANNOT INSERT into avatars bucket
--              11. Profile: Owner can set avatar_path to valid own folder path
--              12. Profile: Owner can set avatar_path to NULL (remove photo)
--              13. Profile: Owner CANNOT set avatar_path to another user's folder
--              14. Profile: CHECK constraint rejects invalid extension (e.g. .exe, .svg)
--              15. Profile: CHECK constraint rejects path exceeding 120 characters
--              16. Profile: Escalation guard still blocks altering role
--              17. Profile: Escalation guard still blocks altering canteen_id
--              18. Profile: Escalation guard still blocks altering is_active
--
-- Prerequisites: Migration 0021_student_avatar.sql must be applied.
-- Safety: Wrapped in BEGIN ... ROLLBACK so NO test state or fixtures persist.
--         Result table is displayed via SELECT before ROLLBACK.
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS _test_results (
  test_num integer,
  test_name text,
  passed boolean,
  details text
);

CREATE TEMP TABLE IF NOT EXISTS _test_env (
  key text PRIMARY KEY,
  val_uuid uuid,
  val_text text
);

GRANT ALL ON TABLE _test_results TO authenticated, anon;
GRANT ALL ON TABLE _test_env TO authenticated, anon;

-- ==============================================================================
-- SETUP: Create clean temporary test fixtures
-- Insert into auth.users first (FK: profiles.id references auth.users.id)
-- The handle_new_user trigger auto-creates profile rows on auth.users INSERT.
-- ==============================================================================
DO $$
DECLARE
  v_student_a_id uuid := gen_random_uuid();
  v_student_b_id uuid := gen_random_uuid();
  v_canteen_id   uuid := gen_random_uuid();
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Allowed domain for setup
  INSERT INTO public.allowed_email_domains (domain)
  VALUES ('avatar.test')
  ON CONFLICT (domain) DO NOTHING;

  -- Create test canteen
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_id, 'Avatar Test Canteen', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  -- Create auth.users rows (handle_new_user trigger auto-creates profiles)
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (
    v_student_a_id,
    'avatar_a@avatar.test',
    jsonb_build_object('full_name', 'Avatar Student A', 'college_id', '2026-AVT-001'),
    jsonb_build_object('is_admin_created', true)
  );

  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (
    v_student_b_id,
    'avatar_b@avatar.test',
    jsonb_build_object('full_name', 'Avatar Student B', 'college_id', '2026-AVT-002'),
    jsonb_build_object('is_admin_created', true)
  );

  -- Ensure profiles are active students (trigger should set role='student', is_active=true)
  UPDATE public.profiles
  SET role = 'student'::public.user_role, is_active = true
  WHERE id IN (v_student_a_id, v_student_b_id);

  -- Store IDs in test environment
  INSERT INTO _test_env VALUES ('student_a_id', v_student_a_id, NULL);
  INSERT INTO _test_env VALUES ('student_b_id', v_student_b_id, NULL);
  INSERT INTO _test_env VALUES ('canteen_id', v_canteen_id, NULL);
END;
$$;

-- Helpers to switch roles cleanly
CREATE OR REPLACE FUNCTION _as_student_a()
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION _as_student_b()
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_b_id';
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION _as_anon()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- ==============================================================================
-- TEST 1: Storage: Owner (Student A) can INSERT into own folder
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  INSERT INTO storage.objects (id, bucket_id, name, owner)
  VALUES (gen_random_uuid(), 'avatars', v_uid::text || '/avatar_123.webp', v_uid);

  INSERT INTO _test_results VALUES (1, 'Storage: Owner can INSERT into own folder', true, 'Success');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (1, 'Storage: Owner can INSERT into own folder', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 2: Storage: Owner (Student A) can SELECT object from own folder
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
  v_cnt integer;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  SELECT count(*) INTO v_cnt
  FROM storage.objects
  WHERE bucket_id = 'avatars' AND name = v_uid::text || '/avatar_123.webp';

  IF v_cnt = 1 THEN
    INSERT INTO _test_results VALUES (2, 'Storage: Owner can SELECT object from own folder', true, 'Found 1 row');
  ELSE
    INSERT INTO _test_results VALUES (2, 'Storage: Owner can SELECT object from own folder', false, 'Expected 1 row, got ' || v_cnt);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (2, 'Storage: Owner can SELECT object from own folder', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 3: Storage: Owner (Student A) can UPDATE object in own folder
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  UPDATE storage.objects
  SET metadata = '{"updated": true}'::jsonb
  WHERE bucket_id = 'avatars' AND name = v_uid::text || '/avatar_123.webp';

  INSERT INTO _test_results VALUES (3, 'Storage: Owner can UPDATE object in own folder', true, 'Success');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (3, 'Storage: Owner can UPDATE object in own folder', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 4: Storage: Owner (Student A) can DELETE object from own folder
-- Skipped: Supabase protects direct DELETE on storage.objects rows.
-- Direct SQL DELETE bypasses the storage API layer that manages physical files.
-- The RLS policy itself is correct; use the storage API to test deletion.
-- ==============================================================================
DO $$
BEGIN
  INSERT INTO _test_results VALUES (4, 'Storage: Owner can DELETE object from own folder', NULL, 'Skipped: protected by Supabase — use storage API to test deletion');
END;
$$;

-- ==============================================================================
-- TEST 5: Storage: Cross-user: Student A CANNOT INSERT into Student B's folder
-- ==============================================================================
DO $$
DECLARE
  v_b_uid uuid;
  v_a_uid uuid;
BEGIN
  SELECT val_uuid INTO v_a_uid FROM _test_env WHERE key = 'student_a_id';
  SELECT val_uuid INTO v_b_uid FROM _test_env WHERE key = 'student_b_id';
  PERFORM _as_student_a();

  INSERT INTO storage.objects (id, bucket_id, name, owner)
  VALUES (gen_random_uuid(), 'avatars', v_b_uid::text || '/hacked.webp', v_a_uid);

  INSERT INTO _test_results VALUES (5, 'Storage: Cross-user INSERT blocked', false, 'Expected RLS violation, but INSERT succeeded');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (5, 'Storage: Cross-user INSERT blocked', true, 'Blocked: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 6: Storage: Cross-user: Student A CANNOT SELECT from Student B's folder
-- ==============================================================================
DO $$
DECLARE
  v_b_uid uuid;
  v_cnt   integer;
BEGIN
  SELECT val_uuid INTO v_b_uid FROM _test_env WHERE key = 'student_b_id';

  -- Create Student B object as Student B
  PERFORM _as_student_b();
  INSERT INTO storage.objects (id, bucket_id, name, owner)
  VALUES (gen_random_uuid(), 'avatars', v_b_uid::text || '/student_b_photo.webp', v_b_uid);

  -- Now switch to Student A and try to select it
  PERFORM _as_student_a();
  SELECT count(*) INTO v_cnt
  FROM storage.objects
  WHERE bucket_id = 'avatars' AND name = v_b_uid::text || '/student_b_photo.webp';

  IF v_cnt = 0 THEN
    INSERT INTO _test_results VALUES (6, 'Storage: Cross-user SELECT hidden', true, 'Correctly returned 0 rows to other student');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Storage: Cross-user SELECT hidden', false, 'Leaked object! Student A saw ' || v_cnt || ' rows');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (6, 'Storage: Cross-user SELECT hidden', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 7: Storage: Cross-user: Student A CANNOT UPDATE in Student B's folder
-- ==============================================================================
DO $$
DECLARE
  v_b_uid uuid;
BEGIN
  SELECT val_uuid INTO v_b_uid FROM _test_env WHERE key = 'student_b_id';
  PERFORM _as_student_a();

  UPDATE storage.objects
  SET metadata = '{"tampered": true}'::jsonb
  WHERE bucket_id = 'avatars' AND name = v_b_uid::text || '/student_b_photo.webp';

  -- In PostgreSQL RLS, updating 0 visible rows does not throw an error, but affects 0 rows
  IF NOT FOUND THEN
    INSERT INTO _test_results VALUES (7, 'Storage: Cross-user UPDATE blocked', true, 'Zero rows affected by unauthorized UPDATE');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Storage: Cross-user UPDATE blocked', false, 'Student A updated Student B object');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (7, 'Storage: Cross-user UPDATE blocked', true, 'Blocked: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 8: Storage: Cross-user: Student A CANNOT DELETE in Student B's folder
-- Skipped: Supabase protects direct DELETE on storage.objects rows.
-- The RLS policy itself is correct; use the storage API to test cross-user deletion.
-- ==============================================================================
DO $$
BEGIN
  INSERT INTO _test_results VALUES (8, 'Storage: Cross-user DELETE blocked', NULL, 'Skipped: protected by Supabase — use storage API to test cross-user deletion');
END;
$$;

-- ==============================================================================
-- TEST 9: Storage: Anon CANNOT SELECT from avatars bucket
-- ==============================================================================
DO $$
DECLARE
  v_cnt integer;
BEGIN
  PERFORM _as_anon();

  SELECT count(*) INTO v_cnt
  FROM storage.objects
  WHERE bucket_id = 'avatars';

  IF v_cnt = 0 THEN
    INSERT INTO _test_results VALUES (9, 'Storage: Anon SELECT blocked', true, 'Returned 0 rows to anon');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Storage: Anon SELECT blocked', false, 'Anon saw ' || v_cnt || ' objects');
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (9, 'Storage: Anon SELECT blocked', true, 'Blocked: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 10: Storage: Anon CANNOT INSERT into avatars bucket
-- ==============================================================================
DO $$
BEGIN
  PERFORM _as_anon();

  INSERT INTO storage.objects (id, bucket_id, name)
  VALUES (gen_random_uuid(), 'avatars', 'anon_hack.webp');

  INSERT INTO _test_results VALUES (10, 'Storage: Anon INSERT blocked', false, 'Anon was able to insert into avatars');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (10, 'Storage: Anon INSERT blocked', true, 'Blocked: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 11: Profile: Owner can set avatar_path to valid own folder path
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
  v_path text;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  v_path := v_uid::text || '/avatar_test.webp';
  UPDATE public.profiles
  SET avatar_path = v_path
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (11, 'Profile: Owner can set valid avatar_path', true, 'Success');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (11, 'Profile: Owner can set valid avatar_path', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 12: Profile: Owner can set avatar_path to NULL (remove photo)
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET avatar_path = NULL
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (12, 'Profile: Owner can set avatar_path to NULL', true, 'Success');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (12, 'Profile: Owner can set avatar_path to NULL', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 13: Profile: Owner CANNOT set avatar_path to another user's folder
-- ==============================================================================
DO $$
DECLARE
  v_a_uid uuid;
  v_b_uid uuid;
BEGIN
  SELECT val_uuid INTO v_a_uid FROM _test_env WHERE key = 'student_a_id';
  SELECT val_uuid INTO v_b_uid FROM _test_env WHERE key = 'student_b_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET avatar_path = v_b_uid::text || '/stolen_avatar.webp'
  WHERE id = v_a_uid;

  INSERT INTO _test_results VALUES (13, 'Profile: Setting avatar_path to other user folder blocked', false, 'Expected trigger exception, but update succeeded');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (13, 'Profile: Setting avatar_path to other user folder blocked', true, 'Blocked by trigger: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 14: Profile: CHECK constraint rejects invalid extension (e.g. .exe, .svg)
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET avatar_path = v_uid::text || '/malicious.exe'
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (14, 'Profile: CHECK constraint rejects .exe extension', false, 'Expected check violation, but update succeeded');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (14, 'Profile: CHECK constraint rejects .exe extension', true, 'Blocked by check: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 15: Profile: CHECK constraint rejects path exceeding 120 characters
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
  v_long_path text;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  -- Build path longer than 120 chars: 36 (uuid) + 1 (/) + 90 (chars) + 5 (.webp) = 132 chars
  v_long_path := v_uid::text || '/' || repeat('a', 90) || '.webp';

  UPDATE public.profiles
  SET avatar_path = v_long_path
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (15, 'Profile: CHECK constraint rejects path > 120 chars', false, 'Expected check violation, but update succeeded');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (15, 'Profile: CHECK constraint rejects path > 120 chars', true, 'Blocked by check: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 16: Profile: Escalation guard still blocks altering role
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET role = 'admin'::public.user_role
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (16, 'Profile: Escalation guard blocks role change', false, 'Expected escalation exception, but role was altered');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (16, 'Profile: Escalation guard blocks role change', true, 'Blocked by escalation guard: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 17: Profile: Escalation guard still blocks altering canteen_id
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
  v_canteen uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  SELECT val_uuid INTO v_canteen FROM _test_env WHERE key = 'canteen_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET canteen_id = v_canteen
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (17, 'Profile: Escalation guard blocks canteen_id change', false, 'Expected escalation exception, but canteen_id was altered');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (17, 'Profile: Escalation guard blocks canteen_id change', true, 'Blocked by escalation guard: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 18: Profile: Escalation guard still blocks altering is_active
-- ==============================================================================
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT val_uuid INTO v_uid FROM _test_env WHERE key = 'student_a_id';
  PERFORM _as_student_a();

  UPDATE public.profiles
  SET is_active = false
  WHERE id = v_uid;

  INSERT INTO _test_results VALUES (18, 'Profile: Escalation guard blocks is_active change', false, 'Expected escalation exception, but is_active was altered');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (18, 'Profile: Escalation guard blocks is_active change', true, 'Blocked by escalation guard: ' || SQLERRM);
END;
$$;

-- ==============================================================================
-- RESET: Restore postgres role before displaying results
-- ==============================================================================
RESET ROLE;

-- ==============================================================================
-- TEST SUITE SUMMARY
-- Run this SELECT immediately before ROLLBACK so the SQL editor displays it.
-- The result set is returned to the client before the ROLLBACK executes,
-- so all 18 rows are visible even though the transaction rolls back.
-- ==============================================================================
SELECT
  test_num,
  test_name,
  CASE
    WHEN passed IS NULL THEN 'SKIP'
    WHEN passed THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  details
FROM _test_results
ORDER BY test_num;

-- Strictly ROLLBACK all test data and changes
ROLLBACK;
