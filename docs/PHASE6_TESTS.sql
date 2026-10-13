-- ==============================================================================
-- PHASE 6 MANUAL TEST SUITE: docs/PHASE6_TESTS.sql
-- Description: Interactive verification script for public.cancel_order,
--              status notification triggers, stock restoration, and idempotency.
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
  v_user1_id    uuid;
  v_user2_id    uuid;
  v_canteen_id  uuid;
  v_item_id     uuid;
  v_item_stock  integer := 25;
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'PHASE 6 TEST SUITE: SETUP (Role: postgres)';
  RAISE NOTICE '=====================================================';

  -- Create isolated test student users working BEFORE and AFTER 0010
  v_user1_id := gen_random_uuid();
  v_user2_id := gen_random_uuid();

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_user1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p6_u1_' || substr(v_user1_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Test User 1"}'::jsonb, now(), now()),
    (v_user2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p6_u2_' || substr(v_user2_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Test User 2"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'student'::public.user_role, full_name = 'Test User 1', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8))
  WHERE id = v_user1_id;

  UPDATE public.profiles
  SET role = 'student'::public.user_role, full_name = 'Test User 2', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8))
  WHERE id = v_user2_id;

  -- Temporarily clear active orders for test users so the 3-active-order cap cannot interfere
  -- (The entire script is wrapped in BEGIN ... ROLLBACK so changes are automatically reverted)
  UPDATE public.orders
  SET status = 'COLLECTED'::public.order_status
  WHERE user_id IN (v_user1_id, v_user2_id)
    AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');

  -- Locate active canteen
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true LIMIT 1;
  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found in public.canteens.';
  END IF;

  -- Locate or configure an active menu item with inventory tracking
  SELECT id INTO v_item_id 
  FROM public.menu_items 
  WHERE canteen_id = v_canteen_id AND is_active = true AND is_available = true 
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active menu item found for canteen %', v_canteen_id;
  END IF;

  -- Ensure item has initial stock set for restoration tests
  UPDATE public.menu_items SET stock = v_item_stock WHERE id = v_item_id;

  INSERT INTO _test_env (key, val_uuid, val_int) VALUES
    ('user1_id', v_user1_id, NULL),
    ('user2_id', v_user2_id, NULL),
    ('canteen_id', v_canteen_id, NULL),
    ('item_id', v_item_id, v_item_stock);

  RAISE NOTICE 'Setup complete: User1=%, User2=%, Canteen=%, Item=%', 
    v_user1_id, v_user2_id, v_canteen_id, v_item_id;
END;
$$;


