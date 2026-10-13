-- ==============================================================================
-- PHASE CLEANUP TEST SUITE: docs/PHASE_CLEANUP_TESTS.sql
-- Description: Interactive & Non-Interactive verification script for Migration 0011:
--              1. Dry run deletes nothing, returns candidate count, domain, and id.
--              2. Old unconfirmed student with no references is cleanly deleted.
--              3. Invited unconfirmed user (staff/admin) is not deleted.
--              4. Student with an existing order is not deleted.
--              5. Non-admin (student) caller receives FORBIDDEN.
--              6. Anonymous caller cannot execute procedure.
--
-- Safety: Wrapped in BEGIN ... ROLLBACK so NO test state or fixtures persist.
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
-- SETUP: Create clean test fixtures
-- ==============================================================================
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_staff_id   uuid := gen_random_uuid();
  v_canteen_id uuid;
BEGIN
  RESET ROLE;

  -- Ensure an active canteen exists
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true LIMIT 1;
  IF v_canteen_id IS NULL THEN
    v_canteen_id := gen_random_uuid();
    INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
    VALUES (v_canteen_id, 'Cleanup Test Canteen', '08:00', '18:00', '17:30', 5, 5, 15, true);
  END IF;

  -- Create admin auth user & profile
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_admin_id, 'admin_cleanup_test@campus.edu', now(), jsonb_build_object('full_name', 'System Admin'), jsonb_build_object('role', 'admin', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'admin'::public.user_role, is_active = true
  WHERE id = v_admin_id;

  -- Create active student auth user & profile
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_student_id, 'active_student@campus.edu', now(), jsonb_build_object('full_name', 'Active Student', 'college_id', 'CID11111'), jsonb_build_object('is_admin_created', true));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'CID11111', is_active = true
  WHERE id = v_student_id;

  -- Create active staff auth user & profile
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff_id, 'active_staff@campus.edu', now(), jsonb_build_object('full_name', 'Active Staff'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true
  WHERE id = v_staff_id;

  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff_id', v_staff_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen_id', v_canteen_id);
END;
$$;


