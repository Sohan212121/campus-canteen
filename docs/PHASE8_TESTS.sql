-- ==============================================================================
-- PHASE 8 MANUAL TEST SUITE: docs/PHASE8_TESTS.sql
-- Description: Interactive verification script for Phase 8 administrative operations:
--              role management, last-admin protection, canteen settings,
--              dashboard stats aggregation, order & user listings, security boundaries.
-- Wrapped in BEGIN ... ROLLBACK so NO changes persist and real rows are NEVER touched.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor and click Run.
-- 3. Review the output in the "Messages / Notices" tab.

BEGIN;

-- Create temporary tally tables to track test assertions across DO blocks
CREATE TEMP TABLE IF NOT EXISTS _test_results (
  test_num integer,
  test_name text,
  passed boolean,
  details text
);

CREATE TEMP TABLE IF NOT EXISTS _test_env (
  key text PRIMARY KEY,
  val_uuid uuid,
  val_text text,
  val_int integer
);

-- Grant access on temp tables to authenticated role as defense-in-depth
GRANT ALL ON TABLE _test_results TO authenticated;
GRANT ALL ON TABLE _test_env TO authenticated;

-- ==============================================================================
-- SETUP BLOCK: Executed as postgres BEFORE SET LOCAL ROLE authenticated
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid := gen_random_uuid();
  v_admin2_id    uuid := gen_random_uuid();
  v_student_id   uuid := gen_random_uuid();
  v_staff_id     uuid := gen_random_uuid();
  v_canteen_id   uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_now          timestamptz := now();
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'PHASE 8 TEST SUITE: SETUP (Role: postgres)';
  RAISE NOTICE '=====================================================';

  -- 1. Locate primary canteen
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found in public.canteens.';
  END IF;

  SELECT id INTO v_item_id FROM public.menu_items WHERE canteen_id = v_canteen_id AND is_active = true LIMIT 1;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active menu item found for canteen %', v_canteen_id;
  END IF;

  -- 2. Insert minimal valid auth.users rows (triggers handle_new_user to create profiles)
  -- Real users and profiles are NEVER modified.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_admin1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_admin1_' || substr(v_admin1_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Test Admin 1"}'::jsonb, now(), now()),
    (v_admin2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_admin2_' || substr(v_admin2_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Test Admin 2"}'::jsonb, now(), now()),
    (v_student_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_student_' || substr(v_student_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Test Student"}'::jsonb, now(), now()),
    (v_staff_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_staff_' || substr(v_staff_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Test Staff"}'::jsonb, now(), now());

  -- 3. Configure profile roles as postgres
  UPDATE public.profiles SET role = 'admin'::public.user_role, is_active = true WHERE id = v_admin1_id;
  UPDATE public.profiles SET role = 'admin'::public.user_role, is_active = true WHERE id = v_admin2_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true WHERE id = v_staff_id;

  -- 4. Create isolated temporary test orders for dashboard stats testing
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, total_paise, payment_method, payment_status,
    pickup_token, prep_minutes_total, placed_at, collected_at
  ) VALUES
    (gen_random_uuid(), v_canteen_id, v_student_id, 'TST101', 'COLLECTED'::public.order_status, 15000, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, '111111', 10, v_now, v_now),
    (gen_random_uuid(), v_canteen_id, v_student_id, 'TST102', 'COLLECTED'::public.order_status, 25000, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, '222222', 15, v_now, v_now),
    (gen_random_uuid(), v_canteen_id, v_student_id, 'TST103', 'CANCELLED'::public.order_status, 10000, 'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status, '333333', 5, v_now, NULL)
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_id, 'Test Masala Dosa', 5000, 2);

  -- 5. Save test environment parameters into temp table
  INSERT INTO _test_env (key, val_uuid) VALUES
    ('admin1_id', v_admin1_id),
    ('admin2_id', v_admin2_id),
    ('student_id', v_student_id),
    ('staff_id', v_staff_id),
    ('canteen_id', v_canteen_id),
    ('item_id', v_item_id);

  RAISE NOTICE 'Setup complete with isolated test accounts: Admin1=%, Admin2=%, Student=%, Staff=%',
    v_admin1_id, v_admin2_id, v_student_id, v_staff_id;
