-- ==============================================================================
-- PHASE 7 MANUAL TEST SUITE: docs/PHASE7_TESTS.sql
-- Description: Interactive verification script for public.transition_order,
--              public.verify_pickup, rate limiting, and staff security boundaries.
-- Wrapped in BEGIN ... ROLLBACK so no changes persist to your database.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor and click Run.
-- 3. Review the output in the "Messages / Notices" tab.
--
-- NOTE ON OPERATING HOURS:
-- Pre-order placement requires the canteen to be open right now in Asia/Kolkata (IST).
-- If executing outside standard canteen operating hours (08:00 - 17:00 IST),
-- temporarily widen the active canteen hours in Supabase SQL Editor before testing:
--   UPDATE public.canteens SET opens_at = '00:00:00', closes_at = '23:59:59', last_order_time = '23:59:00';

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
  val_int integer,
  val_text text
);

-- Grant access on temp tables to authenticated role as defense-in-depth
GRANT ALL ON TABLE _test_results TO authenticated;
GRANT ALL ON TABLE _test_env TO authenticated;

-- ==============================================================================
-- SETUP BLOCK: Executed as postgres BEFORE SET LOCAL ROLE authenticated
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_staff2_id    uuid;
  v_canteen1_id  uuid;
  v_canteen2_id  uuid;
  v_item_id      uuid;
  v_item_stock   integer := 30;
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'PHASE 7 TEST SUITE: SETUP (Role: postgres)';
  RAISE NOTICE '=====================================================';

  -- 1. Locate primary active canteen (Canteen 1)
  SELECT id INTO v_canteen1_id FROM public.canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF v_canteen1_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found in public.canteens.';
  END IF;

  -- 2. Create temporary second canteen (Canteen 2) for cross-canteen boundary testing
  INSERT INTO public.canteens (
    name,
    location,
    kitchen_capacity,
    opens_at,
    closes_at,
    last_order_time,
    is_active
  ) VALUES (
    'Temp Test Canteen 2 ' || substr(gen_random_uuid()::text, 1, 8),
    'North Campus Annex',
    3,
    '00:00:00'::time,
    '23:59:59'::time,
    '23:59:00'::time,
    true
  ) RETURNING id INTO v_canteen2_id;

  -- 3. Create isolated test users working BEFORE and AFTER 0010
  v_student_id := gen_random_uuid();
  v_staff1_id  := gen_random_uuid();
  v_staff2_id  := gen_random_uuid();

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_student_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p7_stu_' || substr(v_student_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Test Student"}'::jsonb, now(), now()),
    (v_staff1_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p7_st1_' || substr(v_staff1_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Test Staff 1"}'::jsonb, now(), now()),
    (v_staff2_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p7_st2_' || substr(v_staff2_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Test Staff 2"}'::jsonb, now(), now());

  -- 4. Configure profile roles for the test run
  UPDATE public.profiles SET role = 'student'::public.user_role, canteen_id = NULL, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen1_id, is_active = true WHERE id = v_staff1_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen2_id, is_active = true WHERE id = v_staff2_id;

  -- 5. Clear active orders for test users so active order limit (3) cannot interfere
  UPDATE public.orders
  SET status = 'COLLECTED'::public.order_status
  WHERE user_id IN (v_student_id, v_staff1_id, v_staff2_id)
    AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');

  -- 6. Locate or configure menu item in Canteen 1
  SELECT id INTO v_item_id
  FROM public.menu_items
  WHERE canteen_id = v_canteen1_id AND is_active = true AND is_available = true
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active menu item found for canteen %', v_canteen1_id;
  END IF;

  UPDATE public.menu_items SET stock = v_item_stock WHERE id = v_item_id;

  INSERT INTO _test_env (key, val_uuid, val_int) VALUES
    ('student_id', v_student_id, NULL),
    ('staff1_id', v_staff1_id, NULL),
    ('staff2_id', v_staff2_id, NULL),
    ('canteen1_id', v_canteen1_id, NULL),
    ('canteen2_id', v_canteen2_id, NULL),
    ('item_id', v_item_id, v_item_stock);

  RAISE NOTICE 'Setup complete: Student=%, Staff1=%, Staff2=%, Canteen1=%, Canteen2=%',
    v_student_id, v_staff1_id, v_staff2_id, v_canteen1_id, v_canteen2_id;