-- ==============================================================================
-- TEST 1: Dry run deletes nothing & returns candidates (count, id, domain, created_at)
-- ==============================================================================
DO $$
DECLARE
  v_admin_id      uuid;
  v_unconf_id     uuid := gen_random_uuid();
  v_res           jsonb;
  v_user_exists   boolean;
  v_cand_item     jsonb;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  RESET ROLE;

  -- Create old unconfirmed student (72 hours old)
  INSERT INTO auth.users (id, email, email_confirmed_at, invited_at, created_at, raw_user_meta_data)
  VALUES (v_unconf_id, 'dryrun_candidate@campus.edu', NULL, NULL, now() - interval '72 hours', jsonb_build_object('full_name', 'DryRun Candidate', 'college_id', 'DRY001'));

  INSERT INTO _test_env (key, val_uuid) VALUES ('candidate_dryrun_id', v_unconf_id);

  -- Execute dry run as admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.admin_cleanup_unconfirmed_users(interval '48 hours', true);

  RESET ROLE;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_unconf_id) INTO v_user_exists;

  -- Verify candidates array contains our candidate and does NOT leak full email
  SELECT elem INTO v_cand_item
  FROM jsonb_array_elements(v_res->'candidates') elem
  WHERE elem->>'id' = v_unconf_id::text;

  IF (v_res->>'dry_run')::boolean = true
     AND (v_res->>'candidate_count')::integer >= 1
     AND v_cand_item IS NOT NULL
     AND v_cand_item->>'email_domain' = 'campus.edu'
     AND v_cand_item ? 'created_at'
     AND NOT (v_cand_item ? 'email')
     AND v_user_exists = true THEN
    INSERT INTO _test_results VALUES (1, 'Dry run deletes nothing and returns candidate metadata', true, 'dry_run=true, candidates verified, 0 users deleted');
  ELSE
    INSERT INTO _test_results VALUES (1, 'Dry run deletes nothing and returns candidate metadata', false, 'res=' || coalesce(v_res::text, 'null') || ', user_exists=' || v_user_exists);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (1, 'Dry run deletes nothing and returns candidate metadata', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 2: Old unconfirmed student with no references is cleanly deleted
-- ==============================================================================
DO $$
DECLARE
  v_admin_id      uuid;
  v_unconf_id     uuid;
  v_res           jsonb;
  v_user_exists   boolean;
  v_prof_exists   boolean;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_unconf_id FROM _test_env WHERE key = 'candidate_dryrun_id';

  -- Execute live run (p_dry_run = false)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.admin_cleanup_unconfirmed_users(interval '48 hours', false);

  RESET ROLE;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_unconf_id) INTO v_user_exists;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_unconf_id) INTO v_prof_exists;

  IF (v_res->>'dry_run')::boolean = false
     AND (v_res->>'deleted_count')::integer >= 1
     AND v_user_exists = false
     AND v_prof_exists = false THEN
    INSERT INTO _test_results VALUES (2, 'Old unconfirmed student with no references deleted', true, 'Deleted from auth.users and cascaded from profiles');
  ELSE
    INSERT INTO _test_results VALUES (2, 'Old unconfirmed student with no references deleted', false, 'res=' || coalesce(v_res::text, 'null') || ', user_exists=' || v_user_exists || ', prof_exists=' || v_prof_exists);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (2, 'Old unconfirmed student with no references deleted', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: Invited unconfirmed user (staff) is NOT deleted
-- ==============================================================================
DO $$
DECLARE
  v_admin_id      uuid;
  v_canteen_id    uuid;
  v_invited_id    uuid := gen_random_uuid();
  v_res           jsonb;
  v_user_exists   boolean;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  RESET ROLE;

  -- Create invited unconfirmed staff (72 hours old, invited_at IS NOT NULL)
  INSERT INTO auth.users (id, email, email_confirmed_at, invited_at, created_at, raw_user_meta_data)
  VALUES (v_invited_id, 'invited_chef@campus.edu', NULL, now() - interval '72 hours', now() - interval '72 hours', jsonb_build_object('full_name', 'Invited Chef'));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = false
  WHERE id = v_invited_id;

  -- Run cleanup
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.admin_cleanup_unconfirmed_users(interval '48 hours', false);

  RESET ROLE;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_invited_id) INTO v_user_exists;

  IF v_user_exists = true THEN
    INSERT INTO _test_results VALUES (3, 'Invited unconfirmed user not deleted', true, 'Invited staff with invited_at IS NOT NULL preserved');
  ELSE
    INSERT INTO _test_results VALUES (3, 'Invited unconfirmed user not deleted', false, 'Invited user was incorrectly deleted: ' || coalesce(v_res::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (3, 'Invited unconfirmed user not deleted', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 4: Student with an order is NOT deleted
-- ==============================================================================
DO $$
DECLARE
  v_admin_id      uuid;
  v_canteen_id    uuid;
  v_order_user_id uuid := gen_random_uuid();
  v_order_id      uuid := gen_random_uuid();
  v_res           jsonb;
  v_user_exists   boolean;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  RESET ROLE;

  -- Create unconfirmed student (72 hours old)
  INSERT INTO auth.users (id, email, email_confirmed_at, invited_at, created_at, raw_user_meta_data)
  VALUES (v_order_user_id, 'order_student@campus.edu', NULL, NULL, now() - interval '72 hours', jsonb_build_object('full_name', 'Ordered Student', 'college_id', 'ORD777'));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'ORD777', is_active = true
  WHERE id = v_order_user_id;

  -- Attach an order to this student
  INSERT INTO public.orders (id, user_id, canteen_id, status, subtotal, tax_amount, total_amount, estimated_ready_time)
  VALUES (v_order_id, v_order_user_id, v_canteen_id, 'PLACED', 100.00, 5.00, 105.00, now() + interval '15 minutes');

  -- Run cleanup
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.admin_cleanup_unconfirmed_users(interval '48 hours', false);

  RESET ROLE;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_order_user_id) INTO v_user_exists;

  IF v_user_exists = true THEN
    INSERT INTO _test_results VALUES (4, 'Student with an order not deleted', true, 'Safety guard preserved student with existing order');
  ELSE
    INSERT INTO _test_results VALUES (4, 'Student with an order not deleted', false, 'Student with order was incorrectly deleted: ' || coalesce(v_res::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'Student with an order not deleted', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Non-admin caller receives FORBIDDEN
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_err        boolean := false;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_cleanup_unconfirmed_users();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN
      v_err := true;
    END IF;
  END;

  RESET ROLE;

  IF v_err THEN
    INSERT INTO _test_results VALUES (5, 'Non-admin forbidden', true, 'Authenticated non-admin blocked with FORBIDDEN error');
  ELSE
    INSERT INTO _test_results VALUES (5, 'Non-admin forbidden', false, 'Failed to raise FORBIDDEN exception');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'Non-admin forbidden', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Anon caller cannot execute procedure
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  SET LOCAL ROLE anon;

  BEGIN
    PERFORM public.admin_cleanup_unconfirmed_users();
  EXCEPTION WHEN OTHERS THEN
    v_err := true;
  END;

  RESET ROLE;

  IF v_err THEN
    INSERT INTO _test_results VALUES (6, 'Anon cannot execute', true, 'Anonymous execution blocked by REVOKE');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Anon cannot execute', false, 'Anon was unexpectedly allowed to execute');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (6, 'Anon cannot execute', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- FINAL SUMMARY & RESULT VERIFICATION
-- ==============================================================================
DO $$
DECLARE
  v_pass_count   integer;
  v_fail_count   integer;
  v_total        integer;
  r              record;
  v_fail_summary text := '';
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_pass_count FROM _test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'CLEANUP UNCONFIRMED USERS TEST SUITE: % / % PASSED', v_pass_count, v_total;
  RAISE NOTICE '=====================================================';

  FOR r IN SELECT test_num, test_name, passed, details FROM _test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE '[PASS] Test %: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE '[FAIL] Test %: % - %', r.test_num, r.test_name, r.details;
      v_fail_summary := v_fail_summary || ' [Test ' || r.test_num || ': ' || r.test_name || ' -> ' || r.details || ']';
    END IF;
  END LOOP;

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % out of % tests failed.%', v_fail_count, v_total, v_fail_summary;
  ELSIF v_total < 6 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 6 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % cleanup test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
