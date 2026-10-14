-- ==============================================================================
-- Test Suite: docs/PHASE_COLLECTION_TESTS.sql
-- Description: Non-interactive verification script for Migration 0013:
--              Collection core, TOTP rotating pickup code, PIN fallback,
--              amber thresholds, preview and collect procedures, dispute reports.
-- Execution: Non-interactive, single transaction wrapped in BEGIN ... ROLLBACK.
-- ==============================================================================

BEGIN;

-- 1. Setup in-memory test results tracking table
CREATE TEMP TABLE _test_results (
  test_num integer,
  test_name text,
  passed boolean,
  details text
);

-- ==============================================================================
-- TEST SETUP: USERS, CANTEEN, MENU ITEMS
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id uuid := gen_random_uuid();
  v_cat_id     uuid := gen_random_uuid();
  v_admin_id   uuid := gen_random_uuid();
  v_staff1_id  uuid := gen_random_uuid();
  v_staff2_id  uuid := gen_random_uuid(); -- different canteen
  v_student_id uuid := gen_random_uuid();
  v_student2_id uuid := gen_random_uuid();
  v_item_norm_id uuid := gen_random_uuid();
  v_item_amber_id uuid := gen_random_uuid();
BEGIN
  -- Ensure allowed email domain exists
  INSERT INTO public.allowed_email_domains (domain)
  VALUES ('campus.edu')
  ON CONFLICT (domain) DO NOTHING;

  -- Create Canteen 1
  INSERT INTO public.canteens (id, name, location, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_id, 'Test Collection Canteen ' || substr(gen_random_uuid()::text, 1, 8), 'Quad A', 5, 5, 30, true);

  -- Create Menu Category & Items
  INSERT INTO public.categories (id, canteen_id, name, display_order)
  VALUES (v_cat_id, v_canteen_id, 'Meals', 1);

  -- Normal item (₹60.00 = 6000 paise)
  INSERT INTO public.menu_items (id, canteen_id, category_id, name, price_paise, stock, prep_minutes, is_active, is_available)
  VALUES (v_item_norm_id, v_canteen_id, v_cat_id, 'Standard Thali', 6000, 100, 5, true, true);

  -- High-value item (₹600.00 = 60000 paise -> Amber trigger)
  INSERT INTO public.menu_items (id, canteen_id, category_id, name, price_paise, stock, prep_minutes, is_active, is_available)
  VALUES (v_item_amber_id, v_canteen_id, v_cat_id, 'Premium Feast', 60000, 50, 10, true, true);

  -- 1. Create Admin User
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_admin_id, 'admin_col@campus.edu', '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Admin Tester"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'admin'::public.user_role, is_active = true, canteen_id = NULL
  WHERE id = v_admin_id;

  -- 2. Create Staff User 1 (Assigned to Canteen 1)
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_staff1_id, 'staff1_col@campus.edu', '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Staff One"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, is_active = true, canteen_id = v_canteen_id
  WHERE id = v_staff1_id;

  -- 3. Create Staff User 2 (Assigned to NULL / Different)
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_staff2_id, 'staff2_col@campus.edu', '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Staff Two"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, is_active = true, canteen_id = NULL
  WHERE id = v_staff2_id;

  -- 4. Create Student User 1
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_student_id, 'stud1_col@campus.edu', '{"is_admin_created": true, "role": "student"}'::jsonb, '{"full_name": "Aarav Kumar", "college_id": "TSTCOL01"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'student'::public.user_role, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8))
  WHERE id = v_student_id;

  -- 5. Create Student User 2 (for dispute isolation)
  INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_student2_id, 'stud2_col@campus.edu', '{"is_admin_created": true, "role": "student"}'::jsonb, '{"full_name": "Neha Sharma", "college_id": "TSTCOL02"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'student'::public.user_role, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8))
  WHERE id = v_student2_id;

  -- Store IDs in temp table for subsequent test blocks
  CREATE TEMP TABLE _test_env AS SELECT
    v_canteen_id AS canteen_id,
    v_admin_id AS admin_id,
    v_staff1_id AS staff1_id,
    v_staff2_id AS staff2_id,
    v_student_id AS student_id,
    v_student2_id AS student2_id,
    v_item_norm_id AS item_norm_id,
    v_item_amber_id AS item_amber_id;
END;
$$;

-- ==============================================================================
-- TEST 1: transition_order strictly refuses COLLECTED
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_refused boolean := false;
  v_err text;