-- ==============================================================================
-- TEST 1: Cancel PLACED order + stock restored + notification inserted
-- ==============================================================================
DO $$
DECLARE
  v_user1_id     uuid;
  v_canteen_id   uuid;
  v_item_id      uuid;
  v_stock_init   integer;
  v_stock_mid    integer;
  v_stock_after  integer;
  v_order_id     uuid;
  v_place_res    jsonb;
  v_cancel_res   jsonb;
  v_notif_count  integer;
  v_status       public.order_status;
  v_err_msg      text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_user1_id FROM _test_env WHERE key = 'user1_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid, val_int INTO v_item_id, v_stock_init FROM _test_env WHERE key = 'item_id';

  -- 1. Call place_order as authenticated user 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_place_res := public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 2)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-p6-cancel-' || gen_random_uuid()::text,
      NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'place_order failed: ' || v_err_msg);
    RETURN;
  END IF;

  v_order_id := (v_place_res->>'order_id')::uuid;
  INSERT INTO _test_env (key, val_uuid) VALUES ('order1_id', v_order_id);

  -- Verify intermediate stock decrement
  SELECT stock INTO v_stock_mid FROM public.menu_items WHERE id = v_item_id;
  IF v_stock_mid != (v_stock_init - 2) THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'Stock not decremented on placement. Got ' || coalesce(v_stock_mid::text, 'NULL') || ', expected ' || (v_stock_init - 2));
    RETURN;
  END IF;

  -- 2. Call cancel_order as authenticated user 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_cancel_res := public.cancel_order(v_order_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'cancel_order threw unexpected exception: ' || v_err_msg);
    RETURN;
  END IF;

  -- Verify return payload
  IF (v_cancel_res->>'status') != 'CANCELLED' OR (v_cancel_res->>'was_already_cancelled')::boolean != false THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'Unexpected cancel_order return payload: ' || v_cancel_res::text);
    RETURN;
  END IF;

  -- Verify order status in DB
  SELECT status INTO v_status FROM public.orders WHERE id = v_order_id;
  IF v_status != 'CANCELLED'::public.order_status THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'DB status is ' || coalesce(v_status::text, 'NULL') || ', expected CANCELLED');
    RETURN;
  END IF;

  -- Verify stock restoration (+2)
  SELECT stock INTO v_stock_after FROM public.menu_items WHERE id = v_item_id;
  IF v_stock_after != v_stock_init THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'Stock not restored. Got ' || coalesce(v_stock_after::text, 'NULL') || ', expected ' || v_stock_init);
    RETURN;
  END IF;

  -- Verify cancellation notification
  SELECT count(*) INTO v_notif_count 
  FROM public.notifications 
  WHERE order_id = v_order_id AND title = 'Order Cancelled' AND user_id = v_user1_id;

  IF v_notif_count < 1 THEN
    INSERT INTO _test_results VALUES (1, 'Cancel PLACED order', false, 'Cancellation notification not found in public.notifications');
    RETURN;
  END IF;

  INSERT INTO _test_results VALUES (1, 'Cancel PLACED order + stock restored', true, 'Order marked CANCELLED, stock restored (+2), notification generated.');
  RAISE NOTICE 'PASS [Test 1]: Cancel PLACED order + stock restored';
END;
$$;


