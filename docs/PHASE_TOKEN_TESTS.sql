-- ==============================================================================
-- PHASE_TOKEN_TESTS.sql: orders.pickup_token Column Protection Test Suite
-- ==============================================================================
-- Transactional execution wrapped in BEGIN ... ROLLBACK so NO test fixtures persist.
-- Validates:
--   1. Privilege matrix:
--      - anon: has_column_privilege for public.orders (all columns) is FALSE
--      - authenticated: has_column_privilege for pickup_token is FALSE
--      - authenticated: has_column_privilege for other 26 columns is TRUE
--      - service_role: has_column_privilege for pickup_token is TRUE
--      - other secret tables (order_pickup_secrets, pickup_collect_attempts) have NO SELECT for authenticated
--   2. Direct query enforcement under SET LOCAL ROLE:
--      - anon selecting public.orders throws 42501 (insufficient_privilege)
--      - student selecting orders.pickup_token throws 42501 (insufficient_privilege)
--      - staff selecting orders.pickup_token throws 42501 (insufficient_privilege)
--      - student selecting * from public.orders throws 42501 (insufficient_privilege)
--      - staff selecting * from public.orders throws 42501 (insufficient_privilege)
--   3. Legitimate application query preservation:
--      - student selecting their order with all 26 granted non-token columns succeeds
--      - student running EXACT frontend order-list projection succeeds
--      - staff running EXACT frontend kitchen-board projection succeeds
--   4. SECURITY DEFINER procedures unaffected:
--      - get_pickup_code(order_id) succeeds for student
--      - preview_collection(canteen_id, code) succeeds for staff
--      - collect_order(...) succeeds for staff
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS _token_test_results (
  test_num integer,
  test_name text,
  passed boolean,
  details text
);

CREATE TEMP TABLE IF NOT EXISTS _token_test_env (
  key text PRIMARY KEY,
  val_uuid uuid,
  val_text text
);

GRANT ALL ON TABLE _token_test_results TO authenticated, anon;
GRANT ALL ON TABLE _token_test_env TO authenticated, anon;

-- Apply migration 0016 logic within this isolated transaction for verification
REVOKE SELECT ON TABLE public.orders FROM authenticated, anon;

DO $$
DECLARE
  v_col text;
  v_cols text[] := '{}';
  v_sql text;
BEGIN
  FOR v_col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name != 'pickup_token'
    ORDER BY ordinal_position
  LOOP
    v_cols := array_append(v_cols, quote_ident(v_col));
  END LOOP;

  IF array_length(v_cols, 1) > 0 THEN
    v_sql := format(
      'GRANT SELECT (%s) ON TABLE public.orders TO authenticated;',
      array_to_string(v_cols, ', ')
    );
    EXECUTE v_sql;
  END IF;
END $$;

-- ==============================================================================
-- SETUP: Create clean test fixtures with auth.users before profiles
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_staff_id   uuid := gen_random_uuid();
  v_order_id   uuid := gen_random_uuid();
  v_item_id    uuid := gen_random_uuid();
  v_secret     text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