END;
$$;


-- ==============================================================================
-- TEST 1: Valid sequential transition chain PLACED -> ACCEPTED -> PREPARING -> READY -> COLLECTED
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_trans_res    jsonb;
  v_order_rec    record;
  v_err_msg      text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order as student
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_place_res := public.place_order(
      v_canteen1_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'p7-test1-' || gen_random_uuid()::text,
      NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (1, 'Valid transition chain', false, 'place_order failed: ' || v_err_msg);
    RETURN;
  END IF;

  v_order_id := (v_place_res->>'order_id')::uuid;
  INSERT INTO _test_env (key, val_uuid) VALUES ('test1_order_id', v_order_id);

  -- Perform transitions sequentially as Staff 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. PLACED -> ACCEPTED
  BEGIN
    v_trans_res := public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
  EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;

  -- 2. ACCEPTED -> PREPARING
  IF v_err_msg IS NULL THEN
    BEGIN
      v_trans_res := public.transition_order(v_order_id, 'PREPARING'::public.order_status);
    EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;
  END IF;

  -- 3. PREPARING -> READY
  IF v_err_msg IS NULL THEN
    BEGIN
      v_trans_res := public.transition_order(v_order_id, 'READY'::public.order_status);
    EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;
  END IF;

  -- 4. READY -> COLLECTED
  IF v_err_msg IS NULL THEN
    BEGIN
      v_trans_res := public.transition_order(v_order_id, 'COLLECTED'::public.order_status);
    EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;
  END IF;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (1, 'Valid transition chain', false, 'transition_order failed: ' || v_err_msg);
    RETURN;
  END IF;

  -- Verify final order state: status COLLECTED, payment_status PAID (for PAY_AT_PICKUP)
  SELECT status, payment_status, accepted_at, preparing_at, ready_at, collected_at
  INTO v_order_rec
  FROM public.orders WHERE id = v_order_id;

  IF v_order_rec.status = 'COLLECTED'::public.order_status
     AND v_order_rec.payment_status = 'PAID'::public.payment_status
     AND v_order_rec.accepted_at IS NOT NULL
     AND v_order_rec.preparing_at IS NOT NULL
     AND v_order_rec.ready_at IS NOT NULL
     AND v_order_rec.collected_at IS NOT NULL THEN
    INSERT INTO _test_results VALUES (1, 'Valid transition chain', true, 'Full lifecycle transitioned successfully; payment marked PAID on collect.');
    RAISE NOTICE 'PASS [Test 1]: Valid sequential transition chain';
  ELSE
    INSERT INTO _test_results VALUES (1, 'Valid transition chain', false, 'State mismatch after transitions: status=' || coalesce(v_order_rec.status::text, 'NULL') || ' payment=' || coalesce(v_order_rec.payment_status::text, 'NULL'));
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 2: Invalid transition jump rejected (PLACED -> READY raises INVALID_TRANSITION)
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order as student
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test2-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Attempt invalid skip: PLACED directly to READY as Staff 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.transition_order(v_order_id, 'READY'::public.order_status);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%INVALID_TRANSITION%' THEN
    INSERT INTO _test_results VALUES (2, 'Invalid transition jump rejected', true, 'Correctly rejected invalid jump with INVALID_TRANSITION: ' || v_err_msg);
    RAISE NOTICE 'PASS [Test 2]: Invalid transition jump rejected';
  ELSE
    INSERT INTO _test_results VALUES (2, 'Invalid transition jump rejected', false, 'Failed to reject with INVALID_TRANSITION: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 3: Student caller cannot transition orders (FORBIDDEN)
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order as student
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test3-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Attempt transition as student
  BEGIN
    PERFORM public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%FORBIDDEN%' THEN
    INSERT INTO _test_results VALUES (3, 'Student transition rejected', true, 'Correctly rejected student caller with FORBIDDEN.');
    RAISE NOTICE 'PASS [Test 3]: Student caller rejected with FORBIDDEN';
  ELSE
    INSERT INTO _test_results VALUES (3, 'Student transition rejected', false, 'Failed to enforce role check: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 4: Staff of another canteen rejected (FORBIDDEN)
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff2_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff2_id FROM _test_env WHERE key = 'staff2_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order in Canteen 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test4-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Attempt transition as Staff 2 (who belongs to Canteen 2)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff2_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%FORBIDDEN%' THEN
    INSERT INTO _test_results VALUES (4, 'Cross-canteen staff rejected', true, 'Correctly rejected staff of another canteen with FORBIDDEN.');
    RAISE NOTICE 'PASS [Test 4]: Cross-canteen staff rejected with FORBIDDEN';
  ELSE
    INSERT INTO _test_results VALUES (4, 'Cross-canteen staff rejected', false, 'Failed to enforce canteen boundary: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 5: Double tap on same status is an idempotent no-op (was_noop = true)
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_res1         jsonb;
  v_res2         jsonb;
  v_err_msg      text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test5-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  -- First transition to ACCEPTED
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_res1 := public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
    v_res2 := public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
  EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (5, 'Double tap idempotent no-op', false, 'Error during idempotent calls: ' || v_err_msg);
    RETURN;
  END IF;

  IF (v_res1->>'was_noop')::boolean = false AND (v_res2->>'was_noop')::boolean = true THEN
    INSERT INTO _test_results VALUES (5, 'Double tap idempotent no-op', true, 'First tap succeeded, second tap returned was_noop = true.');
    RAISE NOTICE 'PASS [Test 5]: Double tap is a no-op';
  ELSE
    INSERT INTO _test_results VALUES (5, 'Double tap idempotent no-op', false, 'Unexpected noop flags: res1=' || v_res1::text || ' res2=' || v_res2::text);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 6: Reject on PLACED order marks REJECTED and restores inventory stock
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_stock_init   integer;
  v_stock_mid    integer;
  v_stock_after  integer;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_reject_res   jsonb;
  v_err_msg      text;
  v_status       public.order_status;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid, val_int INTO v_item_id, v_stock_init FROM _test_env WHERE key = 'item_id';

  -- Get current stock before placement
  SELECT stock INTO v_stock_init FROM public.menu_items WHERE id = v_item_id;

  -- Place order for 2 units
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 2)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test6-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Reject order as Staff 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_reject_res := public.transition_order(v_order_id, 'REJECTED'::public.order_status);
  EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (6, 'Reject restores stock', false, 'transition_order REJECTED failed: ' || v_err_msg);
    RETURN;
  END IF;

  SELECT status INTO v_status FROM public.orders WHERE id = v_order_id;
  SELECT stock INTO v_stock_after FROM public.menu_items WHERE id = v_item_id;

  IF v_status = 'REJECTED'::public.order_status AND v_stock_after = v_stock_init THEN
    INSERT INTO _test_results VALUES (6, 'Reject restores stock', true, 'Order marked REJECTED and stock (+2) restored.');
    RAISE NOTICE 'PASS [Test 6]: Reject on PLACED order restores inventory stock';
  ELSE
    INSERT INTO _test_results VALUES (6, 'Reject restores stock', false, 'Stock not restored. Initial=' || v_stock_init || ' After=' || v_stock_after || ' Status=' || v_status::text);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 7: verify_pickup matches READY order and fails on non-READY order
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_item_id      uuid;
  v_order_id     uuid;
  v_token        text;
  v_place_res    jsonb;
  v_verify_prep  jsonb;
  v_verify_ready jsonb;
  v_err_msg      text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);
  SET LOCAL ROLE authenticated;

  v_place_res := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'p7-test7-' || gen_random_uuid()::text,
    NULL
  );
  v_order_id := (v_place_res->>'order_id')::uuid;

  RESET ROLE;
  SELECT pickup_token INTO v_token FROM public.orders WHERE id = v_order_id;

  -- Staff 1 attempts verify_pickup while order is in PLACED -> expect found: false
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_verify_prep := public.verify_pickup(v_canteen1_id, v_token);
  EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (7, 'verify_pickup matches READY only', false, 'verify_pickup threw unexpected error: ' || v_err_msg);
    RETURN;
  END IF;

  -- Now advance order to READY
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.transition_order(v_order_id, 'ACCEPTED'::public.order_status);
  PERFORM public.transition_order(v_order_id, 'PREPARING'::public.order_status);
  PERFORM public.transition_order(v_order_id, 'READY'::public.order_status);

  -- Verify pickup on READY order
  BEGIN
    v_verify_ready := public.verify_pickup(v_canteen1_id, v_token);
  EXCEPTION WHEN OTHERS THEN v_err_msg := SQLERRM; END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (7, 'verify_pickup matches READY only', false, 'verify_pickup on READY threw error: ' || v_err_msg);
    RETURN;
  END IF;

  IF (v_verify_prep->>'found')::boolean = false
     AND (v_verify_ready->>'found')::boolean = true
     AND (v_verify_ready->>'order_id')::uuid = v_order_id THEN
    INSERT INTO _test_results VALUES (7, 'verify_pickup matches READY only', true, 'Correctly returned found=false for PLACED order, and found=true with items for READY order.');
    RAISE NOTICE 'PASS [Test 7]: verify_pickup matches READY orders only';
  ELSE
    INSERT INTO _test_results VALUES (7, 'verify_pickup matches READY only', false, 'Payload mismatch: prep=' || v_verify_prep::text || ' ready=' || v_verify_ready::text);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 8: Failed attempts persist and RATE_LIMITED fires on the 11th try
-- ==============================================================================
DO $$
DECLARE
  v_staff1_id    uuid;
  v_canteen1_id  uuid;
  v_res          jsonb;
  v_fail_count   integer;
  v_err_caught   boolean := false;
  v_err_msg      text := '';
  i              integer;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';

  -- Clear previous verify attempts for staff1
  DELETE FROM public.pickup_verify_attempts WHERE user_id = v_staff1_id;

  -- Execute 10 failed verify attempts
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  FOR i IN 1..10 LOOP
    v_res := public.verify_pickup(v_canteen1_id, '999999');
    IF (v_res->>'found')::boolean != false THEN
      RESET ROLE;
      INSERT INTO _test_results VALUES (8, 'Rate limit triggers on 11th failure', false, 'Expected found=false on bogus token');
      RETURN;
    END IF;
  END LOOP;

  -- Verify that all 10 failed attempts persisted in the database ledger
  RESET ROLE;
  SELECT count(*) INTO v_fail_count
  FROM public.pickup_verify_attempts
  WHERE user_id = v_staff1_id AND attempted_at >= now() - interval '5 minutes';

  IF v_fail_count < 10 THEN
    INSERT INTO _test_results VALUES (8, 'Rate limit triggers on 11th failure', false, 'Failed attempts did not persist. Count=' || v_fail_count);
    RETURN;
  END IF;

  -- 11th attempt must raise RATE_LIMITED
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.verify_pickup(v_canteen1_id, '999999');
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%RATE_LIMITED%' THEN
    INSERT INTO _test_results VALUES (8, 'Rate limit triggers on 11th failure', true, '10 failed attempts recorded; 11th attempt correctly rejected with RATE_LIMITED.');
    RAISE NOTICE 'PASS [Test 8]: Rate limit triggers on 11th failed attempt';
  ELSE
    INSERT INTO _test_results VALUES (8, 'Rate limit triggers on 11th failure', false, '11th attempt failed to raise RATE_LIMITED. Caught=' || v_err_caught::text || ' Msg=' || v_err_msg);
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
  RAISE NOTICE 'PHASE 7 TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
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
    RAISE NOTICE 'SUCCESS: All % Phase 7 test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