BEGIN
  SELECT * INTO env FROM _test_env;

  -- Create a READY order directly
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD1', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.transition_order(v_order_id, 'COLLECTED'::public.order_status);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err LIKE '%COLLECTED%' THEN
      v_refused := true;
    END IF;
  END;

  RESET ROLE;

  IF v_refused THEN
    INSERT INTO _test_results VALUES (1, 'transition_order refuses COLLECTED', true, 'Correctly raised: ' || v_err);
  ELSE
    INSERT INTO _test_results VALUES (1, 'transition_order refuses COLLECTED', false, 'Failed to refuse COLLECTED or threw unexpected error: ' || coalesce(v_err, 'NO_ERROR'));
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 2: Rotating Code Validation (Current and Previous accepted, Stale rejected)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_window bigint;
  v_code_curr text;
  v_code_prev text;
  v_code_stale text;
  v_res_curr jsonb;
  v_res_prev jsonb;
  v_res_stale jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD2', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_code_curr := public.internal_get_pickup_code(v_order_id, v_window);
  v_code_prev := public.internal_get_pickup_code(v_order_id, v_window - 1);
  v_code_stale := public.internal_get_pickup_code(v_order_id, v_window - 2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Preview with stale code -> expect ok=false, error=INVALID_CODE
  v_res_stale := public.preview_collection(env.canteen_id, v_order_id::text, v_code_stale, NULL);

  -- 2. Preview with previous window code -> expect ok=true
  v_res_prev := public.preview_collection(env.canteen_id, v_order_id::text, v_code_prev, NULL);

  -- 3. Preview with current window code -> expect ok=true
  v_res_curr := public.preview_collection(env.canteen_id, v_order_id::text, v_code_curr, NULL);

  RESET ROLE;

  IF (v_res_stale->>'ok')::boolean = false AND (v_res_stale->>'error') = 'INVALID_CODE'
     AND (v_res_prev->>'ok')::boolean = true
     AND (v_res_curr->>'ok')::boolean = true THEN
    INSERT INTO _test_results VALUES (2, 'Rotating TOTP code validation', true, 'Current & previous window accepted, stale rejected.');
  ELSE
    INSERT INTO _test_results VALUES (2, 'Rotating TOTP code validation', false, 'Mismatch: stale=' || v_res_stale::text || ' prev=' || v_res_prev::text || ' curr=' || v_res_curr::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 3: Failed-attempt counters persist (No transaction rollback on ok:false)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_res jsonb;
  v_attempts_before integer;
  v_attempts_after integer;
  v_pin_fails_before integer;
  v_pin_fails_after integer;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD3', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret, failed_pin_attempts)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 0);

  SELECT count(*) INTO v_attempts_before FROM public.pickup_verify_attempts WHERE order_id = v_order_id;
  SELECT failed_pin_attempts INTO v_pin_fails_before FROM public.order_pickup_secrets WHERE order_id = v_order_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Submit wrong code and wrong PIN
  v_res := public.preview_collection(env.canteen_id, v_order_id::text, NULL, '0000');

  RESET ROLE;

  SELECT count(*) INTO v_attempts_after FROM public.pickup_verify_attempts WHERE order_id = v_order_id;
  SELECT failed_pin_attempts INTO v_pin_fails_after FROM public.order_pickup_secrets WHERE order_id = v_order_id;

  IF (v_res->>'ok')::boolean = false
     AND v_attempts_after = v_attempts_before + 1
     AND v_pin_fails_after = v_pin_fails_before + 1 THEN
    INSERT INTO _test_results VALUES (3, 'Counters persist on failed checks', true, 'Attempt logged and failed_pin_attempts incremented without rollback.');
  ELSE
    INSERT INTO _test_results VALUES (3, 'Counters persist on failed checks', false, 'Counters failed to persist: attempts ' || v_attempts_before || '->' || v_attempts_after || ', pin ' || v_pin_fails_before || '->' || v_pin_fails_after);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 4: Amber Order Rules (> 5 items or > 500 INR requires code + PIN; PIN-only refused)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_window bigint;
  v_code text;
  v_pin text;
  v_res_pin_only jsonb;
  v_res_code_only jsonb;
  v_res_both jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  -- Amber order: total_paise = 60000 (> 50000 paise)
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD4', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    60000, now(), now() + interval '30 min', 10, now(), now()
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_amber_id, 'Premium Feast', 60000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_code := public.internal_get_pickup_code(v_order_id, v_window);
  v_pin := public.internal_get_pickup_pin(v_order_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. PIN-only collection on Amber order -> expect refused
  v_res_pin_only := public.collect_order(v_order_id, NULL, 'CASH', 'PIN', v_pin, NULL);

  -- 2. Code-only on Amber order -> expect refused (PIN_REQUIRED)
  v_res_code_only := public.collect_order(v_order_id, v_code, 'CASH', 'SCAN', NULL, NULL);

  -- 3. Code AND PIN together -> expect accepted
  v_res_both := public.collect_order(v_order_id, v_code, 'CASH', 'SCAN', v_pin, NULL);

  RESET ROLE;

  IF (v_res_pin_only->>'error') = 'AMBER_REQUIRES_CODE_AND_PIN'
     AND (v_res_code_only->>'error') = 'PIN_REQUIRED'
     AND (v_res_both->>'ok')::boolean = true THEN
    INSERT INTO _test_results VALUES (4, 'Amber threshold & PIN rules', true, 'Amber order correctly requires both rotating code and PIN; PIN-only refused.');
  ELSE
    INSERT INTO _test_results VALUES (4, 'Amber threshold & PIN rules', false, 'Amber checks failed: pin_only=' || v_res_pin_only::text || ' code_only=' || v_res_code_only::text || ' both=' || v_res_both::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 5: Replay rejected (Collected order cannot be collected again)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_window bigint;
  v_code text;
  v_res1 jsonb;
  v_res2 jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD5', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  v_window := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_code := public.internal_get_pickup_code(v_order_id, v_window);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- First collection -> ok:true
  v_res1 := public.collect_order(v_order_id, v_code, 'UPI', 'SCAN', NULL, NULL);

  -- Replay collection -> ok:false, ALREADY_COLLECTED
  v_res2 := public.collect_order(v_order_id, v_code, 'UPI', 'SCAN', NULL, NULL);

  RESET ROLE;

  IF (v_res1->>'ok')::boolean = true AND (v_res2->>'error') = 'ALREADY_COLLECTED' THEN
    INSERT INTO _test_results VALUES (5, 'Replay collection rejected', true, 'Replay of collection returned ALREADY_COLLECTED.');
  ELSE
    INSERT INTO _test_results VALUES (5, 'Replay collection rejected', false, 'Replay failed: res1=' || v_res1::text || ' res2=' || v_res2::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 6: Manual Collection Rules (Reason required, flag set, 10-cap enforced)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_res_empty jsonb;
  v_res_valid jsonb;
  v_err text;
  v_flag_stored text;
  i integer;
  v_cap_order_id uuid;
  v_cap_res jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD6', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Manual collection with reason < 5 chars must RAISE INVALID_INPUT
  BEGIN
    PERFORM public.collect_order(v_order_id, NULL, 'CASH', 'MANUAL', NULL, 'no');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  -- 2. Valid manual collection
  v_res_valid := public.collect_order(v_order_id, NULL, 'CASH', 'MANUAL', NULL, 'Student ID verified in person');

  RESET ROLE;

  SELECT manual_collection_reason INTO v_flag_stored
  FROM public.orders WHERE id = v_order_id;

  -- 3. Test Manual Cap: Seed 9 more manual collections for staff1 (total 10)
  FOR i IN 1..9 LOOP
    v_cap_order_id := gen_random_uuid();
    INSERT INTO public.orders (
      id, canteen_id, user_id, order_code, status, payment_method, payment_status,
      total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at,
      collected_by, collection_method, manual_collection_reason
    ) VALUES (
      v_cap_order_id, env.canteen_id, env.student_id, 'CAPORD' || i, 'COLLECTED'::public.order_status,
      'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
      6000, now(), now(), 5, now(), now(),
      env.staff1_id, 'MANUAL', 'Seed cap'
    );
  END LOOP;

  -- Attempt 11th manual collection
  v_cap_order_id := gen_random_uuid();
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_cap_order_id, env.canteen_id, env.student_id, 'CAPORD11', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );
  INSERT INTO public.order_pickup_secrets (order_id, secret) VALUES (v_cap_order_id, 'dummy');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_cap_res := public.collect_order(v_cap_order_id, NULL, 'CASH', 'MANUAL', NULL, 'Exceeding cap attempt');

  RESET ROLE;

  IF v_err LIKE '%INVALID_INPUT%'
     AND (v_res_valid->>'ok')::boolean = true
     AND v_flag_stored = 'Student ID verified in person'
     AND (v_cap_res->>'error') = 'MANUAL_LIMIT' THEN
    INSERT INTO _test_results VALUES (6, 'Manual collection validation & cap', true, 'Reason required, reason stored, and 10/day cap enforced.');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Manual collection validation & cap', false, 'Manual check failed: err=' || coalesce(v_err, 'NONE') || ' valid=' || v_res_valid::text || ' cap=' || v_cap_res::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 7: Role & Canteen Boundary Checks
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_student_err text;
  v_staff2_err text;
  v_admin_res jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD7', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);
  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  -- 1. Student cannot collect order
  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.student_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.collect_order(v_order_id, NULL, 'CASH', 'MANUAL', NULL, 'Student cheat');
  EXCEPTION WHEN OTHERS THEN v_student_err := SQLERRM; END;
  RESET ROLE;

  -- 2. Staff 2 (wrong canteen / unassigned) cannot collect
  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.collect_order(v_order_id, NULL, 'CASH', 'MANUAL', NULL, 'Wrong canteen');
  EXCEPTION WHEN OTHERS THEN v_staff2_err := SQLERRM; END;
  RESET ROLE;

  -- 3. Admin (canteen_id = NULL) CAN collect
  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_admin_res := public.collect_order(v_order_id, NULL, 'CASH', 'MANUAL', NULL, 'Admin intervention');
  RESET ROLE;

  IF v_student_err LIKE '%FORBIDDEN%'
     AND v_staff2_err LIKE '%FORBIDDEN%'
     AND (v_admin_res->>'ok')::boolean = true THEN
    INSERT INTO _test_results VALUES (7, 'Role & canteen boundary enforcement', true, 'Student & wrong canteen staff rejected; admin allowed.');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Role & canteen boundary enforcement', false, 'Boundary check failed: stud=' || coalesce(v_student_err, 'NONE') || ' staff2=' || coalesce(v_staff2_err, 'NONE') || ' admin=' || v_admin_res::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 8: Secrets Table RLS & Staff Invariant
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_staff_can_select_secrets boolean := false;
  v_pickup_token_val text;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD8', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, NULL, now(), now() + interval '30 min', 5, now(), now()
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Staff attempts to select order_pickup_secrets
  BEGIN
    PERFORM secret FROM public.order_pickup_secrets WHERE order_id = v_order_id;
    v_staff_can_select_secrets := true;
  EXCEPTION WHEN OTHERS THEN
    v_staff_can_select_secrets := false;
  END;

  -- Staff selects pickup_token from orders
  SELECT pickup_token INTO v_pickup_token_val FROM public.orders WHERE id = v_order_id;

  RESET ROLE;

  IF v_staff_can_select_secrets = false AND v_pickup_token_val IS NULL THEN
    INSERT INTO _test_results VALUES (8, 'Secrets isolation & token deprecation', true, 'Staff cannot select secrets (permission denied) and pickup_token is NULL.');
  ELSE
    INSERT INTO _test_results VALUES (8, 'Secrets isolation & token deprecation', false, 'Isolation breach: can_select_secrets=' || v_staff_can_select_secrets || ' token=' || coalesce(v_pickup_token_val, 'NULL'));
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 9: Backfilled in-flight orders receive valid secret & rotating code
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_secret_found boolean;
  v_code_res jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  -- Simulate an existing order that was backfilled by migration 0013
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD9', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );

  -- Execute backfill query exactly as done in 0013
  INSERT INTO public.order_pickup_secrets (order_id, secret, failed_pin_attempts)
  SELECT 
    o.id, 
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    0
  FROM public.orders o
  WHERE o.id = v_order_id
  ON CONFLICT (order_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM public.order_pickup_secrets WHERE order_id = v_order_id
  ) INTO v_secret_found;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.student_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_code_res := public.get_pickup_code(v_order_id);

  RESET ROLE;

  IF v_secret_found AND (v_code_res->>'ok')::boolean = true AND length(v_code_res->>'code') = 6 THEN
    INSERT INTO _test_results VALUES (9, 'Backfilled order secret & TOTP code', true, 'In-flight orders backfilled seamlessly and generate 6-digit TOTP code.');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Backfilled order secret & TOTP code', false, 'Backfill check failed: secret_found=' || v_secret_found || ' code=' || v_code_res::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 10: PIN Lockout after 3 failed attempts
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_res1 jsonb;
  v_res2 jsonb;
  v_res3 jsonb;
  v_res4 jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, ready_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD10', 'READY'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    6000, now(), now() + interval '30 min', 5, now(), now()
  );
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, env.item_norm_id, 'Standard Thali', 6000, 1);
  INSERT INTO public.order_pickup_secrets (order_id, secret, failed_pin_attempts)
  VALUES (v_order_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 0);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.staff1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res1 := public.preview_collection(env.canteen_id, v_order_id::text, NULL, '0001');
  v_res2 := public.preview_collection(env.canteen_id, v_order_id::text, NULL, '0002');
  v_res3 := public.preview_collection(env.canteen_id, v_order_id::text, NULL, '0003');
  v_res4 := public.preview_collection(env.canteen_id, v_order_id::text, NULL, '0004');

  RESET ROLE;

  IF (v_res1->>'error') = 'INVALID_PIN'
     AND (v_res2->>'error') = 'INVALID_PIN'
     AND (v_res3->>'error') = 'PIN_LOCKED'
     AND (v_res4->>'error') = 'PIN_LOCKED' THEN
    INSERT INTO _test_results VALUES (10, 'PIN lockout after 3 failed attempts', true, 'Third failure triggers PIN_LOCKED and subsequent attempts remain locked.');
  ELSE
    INSERT INTO _test_results VALUES (10, 'PIN lockout after 3 failed attempts', false, 'Lockout failed: 1=' || v_res1::text || ' 2=' || v_res2::text || ' 3=' || v_res3::text || ' 4=' || v_res4::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 11: "Not me" Unauthorized Dispute Reporting (24h window & 3-report limit)
-- ==============================================================================
DO $$
DECLARE
  env RECORD;
  v_order_id uuid := gen_random_uuid();
  v_old_order_id uuid := gen_random_uuid();
  v_res_valid jsonb;
  v_res_dup jsonb;
  v_res_expired jsonb;
  i integer;
  v_dummy_id uuid;
  v_res_cap jsonb;
BEGIN
  SELECT * INTO env FROM _test_env;

  -- 1. Valid COLLECTED order (collected just now)
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    v_order_id, env.canteen_id, env.student_id, 'TSTORD11A', 'COLLECTED'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    6000, now(), now(), 5, now(), now()
  );

  -- 2. Expired COLLECTED order (collected 25 hours ago)
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    v_old_order_id, env.canteen_id, env.student_id, 'TSTORD11B', 'COLLECTED'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    6000, now(), now(), 5, now() - interval '26 hours', now() - interval '25 hours'
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.student_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Attempt on expired order
  v_res_expired := public.report_unauthorized_collection(v_old_order_id, 'I was away from college');

  -- Valid report
  v_res_valid := public.report_unauthorized_collection(v_order_id, 'I was in exam hall');

  -- Duplicate report on same order
  v_res_dup := public.report_unauthorized_collection(v_order_id, 'Second report attempt');

  RESET ROLE;

  -- Seed 2 more reports to reach monthly limit of 3
  FOR i IN 1..2 LOOP
    v_dummy_id := gen_random_uuid();
    INSERT INTO public.orders (
      id, canteen_id, user_id, order_code, status, payment_method, payment_status,
      total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
    ) VALUES (
      v_dummy_id, env.canteen_id, env.student_id, 'DUMORD' || i, 'COLLECTED'::public.order_status,
      'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
      6000, now(), now(), 5, now(), now()
    );
    INSERT INTO public.order_collection_reports (order_id, reporter_id, canteen_id, reason)
    VALUES (v_dummy_id, env.student_id, env.canteen_id, 'Seed report ' || i);
  END LOOP;

  -- 4th report attempt
  v_dummy_id := gen_random_uuid();
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    v_dummy_id, env.canteen_id, env.student_id, 'DUMORD4', 'COLLECTED'::public.order_status,
    'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    6000, now(), now(), 5, now(), now()
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', env.student_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_res_cap := public.report_unauthorized_collection(v_dummy_id, 'Fourth report attempt');
  RESET ROLE;

  IF (v_res_expired->>'error') = 'REPORT_WINDOW_EXPIRED'
     AND (v_res_valid->>'ok')::boolean = true
     AND (v_res_dup->>'error') = 'ALREADY_REPORTED'
     AND (v_res_cap->>'error') = 'REPORT_LIMIT_EXCEEDED' THEN
    INSERT INTO _test_results VALUES (11, 'Dispute reporting window & limits', true, '24h window, single report uniqueness, and 3-report monthly cap enforced.');
  ELSE
    INSERT INTO _test_results VALUES (11, 'Dispute reporting window & limits', false, 'Dispute checks failed: expired=' || v_res_expired::text || ' valid=' || v_res_valid::text || ' dup=' || v_res_dup::text || ' cap=' || v_res_cap::text);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 12: Schema Signatures (verify_pickup dropped, place_order overload unique)
-- ==============================================================================
DO $$
DECLARE
  v_place_order_count integer;
  v_verify_pickup_count integer;
BEGIN
  -- Count overloads of place_order in pg_proc
  SELECT count(*) INTO v_place_order_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'place_order';

  -- Count overloads of verify_pickup
  SELECT count(*) INTO v_verify_pickup_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'verify_pickup';

  IF v_place_order_count = 1 AND v_verify_pickup_count = 0 THEN
    INSERT INTO _test_results VALUES (12, 'Schema signatures cleanup', true, 'Exactly one place_order overload exists; verify_pickup completely dropped.');
  ELSE
    INSERT INTO _test_results VALUES (12, 'Schema signatures cleanup', false, 'Signature mismatch: place_order count=' || v_place_order_count || ' verify_pickup count=' || v_verify_pickup_count);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 13: Anonymous Role Execution Denied
-- ==============================================================================
DO $$
DECLARE
  v_get_code_err text;
  v_prev_err text;
  v_col_err text;
  v_hmac_err text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;

  BEGIN PERFORM public.get_pickup_code(gen_random_uuid()); EXCEPTION WHEN OTHERS THEN v_get_code_err := SQLERRM; END;
  BEGIN PERFORM public.preview_collection(gen_random_uuid(), 'CN10001', '123456', NULL); EXCEPTION WHEN OTHERS THEN v_prev_err := SQLERRM; END;
  BEGIN PERFORM public.collect_order(gen_random_uuid(), '123456', 'CASH', 'SCAN', NULL, NULL); EXCEPTION WHEN OTHERS THEN v_col_err := SQLERRM; END;
  BEGIN PERFORM public.pickup_hmac('key', 'msg'); EXCEPTION WHEN OTHERS THEN v_hmac_err := SQLERRM; END;

  RESET ROLE;

  IF (v_get_code_err LIKE '%permission denied%' OR v_get_code_err LIKE '%UNAUTHENTICATED%')
     AND (v_prev_err LIKE '%permission denied%' OR v_prev_err LIKE '%UNAUTHENTICATED%')
     AND (v_col_err LIKE '%permission denied%' OR v_col_err LIKE '%UNAUTHENTICATED%')
     AND v_hmac_err LIKE '%permission denied%' THEN
    INSERT INTO _test_results VALUES (13, 'Anon execution blocked', true, 'Anon denied execute privilege on all collection core routines.');
  ELSE
    INSERT INTO _test_results VALUES (13, 'Anon execution blocked', false, 'Anon check failed: get=' || coalesce(v_get_code_err, 'NONE') || ' prev=' || coalesce(v_prev_err, 'NONE') || ' col=' || coalesce(v_col_err, 'NONE') || ' hmac=' || coalesce(v_hmac_err, 'NONE'));
  END IF;
END;
$$;

-- ==============================================================================
-- TEST RESULTS DISPLAY & ROLLBACK
-- ==============================================================================
DO $$
DECLARE
  v_failed_count integer;
  v_total_count integer;
  r RECORD;
BEGIN
  SELECT count(*) INTO v_total_count FROM _test_results;
  SELECT count(*) INTO v_failed_count FROM _test_results WHERE passed = false;

  RAISE NOTICE '==============================================================';
  RAISE NOTICE 'PHASE COLLECTION CORE TEST SUITE: % / % PASSED', (v_total_count - v_failed_count), v_total_count;
  RAISE NOTICE '==============================================================';

  FOR r IN SELECT * FROM _test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE 'PASS [%]: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE 'FAIL [%]: % - %', r.test_num, r.test_name, r.details;
    END IF;
  END LOOP;

  IF v_failed_count > 0 THEN
    RAISE EXCEPTION 'TEST_SUITE_FAILED: % tests failed in collection core suite', v_failed_count;
  END IF;
END;
$$;

SELECT test_num, test_name, passed, details FROM _test_results ORDER BY test_num;

ROLLBACK;