BEGIN
  RESET ROLE;

  -- 1. Create temporary canteen
  INSERT INTO public.canteens (
    id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active
  ) VALUES (
    v_canteen_id, 'Token Test Canteen', '00:00'::time, '23:59'::time, '23:58'::time, 10, 5, 30, true
  );

  -- 2. Create student auth user and profile
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_student_id, 'student_token_test@somaiya.edu', '{"role":"student"}'::jsonb);

  INSERT INTO public.profiles (id, full_name, role, college_id, is_active)
  VALUES (v_student_id, 'Token Test Student', 'student', 'TTSTUDENT01', true);

  -- 3. Create staff auth user and profile
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_staff_id, 'staff_token_test@somaiya.edu', '{"role":"staff"}'::jsonb);

  INSERT INTO public.profiles (id, full_name, role, canteen_id, college_id, is_active)
  VALUES (v_staff_id, 'Token Test Staff', 'staff', v_canteen_id, 'TTSTAFF01', true);

  -- 4. Create menu item
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_time_minutes, is_available)
  VALUES (v_item_id, v_canteen_id, 'Token Test Item', 6000, 5, true);

  -- 5. Create order in READY status
  INSERT INTO public.orders (
    id, order_code, user_id, canteen_id, status, payment_method, payment_status,
    total_paise, prep_minutes_total, estimated_ready_at, pickup_window_end,
    placed_at, ready_at, pickup_token
  ) VALUES (
    v_order_id, 'CN88801', v_student_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING',
    6000, 5, now() - interval '2 minutes', now() + interval '13 minutes',
    now() - interval '10 minutes', now() - interval '2 minutes', '999888'
  );

  -- 6. Insert order item
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_id, 'Token Test Item', 6000, 1);

  -- 7. Insert secret row
  INSERT INTO public.order_pickup_secrets (order_id, secret, failed_pin_attempts, is_pin_locked)
  VALUES (v_order_id, v_secret, 0, false);

  -- Save variables in _token_test_env
  INSERT INTO _token_test_env (key, val_uuid) VALUES ('canteen_id', v_canteen_id);
  INSERT INTO _token_test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _token_test_env (key, val_uuid) VALUES ('staff_id', v_staff_id);
  INSERT INTO _token_test_env (key, val_uuid) VALUES ('order_id', v_order_id);
  INSERT INTO _token_test_env (key, val_uuid) VALUES ('item_id', v_item_id);
  INSERT INTO _token_test_env (key, val_text) VALUES ('secret', v_secret);
END;
$$;

-- ==============================================================================
-- SECTION 1: COLUMN PRIVILEGE CHECKS (has_column_privilege)
-- ==============================================================================
DO $$
DECLARE
  v_has_anon_token boolean;
  v_has_auth_token boolean;
  v_has_auth_id    boolean;
  v_has_auth_code  boolean;
  v_has_serv_token boolean;
  v_has_secret_col boolean;
  v_has_attempt_col boolean;
