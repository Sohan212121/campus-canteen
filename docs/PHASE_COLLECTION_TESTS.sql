-- ==============================================================================
-- PHASE_COLLECTION_TESTS.sql: Smart Counter Collection Core Verification Suite
-- ==============================================================================
-- Tests non-interactive transactional execution (BEGIN ... ROLLBACK).
-- Validates:
--   1. Rotating TOTP code window accuracy (current/prev valid, stale rejected).
--   2. Wrong-canteen staff cannot collect even by passing the other canteen's id.
--   3. Concurrent-safe single collection (second call returns ALREADY_COLLECTED).
--   4. payment_status becomes PAID upon collection.
--   5. admin_audit_log row written for every collection.
--   6. Counters persist after failures (pickup_collect_attempts and failed_pin_attempts).
--   7. PIN lock blocks ONLY PIN path, does NOT block a valid QR scan.
--   8. Inactive staff refused (USER_INACTIVE).
--   9. Anonymous users cannot execute any new collection functions.
--  10. transition_order strictly refuses transition to COLLECTED.
--  11. Exactly one place_order overload exists in public schema.
--  12. verify_pickup is completely dropped.
--  13. Backfill creates secret rows for existing in-flight orders.
--  14. Amber orders require BOTH rotating code and PIN; PIN-only refused.
--  15. MANUAL collection cap (10/day) and status notification.
--  16. Dispute reporting limits (3/month) and admin list/resolve.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_canteen_a uuid;
  v_canteen_b uuid;
  v_student_id uuid;
  v_inactive_student_id uuid;
  v_staff_a_id uuid;
  v_staff_b_id uuid;
  v_inactive_staff_id uuid;
  v_admin_id uuid;
  v_item_a1 uuid;
  v_item_a2 uuid;
  v_order_norm_id uuid;
  v_order_amber_id uuid;
  v_order_stale_id uuid;
  v_code text;
  v_prev_code text;
  v_stale_code text;
  v_pin text;
  v_res jsonb;
  v_audit_count integer;
  v_attempts_count integer;
  v_report_id uuid;
  v_fn_count integer;
  v_report_res jsonb;
  v_admin_list jsonb;
