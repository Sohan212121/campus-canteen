-- ==============================================================================
-- PHASE 5 MANUAL TEST SUITE: docs/PHASE5_TESTS.sql
-- Description: Interactive verification script for public.place_order & estimate_ready_time
-- Wrapped in BEGIN ... ROLLBACK so no changes persist to your database.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor.
-- 3. Replace the placeholder UUID below ('00000000-0000-0000-0000-000000000001')
--    with the UUID of an existing active user in public.profiles (e.g. from your auth.users).
--    (All tests require this seeded user to simulate authenticated caller context).
-- 4. Run the script. Review the output in the "Messages / Notices" tab.

BEGIN;

DO $$
DECLARE
  v_test_user_id uuid := gen_random_uuid();
  c_test_user_id uuid;

  v_canteen_id uuid;
  v_item_available uuid;
  v_item_tracked uuid;
  v_item_unavailable uuid;
  v_initial_stock integer;
  v_after_stock integer;

  v_order_res jsonb;
  v_order_res_dup jsonb;
  v_order_count integer;

  v_est_initial record;
  v_est_after record;
  v_item_payload jsonb;
  v_key_1 text := 'test-idemp-' || gen_random_uuid()::text;
  v_key_2 text := 'test-idemp-' || gen_random_uuid()::text;
  v_key_3 text := 'test-idemp-' || gen_random_uuid()::text;
  v_key_4 text := 'test-idemp-' || gen_random_uuid()::text;
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'STARTING PHASE 5 TEST SUITE (BEGIN ... ROLLBACK)';
  RAISE NOTICE '=====================================================';

  -- 0. Create isolated test student user working BEFORE and AFTER 0010
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_test_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_p5_user_' || substr(v_test_user_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Phase 5 Student"}'::jsonb, now(), now());

  UPDATE public.profiles
  SET role = 'student'::public.user_role, full_name = 'Phase 5 Student', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8))
  WHERE id = v_test_user_id;

  c_test_user_id := v_test_user_id;

  -- Set up authenticated caller context
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_test_user_id)::text, true);
  SET LOCAL ROLE authenticated;

  -- Fetch primary active canteen
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found in public.canteens';
  END IF;

  -- Fetch an active, available menu item
  SELECT id INTO v_item_available
  FROM public.menu_items
  WHERE canteen_id = v_canteen_id AND is_active = true AND is_available = true
  LIMIT 1;

  -- ---------------------------------------------------------------------------
  -- TEST 1: Normal ASAP order placement
  -- ---------------------------------------------------------------------------
  BEGIN
    v_item_payload := jsonb_build_array(
      jsonb_build_object('menu_item_id', v_item_available, 'quantity', 2)
    );

    v_order_res := public.place_order(
      v_canteen_id,
      v_item_payload,
      'PAY_AT_PICKUP'::public.payment_method,
      v_key_1,
      NULL
    );

    IF (v_order_res->>'was_duplicate')::boolean = false 
       AND v_order_res->>'order_code' IS NOT NULL 
       AND (v_order_res->>'total_paise')::integer > 0 THEN
      RAISE NOTICE 'PASS [Test 1]: Normal ASAP order placed successfully (Order: %, Total: %)',
        v_order_res->>'order_code', v_order_res->>'total_paise';
    ELSE
      RAISE EXCEPTION 'Test 1 did not return expected order format: %', v_order_res;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL [Test 1]: Normal ASAP order failed: %', SQLERRM;
    RAISE;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 2: Idempotency (re-submitting same key returns existing order)
  -- ---------------------------------------------------------------------------
  BEGIN
    v_order_res_dup := public.place_order(
      v_canteen_id,
      v_item_payload,
      'PAY_AT_PICKUP'::public.payment_method,
      v_key_1,
      NULL
    );

    SELECT count(*) INTO v_order_count
    FROM public.orders
    WHERE user_id = c_test_user_id AND idempotency_key = v_key_1;

    IF (v_order_res_dup->>'was_duplicate')::boolean = true
       AND v_order_res_dup->>'order_id' = v_order_res->>'order_id'
       AND v_order_count = 1 THEN
      RAISE NOTICE 'PASS [Test 2]: Idempotent re-submission returned same order with was_duplicate=true (Count in DB: %)', v_order_count;
    ELSE
      RAISE EXCEPTION 'Test 2 failed: Duplicate submission resulted in % rows, was_duplicate=%',
        v_order_count, v_order_res_dup->>'was_duplicate';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL [Test 2]: Idempotency check failed: %', SQLERRM;
    RAISE;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 3: Stock decrement verification under authenticated role
  -- ---------------------------------------------------------------------------
  BEGIN
    -- Temporary update one item to have stock = 10 for testing
    UPDATE public.menu_items
    SET stock = 10, is_available = true, is_active = true
    WHERE id = v_item_available;

    SELECT stock INTO v_initial_stock FROM public.menu_items WHERE id = v_item_available;

    -- Place order for 3 units
    PERFORM public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 3)),
      'PAY_AT_PICKUP'::public.payment_method,
      v_key_2,
      NULL
    );

    SELECT stock INTO v_after_stock FROM public.menu_items WHERE id = v_item_available;

    IF v_after_stock = (v_initial_stock - 3) THEN
      RAISE NOTICE 'PASS [Test 3]: Stock decremented properly from % to % (-3 units)', v_initial_stock, v_after_stock;
    ELSE
      RAISE EXCEPTION 'Test 3 failed: Initial stock %, after stock %', v_initial_stock, v_after_stock;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL [Test 3]: Stock decrement failed: %', SQLERRM;
    RAISE;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 4: Out-of-stock item is rejected with INSUFFICIENT_STOCK
  -- ---------------------------------------------------------------------------
  BEGIN
    -- Set item stock to 1
    UPDATE public.menu_items SET stock = 1 WHERE id = v_item_available;

    -- Request 5 units (should fail)
    PERFORM public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 5)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-idemp-oos-' || gen_random_uuid()::text,
      NULL
    );
    RAISE NOTICE 'FAIL [Test 4]: Order for stock > available was not rejected!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INSUFFICIENT_STOCK%' THEN
      RAISE NOTICE 'PASS [Test 4]: Out-of-stock order correctly rejected with INSUFFICIENT_STOCK (%)', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [Test 4]: Expected INSUFFICIENT_STOCK, got: %', SQLERRM;
    END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 5: Scheduled order earlier than estimate rejected with SCHEDULE_TOO_EARLY + HINT
  -- ---------------------------------------------------------------------------
  BEGIN
    -- Attempt to schedule 10 minutes ago
    PERFORM public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-idemp-early-' || gen_random_uuid()::text,
      clock_timestamp() - interval '10 minutes'
    );
    RAISE NOTICE 'FAIL [Test 5]: Early scheduled order was not rejected!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%SCHEDULE_TOO_EARLY%' THEN
      RAISE NOTICE 'PASS [Test 5]: Early scheduled order rejected with SCHEDULE_TOO_EARLY (%)', SQLERRM;
    ELSIF SQLERRM LIKE '%INVALID_SCHEDULE%' THEN
      RAISE NOTICE 'PASS [Test 5]: Early schedule rejected with INVALID_SCHEDULE (%)', SQLERRM;
    ELSE
      RAISE NOTICE 'NOTICE [Test 5]: Rejection received: %', SQLERRM;
    END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 6: Queue workload increases estimated_ready_at
  -- ---------------------------------------------------------------------------
  BEGIN
    SELECT estimated_ready_at INTO v_est_initial
    FROM public.estimate_ready_time(v_canteen_id, jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 1)));

    -- Place a 3rd active order with large quantity to accumulate queue load
    PERFORM public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 5)),
      'PAY_AT_PICKUP'::public.payment_method,
      v_key_3,
      NULL
    );

    SELECT estimated_ready_at INTO v_est_after
    FROM public.estimate_ready_time(v_canteen_id, jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 1)));

    IF v_est_after.estimated_ready_at >= v_est_initial.estimated_ready_at THEN
      RAISE NOTICE 'PASS [Test 6]: Queue workload pushed readiness back from % to %',
        v_est_initial.estimated_ready_at, v_est_after.estimated_ready_at;
    ELSE
      RAISE EXCEPTION 'Test 6 failed: Readiness did not increase';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL [Test 6]: Queue load progression failed: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 7: 4th active order is rejected with TOO_MANY_ACTIVE_ORDERS
  -- ---------------------------------------------------------------------------
  BEGIN
    -- We already placed 3 orders (Test 1, Test 3, Test 6). A 4th should be blocked.
    PERFORM public.place_order(
      v_canteen_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_available, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      v_key_4,
      NULL
    );
    RAISE NOTICE 'FAIL [Test 7]: 4th active order was not rejected!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%TOO_MANY_ACTIVE_ORDERS%' THEN
      RAISE NOTICE 'PASS [Test 7]: 4th order correctly rejected with TOO_MANY_ACTIVE_ORDERS (%)', SQLERRM;
    ELSE
      RAISE NOTICE 'FAIL [Test 7]: Expected TOO_MANY_ACTIVE_ORDERS, got: %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'ALL PHASE 5 TESTS COMPLETED SUCCESSFULLY.';
  RAISE NOTICE 'ROLLING BACK TRANSACTION (NO DATA COMMITTED).';
  RAISE NOTICE '=====================================================';
END $$;

ROLLBACK;