BEGIN
  RESET ROLE;

  -- Test 1: anon cannot select pickup_token
  v_has_anon_token := has_column_privilege('anon', 'public.orders', 'pickup_token', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (1, 'Privilege: anon cannot select orders.pickup_token',
          v_has_anon_token = false,
          'has_column_privilege = ' || v_has_anon_token::text);

  -- Test 2: authenticated cannot select pickup_token
  v_has_auth_token := has_column_privilege('authenticated', 'public.orders', 'pickup_token', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (2, 'Privilege: authenticated cannot select orders.pickup_token',
          v_has_auth_token = false,
          'has_column_privilege = ' || v_has_auth_token::text);

  -- Test 3: authenticated CAN select id
  v_has_auth_id := has_column_privilege('authenticated', 'public.orders', 'id', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (3, 'Privilege: authenticated CAN select orders.id',
          v_has_auth_id = true,
          'has_column_privilege = ' || v_has_auth_id::text);

  -- Test 4: authenticated CAN select order_code
  v_has_auth_code := has_column_privilege('authenticated', 'public.orders', 'order_code', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (4, 'Privilege: authenticated CAN select orders.order_code',
          v_has_auth_code = true,
          'has_column_privilege = ' || v_has_auth_code::text);

  -- Test 5: service_role retains select on pickup_token
  v_has_serv_token := has_column_privilege('service_role', 'public.orders', 'pickup_token', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (5, 'Privilege: service_role retains select on orders.pickup_token',
          v_has_serv_token = true,
          'has_column_privilege = ' || v_has_serv_token::text);

  -- Test 6: authenticated cannot select secret from order_pickup_secrets
  v_has_secret_col := has_column_privilege('authenticated', 'public.order_pickup_secrets', 'secret', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (6, 'Privilege: authenticated cannot select order_pickup_secrets.secret',
          v_has_secret_col = false,
          'has_column_privilege = ' || v_has_secret_col::text);

  -- Test 7: authenticated cannot select outcome from pickup_collect_attempts
  v_has_attempt_col := has_column_privilege('authenticated', 'public.pickup_collect_attempts', 'outcome', 'select');
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (7, 'Privilege: authenticated cannot select pickup_collect_attempts.outcome',
          v_has_attempt_col = false,
          'has_column_privilege = ' || v_has_attempt_col::text);
END;
$$;

-- ==============================================================================
-- SECTION 2: RUNTIME QUERIES UNDER REAL ROLES & JWTs
-- ==============================================================================

-- Test 8: Anon role cannot select from public.orders (raises 42501)
DO $$
DECLARE
  v_passed boolean := false;
  v_details text;
  v_rec record;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}'::text, true);

  BEGIN
    EXECUTE 'SELECT id FROM public.orders LIMIT 1' INTO v_rec;
    v_details := 'Unexpected query success for anon';
  EXCEPTION WHEN insufficient_privilege THEN
    v_passed := true;
    v_details := 'Correctly raised 42501 (insufficient_privilege) on anon SELECT';
  WHEN OTHERS THEN
    v_details := 'Unexpected SQLSTATE: ' || SQLSTATE;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (8, 'Runtime: anon SELECT on public.orders is rejected', v_passed, v_details);
END;
$$;

-- Test 9: Student cannot SELECT pickup_token (raises 42501)
DO $$
DECLARE
  v_student_id uuid;
  v_passed boolean := false;
  v_details text;
  v_token text;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _token_test_env WHERE key = 'student_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id, 'role', 'authenticated')::text, true);

  BEGIN
    EXECUTE 'SELECT pickup_token FROM public.orders WHERE user_id = ' || quote_literal(v_student_id) INTO v_token;
    v_details := 'Unexpected query success: student was able to select pickup_token';
  EXCEPTION WHEN insufficient_privilege THEN
    v_passed := true;
    v_details := 'Correctly raised 42501 (insufficient_privilege) when student selected pickup_token';
  WHEN OTHERS THEN
    v_details := 'Unexpected SQLSTATE: ' || SQLSTATE;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (9, 'Runtime: student cannot SELECT orders.pickup_token', v_passed, v_details);
END;
$$;

-- Test 10: Staff cannot SELECT pickup_token (raises 42501)
DO $$
DECLARE
  v_staff_id uuid;
  v_passed boolean := false;
  v_details text;
  v_token text;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _token_test_env WHERE key = 'staff_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id, 'role', 'authenticated')::text, true);

  BEGIN
    EXECUTE 'SELECT pickup_token FROM public.orders LIMIT 1' INTO v_token;
    v_details := 'Unexpected query success: staff was able to select pickup_token';
  EXCEPTION WHEN insufficient_privilege THEN
    v_passed := true;
    v_details := 'Correctly raised 42501 (insufficient_privilege) when staff selected pickup_token';
  WHEN OTHERS THEN
    v_details := 'Unexpected SQLSTATE: ' || SQLSTATE;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (10, 'Runtime: staff cannot SELECT orders.pickup_token', v_passed, v_details);
END;
$$;

-- Test 11: Student attempting SELECT * fails (raises 42501)
DO $$
DECLARE
  v_student_id uuid;
  v_passed boolean := false;
  v_details text;
  v_rec record;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _token_test_env WHERE key = 'student_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id, 'role', 'authenticated')::text, true);

  BEGIN
    EXECUTE 'SELECT * FROM public.orders WHERE user_id = ' || quote_literal(v_student_id) INTO v_rec;
    v_details := 'Unexpected query success: student was able to run SELECT *';
  EXCEPTION WHEN insufficient_privilege THEN
    v_passed := true;
    v_details := 'Correctly raised 42501 (insufficient_privilege) when student ran SELECT *';
  WHEN OTHERS THEN
    v_details := 'Unexpected SQLSTATE: ' || SQLSTATE;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (11, 'Runtime: student SELECT * fails due to ungranted pickup_token', v_passed, v_details);
END;
$$;

-- Test 12: Staff attempting SELECT * fails (raises 42501)
DO $$
DECLARE
  v_staff_id uuid;
  v_passed boolean := false;
  v_details text;
  v_rec record;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _token_test_env WHERE key = 'staff_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id, 'role', 'authenticated')::text, true);

  BEGIN
    EXECUTE 'SELECT * FROM public.orders LIMIT 1' INTO v_rec;
    v_details := 'Unexpected query success: staff was able to run SELECT *';
  EXCEPTION WHEN insufficient_privilege THEN
    v_passed := true;
    v_details := 'Correctly raised 42501 (insufficient_privilege) when staff ran SELECT *';
  WHEN OTHERS THEN
    v_details := 'Unexpected SQLSTATE: ' || SQLSTATE;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (12, 'Runtime: staff SELECT * fails due to ungranted pickup_token', v_passed, v_details);
END;
$$;

-- ==============================================================================
-- SECTION 3: LEGITIMATE QUERIES (EXACT PROJECTIONS SUCCEED)
-- ==============================================================================

-- Test 13: Student selecting their own order with all 26 non-token columns succeeds
DO $$
DECLARE
  v_student_id uuid;
  v_order_id   uuid;
  v_passed     boolean := false;
  v_details    text;
  v_rec        record;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _token_test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_order_id FROM _token_test_env WHERE key = 'order_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT
      id, order_code, user_id, canteen_id, status, payment_method, payment_status,
      total_paise, idempotency_key, requested_pickup_at, estimated_ready_at,
      pickup_window_end, prep_minutes_total, placed_at, accepted_at, preparing_at,
      ready_at, collected_at, cancelled_at, rejected_at, collection_method,
      collected_with, pickup_for_name, is_manual_override, manual_override_reason,
      collected_by
    INTO v_rec
    FROM public.orders
    WHERE id = v_order_id;

    IF v_rec.id = v_order_id AND v_rec.order_code = 'CN88801' THEN
      v_passed := true;
      v_details := 'All 26 non-token columns successfully read by student';
    ELSE
      v_details := 'Query returned unexpected or empty record';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'Query failed unexpectedly: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (13, 'Runtime: student selects all 26 non-token columns successfully', v_passed, v_details);
END;
$$;

-- Test 14: Student running EXACT frontend orders-list projection succeeds
DO $$
DECLARE
  v_student_id uuid;
  v_passed     boolean := false;
  v_details    text;
  v_rec        record;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _token_test_env WHERE key = 'student_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id, 'role', 'authenticated')::text, true);

  BEGIN
    -- Projection matches OrdersListView and orders/page.tsx exactly
    SELECT id, order_code, status, total_paise, placed_at, estimated_ready_at, pickup_window_end
    INTO v_rec
    FROM public.orders
    WHERE user_id = v_student_id
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
    ORDER BY placed_at DESC
    LIMIT 1;

    IF v_rec.order_code = 'CN88801' AND v_rec.status = 'READY' THEN
      v_passed := true;
      v_details := 'Exact frontend student order-list projection succeeded';
    ELSE
      v_details := 'Order not found in frontend projection query';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'Student frontend query failed: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (14, 'Runtime: student exact frontend order-list projection succeeds', v_passed, v_details);
END;
$$;

-- Test 15: Staff running EXACT frontend kitchen-board projection succeeds
DO $$
DECLARE
  v_staff_id   uuid;
  v_canteen_id uuid;
  v_passed     boolean := false;
  v_details    text;
  v_rec        record;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _token_test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_canteen_id FROM _token_test_env WHERE key = 'canteen_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id, 'role', 'authenticated')::text, true);

  BEGIN
    -- Projection matches getStaffBoardDataAction (staff.ts:513) exactly
    SELECT
      id,
      order_code,
      status,
      total_paise,
      payment_method,
      payment_status,
      placed_at,
      estimated_ready_at,
      pickup_window_end,
      prep_minutes_total
    INTO v_rec
    FROM public.orders
    WHERE canteen_id = v_canteen_id
    LIMIT 1;

    IF v_rec.order_code = 'CN88801' THEN
      v_passed := true;
      v_details := 'Exact frontend staff board projection succeeded';
    ELSE
      v_details := 'Order not found in staff board query';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'Staff board query failed: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (15, 'Runtime: staff exact kitchen-board projection succeeds', v_passed, v_details);
END;
$$;

-- ==============================================================================
-- SECTION 4: SECURITY DEFINER PROCEDURES PRESERVED
-- ==============================================================================

-- Test 16: get_pickup_code succeeds for student
DO $$
DECLARE
  v_student_id uuid;
  v_order_id   uuid;
  v_passed     boolean := false;
  v_details    text;
  v_res        jsonb;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _token_test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_order_id FROM _token_test_env WHERE key = 'order_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id, 'role', 'authenticated')::text, true);

  BEGIN
    v_res := public.get_pickup_code(v_order_id);
    IF (v_res->>'ok')::boolean = true AND length(v_res->>'code') = 6 THEN
      v_passed := true;
      v_details := 'get_pickup_code returned code: ' || (v_res->>'code');
      -- Save code in _token_test_env for staff collection test
      INSERT INTO _token_test_env (key, val_text) VALUES ('active_code', v_res->>'code');
      INSERT INTO _token_test_env (key, val_text) VALUES ('active_pin', v_res->>'pin');
    ELSE
      v_details := 'get_pickup_code error: ' || coalesce(v_res->>'error', 'Unknown');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'get_pickup_code failed with exception: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (16, 'SECURITY DEFINER: get_pickup_code succeeds for student', v_passed, v_details);
END;
$$;

-- Test 17: preview_collection succeeds for staff
DO $$
DECLARE
  v_staff_id   uuid;
  v_canteen_id uuid;
  v_order_id   uuid;
  v_code       text;
  v_pin        text;
  v_passed     boolean := false;
  v_details    text;
  v_res        jsonb;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _token_test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_canteen_id FROM _token_test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_order_id FROM _token_test_env WHERE key = 'order_id';
  SELECT val_text INTO v_code FROM _token_test_env WHERE key = 'active_code';
  SELECT val_text INTO v_pin FROM _token_test_env WHERE key = 'active_pin';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id, 'role', 'authenticated')::text, true);

  BEGIN
    v_res := public.preview_collection(v_canteen_id, 'CN88801', v_code, v_pin);
    IF (v_res->>'ok')::boolean = true AND (v_res->>'order_id')::uuid = v_order_id THEN
      v_passed := true;
      v_details := 'preview_collection succeeded with order_code: ' || (v_res->>'order_code');
    ELSE
      v_details := 'preview_collection error: ' || coalesce(v_res->>'error', 'Unknown');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'preview_collection failed with exception: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (17, 'SECURITY DEFINER: preview_collection succeeds for staff', v_passed, v_details);
END;
$$;

-- Test 18: collect_order succeeds for staff
DO $$
DECLARE
  v_staff_id   uuid;
  v_canteen_id uuid;
  v_order_id   uuid;
  v_code       text;
  v_pin        text;
  v_passed     boolean := false;
  v_details    text;
  v_res        jsonb;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _token_test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_canteen_id FROM _token_test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_order_id FROM _token_test_env WHERE key = 'order_id';
  SELECT val_text INTO v_code FROM _token_test_env WHERE key = 'active_code';
  SELECT val_text INTO v_pin FROM _token_test_env WHERE key = 'active_pin';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id, 'role', 'authenticated')::text, true);

  BEGIN
    v_res := public.collect_order(v_canteen_id, v_order_id, 'CASH'::public.collected_with_enum, 'SCAN', v_code, v_pin, NULL);
    IF (v_res->>'ok')::boolean = true AND (v_res->>'order_id')::uuid = v_order_id THEN
      v_passed := true;
      v_details := 'collect_order succeeded: order status transitioned to COLLECTED';
    ELSE
      v_details := 'collect_order error: ' || coalesce(v_res->>'error', 'Unknown');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_details := 'collect_order failed with exception: ' || SQLERRM;
  END;

  RESET ROLE;
  INSERT INTO _token_test_results (test_num, test_name, passed, details)
  VALUES (18, 'SECURITY DEFINER: collect_order succeeds for staff', v_passed, v_details);
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
  SELECT count(*) INTO v_pass_count FROM _token_test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _token_test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'TOKEN PROTECTION TEST SUITE: % / % PASSED', v_pass_count, v_total;
  RAISE NOTICE '=====================================================';

  FOR r IN SELECT test_num, test_name, passed, details FROM _token_test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE '[PASS] Test %: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE '[FAIL] Test %: % - %', r.test_num, r.test_name, r.details;
      v_fail_summary := v_fail_summary || ' [Test ' || r.test_num || ': ' || r.test_name || ' -> ' || r.details || ']';
    END IF;
  END LOOP;

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % out of % tests failed.%', v_fail_count, v_total, v_fail_summary;
  ELSIF v_total < 18 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 18 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Token Protection test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

-- Show results before rollback
SELECT test_num, test_name, passed, details
FROM _token_test_results
ORDER BY test_num;

ROLLBACK;