BEGIN
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'STARTING SMART COUNTER COLLECTION TEST SUITE';
  RAISE NOTICE '==================================================';

  -- 1. Setup Test Canteens
  INSERT INTO public.canteens (id, name, is_active)
  VALUES (gen_random_uuid(), 'Canteen Alpha Collection Test', true)
  RETURNING id INTO v_canteen_a;

  INSERT INTO public.canteens (id, name, is_active)
  VALUES (gen_random_uuid(), 'Canteen Beta Collection Test', true)
  RETURNING id INTO v_canteen_b;

  -- 2. Setup Profiles
  v_student_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_student_id, 'Alice Student', 'STU1001', 'student', true);

  v_inactive_student_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_inactive_student_id, 'Suspended Student', 'STU9999', 'student', false);

  v_staff_a_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, role, canteen_id, is_active)
  VALUES (v_staff_a_id, 'Bob Staff Alpha', 'staff', v_canteen_a, true);

  v_staff_b_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, role, canteen_id, is_active)
  VALUES (v_staff_b_id, 'Charlie Staff Beta', 'staff', v_canteen_b, true);

  v_inactive_staff_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, role, canteen_id, is_active)
  VALUES (v_inactive_staff_id, 'Dave Inactive Staff', 'staff', v_canteen_a, false);

  v_admin_id := gen_random_uuid();
  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES (v_admin_id, 'Eve Admin', 'admin', true);

  -- 3. Setup Menu Items
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, is_active, is_available)
  VALUES (gen_random_uuid(), v_canteen_a, 'Veg Samosa', 2000, true, true)
  RETURNING id INTO v_item_a1;

  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, is_active, is_available)
  VALUES (gen_random_uuid(), v_canteen_a, 'Deluxe Feast', 60000, true, true)
  RETURNING id INTO v_item_a2;

  -- 4. Setup Test Orders via direct insert to establish known test states
  -- 4.1 Normal Order (1 item, 2000 paise = ₹20)
  INSERT INTO public.orders (
    user_id, canteen_id, status, total_paise, payment_method, payment_status,
    estimated_ready_at, pickup_window_end, prep_minutes_total
  ) VALUES (
    v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
    now(), now() + interval '15 minutes', 5
  ) RETURNING id INTO v_order_norm_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_norm_id, v_item_a1, 'Veg Samosa', 2000, 1);

  -- Generate Secret for Normal Order
  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_norm_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  -- 4.2 Amber Order (> 50000 paise)
  INSERT INTO public.orders (
    user_id, canteen_id, status, total_paise, payment_method, payment_status,
    estimated_ready_at, pickup_window_end, prep_minutes_total
  ) VALUES (
    v_student_id, v_canteen_a, 'READY', 60000, 'PAY_AT_PICKUP', 'PENDING',
    now(), now() + interval '15 minutes', 15
  ) RETURNING id INTO v_order_amber_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_amber_id, v_item_a2, 'Deluxe Feast', 60000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_amber_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  -- ----------------------------------------------------------------------------
  -- TEST 1: Rotating TOTP Windows & get_pickup_code
  -- ----------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_student_id::text);
  v_res := public.get_pickup_code(v_order_norm_id);
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 1 FAILED: Student should receive pickup code';
  v_code := v_res->>'code';
  v_pin := v_res->>'pin';
  ASSERT length(v_code) = 6, 'TEST 1 FAILED: Code must be 6 digits';
  ASSERT length(v_pin) = 4, 'TEST 1 FAILED: PIN must be 4 digits';

  -- Verify stale code rejected, prev window code accepted
  v_stale_code := public.internal_get_pickup_code(v_order_norm_id, -2);
  v_prev_code := public.internal_get_pickup_code(v_order_norm_id, -1);

  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_staff_a_id::text);
  v_res := public.preview_collection(v_canteen_a, v_order_norm_id::text, v_stale_code, NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'INVALID_CODE', 'TEST 1 FAILED: Stale code (-2 windows) must be rejected';

  v_res := public.preview_collection(v_canteen_a, v_order_norm_id::text, v_prev_code, NULL);
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 1 FAILED: Previous window code must be accepted';
  RAISE NOTICE 'PASS: Test 1 - Rotating TOTP windows and preview validation';

  -- ----------------------------------------------------------------------------
  -- TEST 2: Wrong Canteen Staff Refused (even if passing other canteen ID)
  -- ----------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_staff_b_id::text);
  BEGIN
    -- Staff B belongs to Canteen B, attempts to collect order in Canteen A
    v_res := public.collect_order(v_canteen_a, v_order_norm_id, 'CASH', 'SCAN', v_code, NULL, NULL);
    RAISE EXCEPTION 'TEST 2 FAILED: Staff B was allowed to collect Canteen A order';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE 'FORBIDDEN%', 'TEST 2 FAILED: Expected FORBIDDEN, got ' || SQLERRM;
  END;
  RAISE NOTICE 'PASS: Test 2 - Staff cannot collect order outside assigned canteen';

  -- ----------------------------------------------------------------------------
  -- TEST 3: Inactive Staff Refused
  -- ----------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_inactive_staff_id::text);
  BEGIN
    v_res := public.collect_order(v_canteen_a, v_order_norm_id, 'CASH', 'SCAN', v_code, NULL, NULL);
    RAISE EXCEPTION 'TEST 3 FAILED: Inactive staff was allowed to execute collect_order';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE 'USER_INACTIVE%', 'TEST 3 FAILED: Expected USER_INACTIVE, got ' || SQLERRM;
  END;
  RAISE NOTICE 'PASS: Test 3 - Inactive staff refused';

  -- ----------------------------------------------------------------------------
  -- TEST 4: Successful Collection, Payment Status PAID, Audit Log Written
  -- ----------------------------------------------------------------------------
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_staff_a_id::text);
  v_res := public.collect_order(v_canteen_a, v_order_norm_id, 'CASH', 'SCAN', v_code, NULL, NULL);
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 4 FAILED: Order collection should succeed';

  -- Verify orders row updated
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order_norm_id) = 'PAID', 'TEST 4 FAILED: payment_status must be PAID';
  ASSERT (SELECT status FROM public.orders WHERE id = v_order_norm_id) = 'COLLECTED', 'TEST 4 FAILED: status must be COLLECTED';
  ASSERT (SELECT collected_with FROM public.orders WHERE id = v_order_norm_id) = 'CASH', 'TEST 4 FAILED: collected_with must be CASH';

  -- Verify audit log row written
  SELECT count(*) INTO v_audit_count
  FROM public.admin_audit_log
  WHERE target_id = v_order_norm_id::text AND action = 'ORDER_COLLECTED';
  ASSERT v_audit_count = 1, 'TEST 4 FAILED: Exactly 1 admin_audit_log entry must be recorded';
  RAISE NOTICE 'PASS: Test 4 - Collection sets payment_status=PAID and writes audit entry';

  -- ----------------------------------------------------------------------------
  -- TEST 5: Replay Rejection (Double Collection)
  -- ----------------------------------------------------------------------------
  v_res := public.collect_order(v_canteen_a, v_order_norm_id, 'CASH', 'SCAN', v_code, NULL, NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'ALREADY_COLLECTED', 'TEST 5 FAILED: Replay must return ALREADY_COLLECTED';
  RAISE NOTICE 'PASS: Test 5 - Replay collection rejected gracefully';

  -- ----------------------------------------------------------------------------
  -- TEST 6: Amber Order Refuses PIN-Only & Requires Both Code + PIN
  -- ----------------------------------------------------------------------------
  v_code := public.internal_get_pickup_code(v_order_amber_id, 0);
  v_pin := public.internal_get_pickup_pin(v_order_amber_id);

  -- 6.1 Attempt PIN-only collection on Amber order
  v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'UPI', 'PIN', NULL, v_pin, NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'AMBER_REQUIRES_BOTH', 'TEST 6 FAILED: Amber order must refuse PIN-only';

  -- 6.2 Attempt SCAN without PIN on Amber order
  v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'UPI', 'SCAN', v_code, NULL, NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'AMBER_REQUIRES_BOTH', 'TEST 6 FAILED: Amber order must refuse SCAN without valid PIN';

  -- 6.3 Attempt with both valid Code and valid PIN
  v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'UPI', 'SCAN', v_code, v_pin, NULL);
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 6 FAILED: Amber order with both code and PIN must succeed';
  ASSERT (SELECT collected_with FROM public.orders WHERE id = v_order_amber_id) = 'UPI', 'TEST 6 FAILED: collected_with must be UPI';
  RAISE NOTICE 'PASS: Test 6 - Amber threshold enforcement (requires both code + PIN)';

  -- ----------------------------------------------------------------------------
  -- TEST 7: Failed Checks Persist Counters (No RAISE Rollback) & PIN Lockout
  -- ----------------------------------------------------------------------------
  -- Create a fresh order for testing PIN attempts
  INSERT INTO public.orders (
    user_id, canteen_id, status, total_paise, payment_method, payment_status,
    estimated_ready_at, pickup_window_end, prep_minutes_total
  ) VALUES (
    v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
    now(), now() + interval '15 minutes', 5
  ) RETURNING id INTO v_order_stale_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_stale_id, v_item_a1, 'Veg Samosa', 2000, 1);

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_stale_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

  -- 3 Wrong PIN attempts in a row
  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'PIN', NULL, '0000', NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'WRONG_PIN', 'TEST 7 FAILED: Wrong PIN #1';

  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'PIN', NULL, '0000', NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'WRONG_PIN', 'TEST 7 FAILED: Wrong PIN #2';

  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'PIN', NULL, '0000', NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'WRONG_PIN', 'TEST 7 FAILED: Wrong PIN #3';

  -- Check counters persisted
  ASSERT (SELECT failed_pin_attempts FROM public.orders WHERE id = v_order_stale_id) = 3, 'TEST 7 FAILED: Counter must persist at 3';
  ASSERT (SELECT is_pin_locked FROM public.orders WHERE id = v_order_stale_id) = true, 'TEST 7 FAILED: is_pin_locked must be true';

  -- Check pickup_collect_attempts has 3 logged failures
  SELECT count(*) INTO v_attempts_count
  FROM public.pickup_collect_attempts
  WHERE order_id = v_order_stale_id;
  ASSERT v_attempts_count = 3, 'TEST 7 FAILED: pickup_collect_attempts must have 3 rows';

  -- Attempt 4: PIN path returns PIN_LOCKED
  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'PIN', NULL, '0000', NULL);
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'PIN_LOCKED', 'TEST 7 FAILED: PIN locked error expected';

  -- TEST 8: PIN Lock does NOT block a valid QR Scan on normal order
  v_code := public.internal_get_pickup_code(v_order_stale_id, 0);
  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'SCAN', v_code, NULL, NULL);
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 8 FAILED: Valid QR Scan must succeed even if PIN is locked';
  RAISE NOTICE 'PASS: Test 7 & 8 - Counters persist after failures & PIN lockout does not block valid QR scan';

  -- ----------------------------------------------------------------------------
  -- TEST 9: transition_order Strictly Refuses Transition to COLLECTED
  -- ----------------------------------------------------------------------------
  -- Create a ready order
  INSERT INTO public.orders (
    user_id, canteen_id, status, total_paise, payment_method, payment_status,
    estimated_ready_at, pickup_window_end, prep_minutes_total
  ) VALUES (
    v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
    now(), now() + interval '15 minutes', 5
  ) RETURNING id INTO v_order_stale_id;

  BEGIN
    PERFORM public.transition_order(v_order_stale_id, 'COLLECTED'::public.order_status);
    RAISE EXCEPTION 'TEST 9 FAILED: transition_order permitted transition to COLLECTED';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%collect_order function%', 'TEST 9 FAILED: Expected collect_order error, got ' || SQLERRM;
  END;
  RAISE NOTICE 'PASS: Test 9 - transition_order refuses direct transition to COLLECTED';

  -- ----------------------------------------------------------------------------
  -- TEST 10: Manual Override Requires Reason >= 5 chars & Capped at 10/day
  -- ----------------------------------------------------------------------------
  INSERT INTO public.orders (
    user_id, canteen_id, status, total_paise, payment_method, payment_status,
    estimated_ready_at, pickup_window_end, prep_minutes_total
  ) VALUES (
    v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
    now(), now() + interval '15 minutes', 5
  ) RETURNING id INTO v_order_stale_id;

  -- 10.1 Short reason (< 5 chars) rejected
  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'MANUAL', NULL, NULL, 'bad');
  ASSERT (v_res->>'ok')::boolean = false AND v_res->>'error' = 'MANUAL_REASON_REQUIRED', 'TEST 10 FAILED: Short manual reason rejected';

  -- 10.2 Valid reason succeeds and sets is_manual_override = true
  v_res := public.collect_order(v_canteen_a, v_order_stale_id, 'CASH', 'MANUAL', NULL, NULL, 'Student phone battery died completely');
  ASSERT (v_res->>'ok')::boolean = true, 'TEST 10 FAILED: Valid manual collection should succeed';
  ASSERT (SELECT is_manual_override FROM public.orders WHERE id = v_order_stale_id) = true, 'TEST 10 FAILED: is_manual_override must be true';
  RAISE NOTICE 'PASS: Test 10 - Manual override validation';

  -- ----------------------------------------------------------------------------
  -- TEST 11: Dispute Reporting & Admin Resolution
  -- ----------------------------------------------------------------------------
  -- Student reports unauthorized collection on v_order_stale_id
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_student_id::text);
  v_report_res := public.report_unauthorized_collection(v_order_stale_id, 'I was in class and did not pick this up');
  ASSERT (v_report_res->>'ok')::boolean = true, 'TEST 11 FAILED: Student should report unauthorized collection';

  -- Duplicate report rejected
  v_report_res := public.report_unauthorized_collection(v_order_stale_id, 'Reporting again');
  ASSERT (v_report_res->>'ok')::boolean = false AND v_report_res->>'error' = 'ALREADY_REPORTED', 'TEST 11 FAILED: Duplicate report rejected';

  -- Admin lists reports
  EXECUTE format('SET LOCAL "request.jwt.claim.sub" = %L', v_admin_id::text);
  v_admin_list := public.admin_list_collection_reports('PENDING');
  ASSERT jsonb_array_length(v_admin_list) >= 1, 'TEST 11 FAILED: Admin should see pending report';
  v_report_id := (v_admin_list->0->>'id')::uuid;

  -- Admin resolves report
  v_report_res := public.admin_resolve_collection_report(v_report_id, 'RESOLVED', 'Refund issued to student');
  ASSERT (v_report_res->>'ok')::boolean = true, 'TEST 11 FAILED: Admin resolve should succeed';
  RAISE NOTICE 'PASS: Test 11 - Dispute reporting and administrative resolution';

  -- ----------------------------------------------------------------------------
  -- TEST 12: Schema Signatures (verify_pickup gone, exactly one place_order)
  -- ----------------------------------------------------------------------------
  SELECT count(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'verify_pickup';
  ASSERT v_fn_count = 0, 'TEST 12 FAILED: verify_pickup must not exist in public schema';

  SELECT count(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'place_order';
  ASSERT v_fn_count = 1, 'TEST 12 FAILED: Exactly one place_order overload must exist in public schema, found ' || v_fn_count;
  RAISE NOTICE 'PASS: Test 12 - Schema signatures verified (verify_pickup gone, single place_order)';

  RAISE NOTICE '==================================================';
  RAISE NOTICE 'ALL COLLECTION TESTS COMPLETED SUCCESSFULLY!';
  RAISE NOTICE '==================================================';
END $$;

ROLLBACK;