-- ==============================================================================
-- TEST 2: Double cancel idempotent check
-- ==============================================================================
DO $$
DECLARE
  v_user1_id    uuid;
  v_order_id    uuid;
  v_cancel_res  jsonb;
  v_err_msg     text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_user1_id FROM _test_env WHERE key = 'user1_id';
  SELECT val_uuid INTO v_order_id FROM _test_env WHERE key = 'order1_id';

  IF v_order_id IS NULL THEN
    INSERT INTO _test_results VALUES (2, 'Double cancel idempotent', false, 'Test 1 order ID missing.');
    RETURN;
  END IF;

  -- Call cancel_order a second time on the already cancelled order
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_cancel_res := public.cancel_order(v_order_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (2, 'Double cancel idempotent', false, 'Idempotent cancel_order failed with exception: ' || v_err_msg);
    RETURN;
  END IF;

  IF (v_cancel_res->>'status') = 'CANCELLED' AND (v_cancel_res->>'was_already_cancelled')::boolean = true THEN
    INSERT INTO _test_results VALUES (2, 'Double cancel idempotent', true, 'Idempotently returned already-cancelled order with was_already_cancelled = true');
    RAISE NOTICE 'PASS [Test 2]: Double cancel idempotent';
  ELSE
    INSERT INTO _test_results VALUES (2, 'Double cancel idempotent', false, 'Expected was_already_cancelled = true, got: ' || v_cancel_res::text);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 3: Cancel PREPARING order rejected (NOT_CANCELLABLE)
-- ==============================================================================
DO $$
DECLARE
  v_user1_id    uuid;
  v_canteen_id  uuid;
  v_item_id     uuid;
  v_order_id    uuid;
  v_place_res   jsonb;
  v_err_caught  boolean := false;
  v_err_msg     text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_user1_id FROM _test_env WHERE key = 'user1_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order as user 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_place_res := public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-p6-prep-' || gen_random_uuid()::text,
      NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg != '' THEN
    INSERT INTO _test_results VALUES (3, 'Cancel PREPARING rejected', false, 'place_order failed: ' || v_err_msg);
    RETURN;
  END IF;

  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Advance order to PREPARING as kitchen staff / postgres
  UPDATE public.orders SET status = 'PREPARING'::public.order_status WHERE id = v_order_id;

  -- Attempt cancellation as student
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.cancel_order(v_order_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%NOT_CANCELLABLE%' THEN
    INSERT INTO _test_results VALUES (3, 'Cancel PREPARING rejected', true, 'Correctly rejected with NOT_CANCELLABLE: ' || v_err_msg);
    RAISE NOTICE 'PASS [Test 3]: Cancel PREPARING rejected with NOT_CANCELLABLE';
  ELSE
    INSERT INTO _test_results VALUES (3, 'Cancel PREPARING rejected', false, 'Failed to reject with NOT_CANCELLABLE. Error caught=' || v_err_caught::text || ' Msg: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 4: Other user order rejected (NOT_FOUND)
-- ==============================================================================
DO $$
DECLARE
  v_user2_id    uuid;
  v_order1_id   uuid;
  v_err_caught  boolean := false;
  v_err_msg     text := '';
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_user2_id FROM _test_env WHERE key = 'user2_id';
  SELECT val_uuid INTO v_order1_id FROM _test_env WHERE key = 'order1_id';

  IF v_order1_id IS NULL THEN
    INSERT INTO _test_results VALUES (4, 'Other user order NOT_FOUND', false, 'Test 1 order ID missing.');
    RETURN;
  END IF;

  -- Call cancel_order as user 2 on user 1's order
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user2_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.cancel_order(v_order1_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_err_caught := true;
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_caught AND v_err_msg LIKE '%NOT_FOUND%' THEN
    INSERT INTO _test_results VALUES (4, 'Other user order NOT_FOUND', true, 'Correctly rejected cross-user order cancel with NOT_FOUND: ' || v_err_msg);
    RAISE NOTICE 'PASS [Test 4]: Other user order NOT_FOUND';
  ELSE
    INSERT INTO _test_results VALUES (4, 'Other user order NOT_FOUND', false, 'Failed to enforce caller ownership: ' || v_err_msg);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 5: READY trigger notification created
-- ==============================================================================
DO $$
DECLARE
  v_user1_id    uuid;
  v_canteen_id  uuid;
  v_item_id     uuid;
  v_order_id    uuid;
  v_place_res   jsonb;
  v_notif_title text;
  v_notif_body  text;
  v_err_msg     text;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_user1_id FROM _test_env WHERE key = 'user1_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Place order as user 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user1_id)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_place_res := public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_id, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-p6-ready-' || gen_random_uuid()::text,
      NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  IF v_err_msg IS NOT NULL THEN
    INSERT INTO _test_results VALUES (5, 'READY trigger notification', false, 'place_order failed: ' || v_err_msg);
    RETURN;
  END IF;

  v_order_id := (v_place_res->>'order_id')::uuid;

  -- Update order to READY as kitchen staff / postgres
  UPDATE public.orders SET status = 'READY'::public.order_status WHERE id = v_order_id;

  -- Verify notification was inserted by trg_order_status_notification
  SELECT title, body
  INTO v_notif_title, v_notif_body
  FROM public.notifications
  WHERE order_id = v_order_id AND title = 'Order Ready' AND user_id = v_user1_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_notif_title = 'Order Ready' AND v_notif_body = 'Your order is ready for pickup.' THEN
    INSERT INTO _test_results VALUES (5, 'READY trigger notification', true, 'Notification generated with PRD copy: "' || v_notif_body || '"');
    RAISE NOTICE 'PASS [Test 5]: READY trigger notification';
  ELSE
    INSERT INTO _test_results VALUES (5, 'READY trigger notification', false, 'Expected Order Ready notification, found title=' || coalesce(v_notif_title, 'NULL') || ' body=' || coalesce(v_notif_body, 'NULL'));
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
  RAISE NOTICE 'PHASE 6 TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
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
  ELSIF v_total < 5 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 5 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Phase 6 test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