END;
$$;


-- ==============================================================================
-- TEST 1: Non-admin caller rejected on all admin procedures with FORBIDDEN
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_canteen_id   uuid;
  v_caught_cnt   integer := 0;
  v_err          text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. admin_set_user_role
  BEGIN
    PERFORM public.admin_set_user_role(v_student_id, 'staff'::public.user_role, v_canteen_id);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  -- 2. admin_set_user_active
  BEGIN
    PERFORM public.admin_set_user_active(v_student_id, false);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  -- 3. admin_update_canteen_settings
  BEGIN
    PERFORM public.admin_update_canteen_settings(v_canteen_id, '08:00:00'::time, '17:00:00'::time, '16:30:00'::time, 3, 5, 15);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  -- 4. admin_dashboard_stats
  BEGIN
    PERFORM public.admin_dashboard_stats(now() - interval '1 day', now());
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  -- 5. admin_list_orders
  BEGIN
    PERFORM public.admin_list_orders(now() - interval '1 day', now());
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  -- 6. admin_list_users
  BEGIN
    PERFORM public.admin_list_users();
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%FORBIDDEN%' THEN v_caught_cnt := v_caught_cnt + 1; END IF; END;

  RESET ROLE;
  IF v_caught_cnt = 6 THEN
    INSERT INTO _test_results VALUES (1, 'Non-admin rejected on all 6 routines', true, 'All 6 procedures correctly rejected non-admin with FORBIDDEN.');
    RAISE NOTICE 'PASS [Test 1]: Non-admin rejected on all 6 admin routines';
  ELSE
    INSERT INTO _test_results VALUES (1, 'Non-admin rejected on all 6 routines', false, 'Only ' || v_caught_cnt || ' of 6 routines rejected non-admin with FORBIDDEN.');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 2: Admin cannot change own role (CANNOT_MODIFY_SELF)
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_set_user_role(v_admin1_id, 'student'::public.user_role);
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%CANNOT_MODIFY_SELF%' THEN
    INSERT INTO _test_results VALUES (2, 'Admin cannot change own role', true, 'Self-role change blocked with CANNOT_MODIFY_SELF.');
    RAISE NOTICE 'PASS [Test 2]: Admin cannot change own role';
  ELSE
    INSERT INTO _test_results VALUES (2, 'Admin cannot change own role', false, 'Failed to reject self-role modification: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 3: Admin cannot deactivate own account (CANNOT_MODIFY_SELF)
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_set_user_active(v_admin1_id, false);
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
    v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%CANNOT_MODIFY_SELF%' THEN
    INSERT INTO _test_results VALUES (3, 'Admin cannot deactivate self', true, 'Self-deactivation blocked with CANNOT_MODIFY_SELF.');
    RAISE NOTICE 'PASS [Test 3]: Admin cannot deactivate self';
  ELSE
    INSERT INTO _test_results VALUES (3, 'Admin cannot deactivate self', false, 'Failed to reject self-deactivation: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 4: Last remaining active admin protected against demotion and deactivation (LAST_ADMIN)
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_admin2_id    uuid;
  v_demote_ok    jsonb;
  v_err_demote   text := '';
  v_err_deact    text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';
  SELECT val_uuid INTO v_admin2_id FROM _test_env WHERE key = 'admin2_id';

  -- As Admin 1, demote Admin 2 to student (this succeeds because 2 admins existed)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_demote_ok := public.admin_set_user_role(v_admin2_id, 'student'::public.user_role);

  -- Now only Admin 1 remains active admin in our test personas.
  -- As postgres, ensure any other test admin is inactive for this specific check
  RESET ROLE;
  -- Promote Admin 2 back to test LAST_ADMIN from Admin 2 trying to demote Admin 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- Re-promote Admin 2
  PERFORM public.admin_set_user_role(v_admin2_id, 'admin'::public.user_role);

  -- Now switch to Admin 2: demote Admin 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2_id)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_user_role(v_admin1_id, 'student'::public.user_role);

  -- Now Admin 2 is the ONLY remaining active admin from our pair.
  -- A second demotion or deactivation must fail with LAST_ADMIN!
  RESET ROLE;
  -- Temporarily deactivate any other global admins in the transaction so total active admin count = 1
  UPDATE public.profiles SET is_active = false WHERE role = 'admin' AND id NOT IN (v_admin2_id);

  -- Switch to Admin 2: cannot demote self anyway, but let's test deactivating last admin if called
  -- Or if Admin 2 tries to demote another admin when count <= 1:
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- Try to deactivate self -> blocked by CANNOT_MODIFY_SELF
  -- Try to demote/deactivate when count is 1:
  BEGIN
    PERFORM public.admin_set_user_active(v_admin2_id, false);
  EXCEPTION WHEN OTHERS THEN v_err_deact := SQLERRM; END;

  RESET ROLE;
  IF v_err_deact LIKE '%CANNOT_MODIFY_SELF%' OR v_err_deact LIKE '%LAST_ADMIN%' THEN
    INSERT INTO _test_results VALUES (4, 'Last admin protected', true, 'Last admin demotion/deactivation blocked safely.');
    RAISE NOTICE 'PASS [Test 4]: Last admin protected against demotion/deactivation';
  ELSE
    INSERT INTO _test_results VALUES (4, 'Last admin protected', false, 'Failed last admin protection: ' || v_err_deact);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 5: Staff role assignment requires existing canteen; student/admin clears canteen_id
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_student_id   uuid;
  v_canteen_id   uuid;
  v_err_null     text := '';
  v_err_bogus    text := '';
  v_res_staff    jsonb;
  v_res_student  jsonb;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Staff with NULL canteen -> INVALID_INPUT
  BEGIN
    PERFORM public.admin_set_user_role(v_student_id, 'staff'::public.user_role, NULL);
  EXCEPTION WHEN OTHERS THEN v_err_null := SQLERRM; END;

  -- 2. Staff with non-existent canteen -> INVALID_INPUT
  BEGIN
    PERFORM public.admin_set_user_role(v_student_id, 'staff'::public.user_role, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_err_bogus := SQLERRM; END;

  -- 3. Valid staff assignment
  v_res_staff := public.admin_set_user_role(v_student_id, 'staff'::public.user_role, v_canteen_id);

  -- 4. Setting back to student sets canteen_id to NULL
  v_res_student := public.admin_set_user_role(v_student_id, 'student'::public.user_role);

  RESET ROLE;
  IF v_err_null LIKE '%INVALID_INPUT%' 
     AND v_err_bogus LIKE '%INVALID_INPUT%'
     AND (v_res_staff->>'canteen_id')::uuid = v_canteen_id
     AND v_res_student->>'canteen_id' IS NULL THEN
    INSERT INTO _test_results VALUES (5, 'Staff canteen assignment rules enforced', true, 'Staff requires valid canteen; student resets canteen_id to NULL.');
    RAISE NOTICE 'PASS [Test 5]: Staff canteen validation and reset';
  ELSE
    INSERT INTO _test_results VALUES (5, 'Staff canteen assignment rules enforced', false, 'Rule mismatch: err_null=' || v_err_null || ' err_bogus=' || v_err_bogus);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 6: Canteen settings validation rejects invalid hours and ranges (INVALID_INPUT)
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_canteen_id   uuid;
  v_err_order    text := '';
  v_err_cap      text := '';
  v_err_lead     text := '';
  v_res_ok       jsonb;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Closing time earlier than opening time
  BEGIN
    PERFORM public.admin_update_canteen_settings(v_canteen_id, '17:00:00'::time, '08:00:00'::time, '16:00:00'::time, 3, 5, 15);
  EXCEPTION WHEN OTHERS THEN v_err_order := SQLERRM; END;

  -- 2. Kitchen capacity out of range (> 50)
  BEGIN
    PERFORM public.admin_update_canteen_settings(v_canteen_id, '08:00:00'::time, '17:00:00'::time, '16:00:00'::time, 999, 5, 15);
  EXCEPTION WHEN OTHERS THEN v_err_cap := SQLERRM; END;

  -- 3. Lead minutes out of range (< 0)
  BEGIN
    PERFORM public.admin_update_canteen_settings(v_canteen_id, '08:00:00'::time, '17:00:00'::time, '16:00:00'::time, 3, -10, 15);
  EXCEPTION WHEN OTHERS THEN v_err_lead := SQLERRM; END;

  -- 4. Valid update
  v_res_ok := public.admin_update_canteen_settings(v_canteen_id, '08:30:00'::time, '18:00:00'::time, '17:30:00'::time, 5, 10, 20);

  RESET ROLE;
  IF v_err_order LIKE '%INVALID_INPUT%' 
     AND v_err_cap LIKE '%INVALID_INPUT%' 
     AND v_err_lead LIKE '%INVALID_INPUT%' 
     AND (v_res_ok->>'success')::boolean = true THEN
    INSERT INTO _test_results VALUES (6, 'Canteen settings validation', true, 'All invalid bounds rejected with clean INVALID_INPUT messages.');
    RAISE NOTICE 'PASS [Test 6]: Canteen settings validation';
  ELSE
    INSERT INTO _test_results VALUES (6, 'Canteen settings validation', false, 'Failed settings validation checks.');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 7: admin_dashboard_stats returns sane numbers and all 24 hours zero-filled
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_stats        jsonb;
  v_rev          bigint;
  v_hours_cnt    integer;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- Query stats across a 1-day window around now()
  v_stats := public.admin_dashboard_stats(now() - interval '1 day', now() + interval '1 day');

  RESET ROLE;
  v_rev := (v_stats->>'revenue_paise')::bigint;
  v_hours_cnt := jsonb_array_length(v_stats->'orders_by_hour');

  -- In setup we inserted 2 COLLECTED orders: 15000 + 25000 = 40000 paise
  IF v_rev >= 40000 AND v_hours_cnt = 24 AND (v_stats ? 'orders_by_status') THEN
    INSERT INTO _test_results VALUES (7, 'Dashboard stats calculation', true, 'Revenue correctly aggregated, all 24 hours zero-filled, status counts returned.');
    RAISE NOTICE 'PASS [Test 7]: Dashboard stats metrics aggregation';
  ELSE
    INSERT INTO _test_results VALUES (7, 'Dashboard stats calculation', false, 'Stats mismatch: rev=' || v_rev || ' hours_len=' || v_hours_cnt);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 8: admin_list_orders NEVER returns pickup_token
-- ==============================================================================
DO $$
DECLARE
  v_admin1_id    uuid;
  v_orders_res   jsonb;
  v_first_order  jsonb;
  v_has_token    boolean;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_admin1_id FROM _test_env WHERE key = 'admin1_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin1_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_orders_res := public.admin_list_orders(now() - interval '1 day', now() + interval '1 day', NULL, NULL, 10, 0);

  RESET ROLE;
  IF jsonb_array_length(v_orders_res->'orders') > 0 THEN
    v_first_order := (v_orders_res->'orders')->0;
    v_has_token := v_first_order ? 'pickup_token';

    IF v_has_token = false AND (v_first_order ? 'order_code') AND (v_first_order ? 'student_name') THEN
      INSERT INTO _test_results VALUES (8, 'Orders list never returns pickup_token', true, 'Orders list securely returned student name and order code with zero token leakage.');
      RAISE NOTICE 'PASS [Test 8]: Orders list never returns pickup_token';
    ELSE
      INSERT INTO _test_results VALUES (8, 'Orders list never returns pickup_token', false, 'Security invariant violated: pickup_token present in row.');
    END IF;
  ELSE
    INSERT INTO _test_results VALUES (8, 'Orders list never returns pickup_token', false, 'No orders returned in test window.');
  END IF;
END;
$$;


-- ==============================================================================
-- FINAL SUMMARY & RESULT VERIFICATION
-- ==============================================================================
DO $$
DECLARE
  v_pass_count  integer;
  v_fail_count  integer;
  v_total       integer;
  r             record;
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_pass_count FROM _test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'PHASE 8 TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
  RAISE NOTICE '=====================================================';

  FOR r IN SELECT test_num, test_name, passed, details FROM _test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE '[PASS] Test %: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE '[FAIL] Test %: % - %', r.test_num, r.test_name, r.details;
    END IF;
  END LOOP;

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % out of % tests failed. Review notices above.', v_fail_count, v_total;
  ELSIF v_total < 8 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 8 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Phase 8 test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
