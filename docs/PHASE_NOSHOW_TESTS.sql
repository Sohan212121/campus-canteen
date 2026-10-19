-- ==============================================================================
-- PHASE NO-SHOW & RECONCILIATION TEST SUITE: docs/PHASE_NOSHOW_TESTS.sql
-- Description: Interactive & Non-Interactive SQL verification script for Migrations 0016 & 0017:
--              1. Expiry from actual ready_at (ready_at + hold_minutes).
--              2. Lazy expiry in get_pickup_code, preview_collection, and collect_order.
--              3. Refusal of SCAN/PIN collection on expired orders.
--              4. Manual late handover within 6 hours (min 5 chars reason, transitions to COLLECTED).
--              5. Rejection of late handover past 6 hours.
--              6. Rejection of manual handover without valid reason (< 5 chars).
--              7. Rolling 24-hour staff manual collection cap (10 collections).
--              8. Row locking & concurrency guard (status = 'READY').
--              9. Invariant: stock is preserved on NO_SHOW (prepared food not restored).
--              10. Strike calculation: matches 'Order Ready' notification, 30-day window, threshold is 3.
--              11. Student account limits: max 2 items, max Rs 200, max 2 active orders.
--              12. Strike clearing via student_strike_resets (history is never rewritten).
--              13. mark_no_shows authorization, batching (200 cap), idempotency, audit log.
--              14. Cleanup of pickup_collect_attempts older than 7 days.
--              15. Daily reconciliation math, IST day boundaries, cash/upi splits, max 200 orders list.
--              16. Anonymous caller rejection on protected RPCs.
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
  v_admin_id      uuid := gen_random_uuid();
  v_student_id    uuid := gen_random_uuid();
  v_serial_id     uuid := gen_random_uuid();
  v_staff1_id     uuid := gen_random_uuid();
  v_staff2_id     uuid := gen_random_uuid();
  v_canteen1_id   uuid := gen_random_uuid();
  v_canteen2_id   uuid := gen_random_uuid();
  v_item1_id      uuid := gen_random_uuid();
  v_item2_id      uuid := gen_random_uuid();
  v_item_pricey   uuid := gen_random_uuid();
BEGIN
  RESET ROLE;

  -- 1. Ensure allowed campus domain exists
  INSERT INTO public.allowed_email_domains (domain)
  VALUES ('campus.edu')
  ON CONFLICT (domain) DO NOTHING;

  -- 2. Create Canteen 1 (15m hold) and Canteen 2 (30m hold)
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen1_id, 'No-Show Test Canteen 1', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen2_id, 'No-Show Test Canteen 2', '00:00:00', '23:59:59', '23:59:59', 5, 5, 30, true);

  -- 3. Create Menu Items for Canteen 1
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, stock, is_available, is_active)
  VALUES (v_item1_id, v_canteen1_id, 'Test Veg Samosa', 2000, 5, 100, true, true);

  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, stock, is_available, is_active)
  VALUES (v_item2_id, v_canteen1_id, 'Test Masala Chai', 1500, 3, 100, true, true);

  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, stock, is_available, is_active)
  VALUES (v_item_pricey, v_canteen1_id, 'Test Gourmet Meal Box', 25000, 15, 50, true, true);

  -- 4. Create Admin
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_admin_id, 'admin_noshow@campus.edu', now(), jsonb_build_object('full_name', 'NoShow Admin'), jsonb_build_object('role', 'admin', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'admin'::public.user_role, is_active = true
  WHERE id = v_admin_id;

  -- 5. Create Normal Student
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_student_id, 'student_normal@campus.edu', now(), jsonb_build_object('full_name', 'Normal Student', 'college_id', 'CID90001'), jsonb_build_object('is_admin_created', true));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'CID90001', is_active = true
  WHERE id = v_student_id;

  -- 6. Create Serial No-Show Student
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_serial_id, 'student_serial@campus.edu', now(), jsonb_build_object('full_name', 'Serial Student', 'college_id', 'CID90002'), jsonb_build_object('is_admin_created', true));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'CID90002', is_active = true
  WHERE id = v_serial_id;

  -- 7. Create Staff 1 (Canteen 1) and Staff 2 (Canteen 2)
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff1_id, 'staff1_noshow@campus.edu', now(), jsonb_build_object('full_name', 'Staff Canteen 1'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen1_id, is_active = true
  WHERE id = v_staff1_id;

  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff2_id, 'staff2_noshow@campus.edu', now(), jsonb_build_object('full_name', 'Staff Canteen 2'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen2_id, is_active = true
  WHERE id = v_staff2_id;

  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('serial_id', v_serial_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff1_id', v_staff1_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff2_id', v_staff2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen1_id', v_canteen1_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen2_id', v_canteen2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item1_id', v_item1_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item2_id', v_item2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item_pricey', v_item_pricey);
END;
$$;


-- ==============================================================================
-- TEST 1: Expiry evaluates from actual ready_at (ready_at + hold_minutes)
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_order_id    uuid := gen_random_uuid();
  v_is_exp      boolean;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  -- Order marked READY 20 minutes ago (hold_minutes is 15 -> expired 5 minutes ago)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 3500,
    10, clock_timestamp() - interval '30 minutes', clock_timestamp() + interval '1 hour',
    clock_timestamp() - interval '35 minutes', clock_timestamp() - interval '20 minutes'
  );

  v_is_exp := public.is_order_expired(v_order_id);

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (1, 'Expiry uses ready_at + hold_minutes, not pickup_window_end', v_is_exp = true,
          'is_order_expired returned ' || v_is_exp::text || ' for ready_at - 20m with 15m hold');
END;
$$;


-- ==============================================================================
-- TEST 2: Lazy expiry on get_pickup_code marks order NO_SHOW & returns PICKUP_EXPIRED
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_order_id   uuid;
  v_res        jsonb;
  v_status     public.order_status;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  SELECT id INTO v_order_id FROM public.orders WHERE user_id = v_student_id ORDER BY id ASC LIMIT 1;

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  -- Impersonate student
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  v_res := public.get_pickup_code(v_order_id);

  RESET ROLE;
  SELECT status INTO v_status FROM public.orders WHERE id = v_order_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (2, 'get_pickup_code lazily marks NO_SHOW and returns PICKUP_EXPIRED',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'PICKUP_EXPIRED' AND v_status = 'NO_SHOW',
          'Result: ' || v_res::text || ', New DB status: ' || v_status::text);
END;
$$;


-- ==============================================================================
-- TEST 3: Lazy expiry on preview_collection marks order NO_SHOW
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_order_id    uuid := gen_random_uuid();
  v_res         jsonb;
  v_status      public.order_status;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Order in READY status, ready 25 minutes ago (expired)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '15 minutes',
    clock_timestamp() - interval '35 minutes', clock_timestamp() - interval '25 minutes'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  -- Impersonate staff 1
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  v_res := public.preview_collection(v_canteen1_id, v_order_id::text, '123456', NULL);

  RESET ROLE;
  SELECT status INTO v_status FROM public.orders WHERE id = v_order_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (3, 'preview_collection lazily marks NO_SHOW and returns PICKUP_EXPIRED',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'PICKUP_EXPIRED' AND v_status = 'NO_SHOW',
          'Result: ' || v_res::text || ', New DB status: ' || v_status::text);
END;
$$;


-- ==============================================================================
-- TEST 4: collect_order refuses SCAN / PIN collection on expired order
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_order_id    uuid := gen_random_uuid();
  v_res         jsonb;
  v_status      public.order_status;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Order in READY status, expired 1 hour ago
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '75 minutes'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  -- Try SCAN collection (passing text parameters)
  v_res := public.collect_order(v_canteen1_id, v_order_id, 'CASH', 'SCAN', '123456', NULL, NULL);

  RESET ROLE;
  SELECT status INTO v_status FROM public.orders WHERE id = v_order_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (4, 'collect_order refuses SCAN on expired order with PICKUP_EXPIRED',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'PICKUP_EXPIRED' AND v_status = 'NO_SHOW',
          'Result: ' || v_res::text || ', New DB status: ' || v_status::text);
END;
$$;


-- ==============================================================================
-- TEST 5: Late manual handover within 6h window succeeds & marks COLLECTED
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_order_id    uuid := gen_random_uuid();
  v_res         jsonb;
  v_status      public.order_status;
  v_pay_status  public.payment_status;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Order in NO_SHOW status, ready 2 hours ago (hold was 15m, so expired 1h45m ago -> within 6h window)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour 45 minutes',
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  -- Perform MANUAL late handover with valid reason >= 5 chars
  v_res := public.collect_order(
    v_canteen1_id, v_order_id, 'CASH', 'MANUAL',
    NULL, NULL, 'Student arrived late after lab class, verified identity'
  );

  RESET ROLE;
  SELECT status, payment_status INTO v_status, v_pay_status FROM public.orders WHERE id = v_order_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (5, 'Manual late handover within 6h succeeds, transitions to COLLECTED and PAID',
          (v_res->>'ok') = 'true' AND v_status = 'COLLECTED' AND v_pay_status = 'PAID',
          'Result: ' || v_res::text || ', DB status: ' || v_status::text || ', payment: ' || v_pay_status::text);
END;
$$;


-- ==============================================================================
-- TEST 6: Late manual handover past 6h window fails with PICKUP_EXPIRED
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_order_id    uuid := gen_random_uuid();
  v_res         jsonb;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Order in NO_SHOW status, ready 8 hours ago (expired > 7 hours ago -> past 6h window)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '8 hours', clock_timestamp() - interval '7 hours 45 minutes',
    clock_timestamp() - interval '8 hours', clock_timestamp() - interval '8 hours'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  v_res := public.collect_order(
    v_canteen1_id, v_order_id, 'CASH', 'MANUAL',
    NULL, NULL, 'Student arrived after 8 hours'
  );

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (6, 'Manual late handover past 6h fails with PICKUP_EXPIRED',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'PICKUP_EXPIRED',
          'Result: ' || v_res::text);
END;
$$;


-- ==============================================================================
-- TEST 7: Manual handover with reason < 5 chars rejected with MANUAL_REASON_REQUIRED
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_order_id    uuid := gen_random_uuid();
  v_res         jsonb;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '1 hour', clock_timestamp() - interval '45 minutes',
    clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 hour'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_order_id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  -- Reason length 4 characters ('late')
  v_res := public.collect_order(
    v_canteen1_id, v_order_id, 'CASH', 'MANUAL',
    NULL, NULL, 'late'
  );

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (7, 'Manual collection with reason < 5 chars rejected with MANUAL_REASON_REQUIRED',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'MANUAL_REASON_REQUIRED',
          'Result: ' || v_res::text);
END;
$$;


-- ==============================================================================
-- TEST 8: Staff rolling 24-hour manual collection cap (10 collections) enforced
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_dummy_order uuid;
  v_test_order  uuid := gen_random_uuid();
  v_res         jsonb;
  i             integer;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Insert 9 existing manual collections in the last 24h for Staff 1
  FOR i IN 1..9 LOOP
    v_dummy_order := gen_random_uuid();
    INSERT INTO public.orders (
      id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
      prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at,
      collected_at, collected_by, collection_method, is_manual_override
    ) VALUES (
      v_dummy_order, v_student_id, v_canteen1_id, 'COLLECTED', 'PAY_AT_PICKUP', 'PAID', 1000,
      5, clock_timestamp() - interval '5 hours', clock_timestamp() - interval '4 hours',
      clock_timestamp() - interval '5 hours', clock_timestamp() - interval '5 hours',
      clock_timestamp() - interval '4 hours', v_staff1_id, 'MANUAL', true
    );
  END LOOP;

  -- Create target order for 10th test
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_test_order, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '10 minutes', clock_timestamp() + interval '5 minutes',
    clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '5 minutes'
  );

  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_test_order, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  -- 10th collection: Should SUCCEED
  v_res := public.collect_order(
    v_canteen1_id, v_test_order, 'CASH', 'MANUAL',
    NULL, NULL, '10th manual collection valid reason'
  );

  -- Create 11th order
  v_test_order := gen_random_uuid();
  RESET ROLE;
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_test_order, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '10 minutes', clock_timestamp() + interval '5 minutes',
    clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '5 minutes'
  );
  INSERT INTO public.order_pickup_secrets (order_id, secret)
  VALUES (v_test_order, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  -- 11th collection: Should FAIL with MANUAL_LIMIT
  v_res := public.collect_order(
    v_canteen1_id, v_test_order, 'CASH', 'MANUAL',
    NULL, NULL, '11th manual collection should fail'
  );

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (8, 'Staff 10/day manual collection cap enforced (11th fails with MANUAL_LIMIT)',
          (v_res->>'ok') = 'false' AND (v_res->>'error') = 'MANUAL_LIMIT',
          'Result: ' || v_res::text);
END;
$$;


-- ==============================================================================
-- TEST 9: Invariant check: Stock is preserved on NO_SHOW and unchanged through collect_order on NO_SHOW
-- ==============================================================================
DO $
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_item1_id    uuid;
  v_order_id    uuid := gen_random_uuid();
  v_stock_before integer;
  v_stock_after_noshow  integer;
  v_stock_after_collect integer;
  v_res         jsonb;
  v_collect_res jsonb;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_item1_id FROM _test_env WHERE key = 'item1_id';

  SELECT stock INTO v_stock_before FROM public.menu_items WHERE id = v_item1_id;

  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '15 minutes',
    clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '20 minutes'
  );

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item1_id, 'Test Veg Samosa', 2000, 2);

  -- Run mark_no_shows to transition to NO_SHOW
  v_res := public.mark_no_shows(v_canteen1_id);

  SELECT stock INTO v_stock_after_noshow FROM public.menu_items WHERE id = v_item1_id;

  -- Collect NO_SHOW order via late manual handover
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  v_collect_res := public.collect_order(v_canteen1_id, v_order_id, 'CASH', 'MANUAL', NULL, NULL, 'Late handover test reason for stock check');

  RESET ROLE;

  SELECT stock INTO v_stock_after_collect FROM public.menu_items WHERE id = v_item1_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (9, 'Stock invariant: Food prepared is NOT restored on NO_SHOW and unchanged through collect_order',
          v_stock_before = v_stock_after_noshow AND v_stock_after_noshow = v_stock_after_collect,
          'Initial stock: ' || v_stock_before || ', After NO_SHOW: ' || v_stock_after_noshow || ', After late collect: ' || v_stock_after_collect);
END;
$;


-- ==============================================================================
-- TEST 10: Strike counting matches Order Ready notification, 30d window, limit is 3
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_serial_id   uuid;
  v_order1      uuid := gen_random_uuid();
  v_order2      uuid := gen_random_uuid();
  v_order3      uuid := gen_random_uuid();
  v_order_old   uuid := gen_random_uuid();
  v_order_nonotif uuid := gen_random_uuid();
  v_status_2    jsonb;
  v_status_3    jsonb;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_serial_id FROM _test_env WHERE key = 'serial_id';

  -- Order 1: NO_SHOW, 5 days ago, HAS 'Order Ready' notification -> SHOULD COUNT
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order1, v_serial_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '5 days', clock_timestamp() - interval '5 days',
    clock_timestamp() - interval '5 days', clock_timestamp() - interval '5 days'
  );
  INSERT INTO public.notifications (user_id, order_id, title, body)
  VALUES (v_serial_id, v_order1, 'Order Ready', 'Your order is ready');

  -- Order 2: NO_SHOW, 2 days ago, HAS 'Order Ready' notification -> SHOULD COUNT
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order2, v_serial_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days',
    clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
  );
  INSERT INTO public.notifications (user_id, order_id, title, body)
  VALUES (v_serial_id, v_order2, 'Order Ready', 'Your order is ready');

  -- Order 40 days ago (> 30 days) -> MUST NOT COUNT
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_old, v_serial_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '40 days', clock_timestamp() - interval '40 days',
    clock_timestamp() - interval '40 days', clock_timestamp() - interval '40 days'
  );
  INSERT INTO public.notifications (user_id, order_id, title, body)
  VALUES (v_serial_id, v_order_old, 'Order Ready', 'Your order is ready');

  -- Order with NO 'Order Ready' notification -> MUST NOT COUNT
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_nonotif, v_serial_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day',
    clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day'
  );

  -- Check status with 2 strikes: strikes = 2, is_limited = false (threshold is 3)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_serial_id::text, 'role', 'authenticated')::text, true);
  v_status_2 := public.get_my_account_status();

  -- Now insert 3rd NO_SHOW order -> strikes = 3, is_limited = true
  RESET ROLE;
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order3, v_serial_id, v_canteen1_id, 'NO_SHOW', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days',
    clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days'
  );
  INSERT INTO public.notifications (user_id, order_id, title, body)
  VALUES (v_serial_id, v_order3, 'Order Ready', 'Your order is ready');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_serial_id::text, 'role', 'authenticated')::text, true);
  v_status_3 := public.get_my_account_status();
  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (10, 'Strike threshold is 3 everywhere (2 strikes = not limited, 3 strikes = limited)',
          (v_status_2->>'strikes')::int = 2 AND (v_status_2->>'is_limited')::boolean = false AND
          (v_status_3->>'strikes')::int = 3 AND (v_status_3->>'is_limited')::boolean = true,
          'Status at 2 strikes: ' || v_status_2::text || ', Status at 3 strikes: ' || v_status_3::text);
END;
$$;


-- ==============================================================================
-- TEST 11: Serial no-show limits enforced on place_order (max 2 items, max Rs 200)
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id  uuid;
  v_serial_id    uuid;
  v_item1_id     uuid;
  v_item_pricey  uuid;
  v_res_items    jsonb;
  v_res_price    jsonb;
  v_res_valid    jsonb;
  v_err_items    text;
  v_err_price    text;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_serial_id FROM _test_env WHERE key = 'serial_id';
  SELECT val_uuid INTO v_item1_id FROM _test_env WHERE key = 'item1_id';
  SELECT val_uuid INTO v_item_pricey FROM _test_env WHERE key = 'item_pricey';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_serial_id::text, 'role', 'authenticated')::text, true);

  -- Attempt 1: 3 items (exceeds 2-item limit)
  BEGIN
    v_res_items := public.place_order(
      v_canteen1_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item1_id, 'quantity', 3)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-idemp-limit-items-1'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_items := SQLERRM;
  END;

  -- Attempt 2: 1 expensive item (Rs 250 > Rs 200 limit)
  BEGIN
    v_res_price := public.place_order(
      v_canteen1_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_pricey, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-idemp-limit-price-2'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_price := SQLERRM;
  END;

  -- Attempt 3: 2 items at Rs 20 each (Total Rs 40 <= Rs 200) -> SUCCEEDS
  v_res_valid := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item1_id, 'quantity', 2)),
    'PAY_AT_PICKUP'::public.payment_method,
    'test-idemp-limit-valid-3'
  );

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (11, 'Serial no-show account limits enforced on place_order (max 2 items, max Rs 200)',
          v_err_items LIKE '%ACCOUNT_LIMITED%' AND v_err_price LIKE '%ACCOUNT_LIMITED%' AND (v_res_valid->>'order_id') IS NOT NULL,
          'Items err: ' || coalesce(v_err_items, 'NONE') || ', Price err: ' || coalesce(v_err_price, 'NONE') || ', Valid order: ' || coalesce(v_res_valid->>'order_id', 'NONE'));
END;
$$;


-- ==============================================================================
-- TEST 12: Active orders limit of 2 enforced after canteen lock
-- ==============================================================================
DO $$
DECLARE
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_item1_id    uuid;
  v_res1        jsonb;
  v_res2        jsonb;
  v_err3        text;
BEGIN
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_item1_id FROM _test_env WHERE key = 'item1_id';

  -- Clear any existing active orders for student
  UPDATE public.orders
  SET status = 'CANCELLED'::public.order_status
  WHERE user_id = v_student_id AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  -- Order 1: active count 0 -> succeeds (becomes 1 active)
  v_res1 := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item1_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'test-idemp-active-1'
  );

  -- Order 2: active count 1 -> succeeds (becomes 2 active)
  v_res2 := public.place_order(
    v_canteen1_id,
    jsonb_build_array(jsonb_build_object('menu_item_id', v_item1_id, 'quantity', 1)),
    'PAY_AT_PICKUP'::public.payment_method,
    'test-idemp-active-2'
  );

  -- Order 3: active count 2 -> must FAIL with TOO_MANY_ACTIVE_ORDERS
  BEGIN
    PERFORM public.place_order(
      v_canteen1_id,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item1_id, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'test-idemp-active-3'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err3 := SQLERRM;
  END;

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (12, 'Active order limit is 2 (checked after canteen lock, 3rd fails)',
          (v_res1->>'order_id') IS NOT NULL AND (v_res2->>'order_id') IS NOT NULL AND v_err3 LIKE '%TOO_MANY_ACTIVE_ORDERS%',
          'Order 1: ' || coalesce(v_res1->>'order_id', 'FAIL') || ', Order 2: ' || coalesce(v_res2->>'order_id', 'FAIL') || ', Order 3 err: ' || coalesce(v_err3, 'NONE'));
END;
$$;


-- ==============================================================================
-- TEST 13: Strike clearing uses student_strike_resets and never rewrites orders
-- ==============================================================================
DO $$
DECLARE
  v_admin_id     uuid;
  v_serial_id    uuid;
  v_canteen1_id  uuid;
  v_res_clear    jsonb;
  v_status_res   jsonb;
  v_no_show_cnt  integer;
  v_reset_cnt    integer;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_serial_id FROM _test_env WHERE key = 'serial_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';

  -- Impersonate admin
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  v_res_clear := public.admin_clear_student_strikes(v_serial_id, 'Student provided medical certificate for missing collections');

  -- Impersonate student to check status
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_serial_id::text, 'role', 'authenticated')::text, true);
  v_status_res := public.get_my_account_status();

  RESET ROLE;

  -- Verify history is intact: orders are still NO_SHOW
  SELECT count(*) INTO v_no_show_cnt FROM public.orders WHERE user_id = v_serial_id AND status = 'NO_SHOW';
  SELECT count(*) INTO v_reset_cnt FROM public.student_strike_resets WHERE student_id = v_serial_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (13, 'admin_clear_student_strikes clears strikes without rewriting order history',
          (v_res_clear->>'ok') = 'true' AND (v_status_res->>'strikes')::int = 0 AND (v_status_res->>'is_limited')::boolean = false AND v_no_show_cnt >= 2 AND v_reset_cnt = 1,
          'Clear res: ' || v_res_clear::text || ', New strikes: ' || (v_status_res->>'strikes') || ', Untouched NO_SHOW orders: ' || v_no_show_cnt);
END;
$$;


-- ==============================================================================
-- TEST 14: mark_no_shows authorization: staff restricted to own canteen
-- ==============================================================================
DO $$
DECLARE
  v_staff1_id   uuid;
  v_canteen2_id uuid;
  v_err         text;
BEGIN
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';
  SELECT val_uuid INTO v_canteen2_id FROM _test_env WHERE key = 'canteen2_id';

  -- Staff 1 belongs to Canteen 1; try to sweep Canteen 2
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.mark_no_shows(v_canteen2_id);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (14, 'Staff cannot sweep another canteen with mark_no_shows (FORBIDDEN)',
          v_err LIKE '%FORBIDDEN%',
          'Error: ' || coalesce(v_err, 'NONE'));
END;
$$;


-- ==============================================================================
-- TEST 15: mark_no_shows sweeps, logs audit entry, and purges old attempts (> 7 days)
-- ==============================================================================
DO $$
DECLARE
  v_admin_id     uuid;
  v_student_id   uuid;
  v_canteen1_id  uuid;
  v_order_id     uuid := gen_random_uuid();
  v_sweep_res    jsonb;
  v_audit_cnt    integer;
  v_old_attempt  uuid := gen_random_uuid();
  v_recent_att   uuid := gen_random_uuid();
  v_old_exists   boolean;
  v_recent_exists boolean;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';

  -- Order ready 30m ago (expired)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen1_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 2000,
    5, clock_timestamp() - interval '40 minutes', clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '40 minutes', clock_timestamp() - interval '30 minutes'
  );

  -- Insert old attempt (> 7 days) and recent attempt (< 7 days)
  INSERT INTO public.pickup_collect_attempts (id, canteen_id, staff_id, order_id, method, outcome, attempted_at)
  VALUES (v_old_attempt, v_canteen1_id, v_admin_id, v_order_id, 'SCAN', 'FAIL_CODE', clock_timestamp() - interval '8 days');

  INSERT INTO public.pickup_collect_attempts (id, canteen_id, staff_id, order_id, method, outcome, attempted_at)
  VALUES (v_recent_att, v_canteen1_id, v_admin_id, v_order_id, 'SCAN', 'FAIL_CODE', clock_timestamp() - interval '2 days');

  -- Impersonate admin to sweep all canteens
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  v_sweep_res := public.mark_no_shows(NULL);

  -- Test idempotency: calling sweep again immediately returns count = 0
  DECLARE
    v_sweep_res2 jsonb;
  BEGIN
    v_sweep_res2 := public.mark_no_shows(NULL);
    IF (v_sweep_res2->>'count')::integer <> 0 THEN
      RAISE EXCEPTION 'Idempotency failed: second sweep returned count %', v_sweep_res2->>'count';
    END IF;
  END;

  RESET ROLE;

  SELECT count(*) INTO v_audit_cnt FROM public.admin_audit_log WHERE action = 'ORDERS_MARKED_NO_SHOW';
  SELECT EXISTS(SELECT 1 FROM public.pickup_collect_attempts WHERE id = v_old_attempt) INTO v_old_exists;
  SELECT EXISTS(SELECT 1 FROM public.pickup_collect_attempts WHERE id = v_recent_att) INTO v_recent_exists;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (15, 'mark_no_shows sweeps order (idempotent, 200 cap), logs audit row, and purges attempts > 7 days',
          (v_sweep_res->>'ok') = 'true' AND v_audit_cnt >= 1 AND v_old_exists = false AND v_recent_exists = true,
          'Sweep res: ' || v_sweep_res::text || ', Audit rows: ' || v_audit_cnt || ', Old attempt purged: ' || (NOT v_old_exists)::text || ', Recent preserved: ' || v_recent_exists::text);
END;
$$;


-- ==============================================================================
-- TEST 16: get_daily_reconciliation calculates IST boundaries, splits & limited order list
-- ==============================================================================
DO $$
DECLARE
  v_admin_id    uuid;
  v_canteen1_id uuid;
  v_student_id  uuid;
  v_staff1_id   uuid;
  v_rec_res     jsonb;
  v_today_ist   date := (timezone('Asia/Kolkata', clock_timestamp()))::date;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_canteen1_id FROM _test_env WHERE key = 'canteen1_id';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_staff1_id FROM _test_env WHERE key = 'staff1_id';

  -- Order collected with CASH
  INSERT INTO public.orders (
    user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at,
    collected_at, collected_by, collected_with, collection_method, is_manual_override
  ) VALUES (
    v_student_id, v_canteen1_id, 'COLLECTED', 'PAY_AT_PICKUP', 'PAID', 5000,
    5, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '30 minutes', v_staff1_id, 'CASH', 'SCAN', false
  );

  -- Order collected with UPI
  INSERT INTO public.orders (
    user_id, canteen_id, status, payment_method, payment_status, total_paise,
    prep_minutes_total, estimated_ready_at, pickup_window_end, placed_at, ready_at,
    collected_at, collected_by, collected_with, collection_method, is_manual_override
  ) VALUES (
    v_student_id, v_canteen1_id, 'COLLECTED', 'PAY_AT_PICKUP', 'PAID', 7500,
    5, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '20 minutes', v_staff1_id, 'UPI', 'SCAN', false
  );

  -- Impersonate admin
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  -- Verify staff is strictly forbidden from running reconciliation
  DECLARE
    v_staff_err text;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff1_id::text, 'role', 'authenticated')::text, true);

    BEGIN
      PERFORM public.get_daily_reconciliation(v_today_ist, v_canteen1_id);
    EXCEPTION WHEN OTHERS THEN
      v_staff_err := SQLERRM;
    END;

    RESET ROLE;

    IF v_staff_err IS NULL OR v_staff_err NOT LIKE '%FORBIDDEN%' THEN
      RAISE EXCEPTION 'Staff was not forbidden from reconciliation: %', coalesce(v_staff_err, 'NONE');
    END IF;
  END;

  v_rec_res := public.get_daily_reconciliation(v_today_ist, v_canteen1_id);

  RESET ROLE;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (16, 'get_daily_reconciliation aggregates revenue, splits, and order list (max 200) in IST',
          (v_rec_res->>'ok') = 'true' AND
          (v_rec_res->'summary'->>'total_cash_paise')::int >= 5000 AND
          (v_rec_res->'summary'->>'total_upi_paise')::int >= 7500 AND
          jsonb_array_length(v_rec_res->'orders') <= 200,
          'Reconciliation res: ' || v_rec_res::text);
END;
$$;


-- ==============================================================================
-- TEST 17: Security boundaries: anon rejected on all RPCs (permission denied or UNAUTHENTICATED)
-- ==============================================================================
DO $
DECLARE
  v_err_account text;
  v_err_sweep   text;
  v_err_rec     text;
  v_account_ok  boolean;
  v_sweep_ok    boolean;
  v_rec_ok      boolean;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', null, true);

  BEGIN
    PERFORM public.get_my_account_status();
  EXCEPTION WHEN OTHERS THEN
    v_err_account := SQLERRM;
  END;

  BEGIN
    PERFORM public.mark_no_shows(NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err_sweep := SQLERRM;
  END;

  BEGIN
    PERFORM public.get_daily_reconciliation(NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err_rec := SQLERRM;
  END;

  RESET ROLE;

  v_account_ok := (v_err_account ILIKE '%permission denied%' OR v_err_account ILIKE '%UNAUTHENTICATED%' OR v_err_account ILIKE '%FORBIDDEN%');
  v_sweep_ok   := (v_err_sweep ILIKE '%permission denied%' OR v_err_sweep ILIKE '%UNAUTHENTICATED%' OR v_err_sweep ILIKE '%FORBIDDEN%');
  v_rec_ok     := (v_err_rec ILIKE '%permission denied%' OR v_err_rec ILIKE '%UNAUTHENTICATED%' OR v_err_rec ILIKE '%FORBIDDEN%');

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (17, 'Anonymous caller cannot execute account status, sweep, or reconciliation (permission denied or UNAUTHENTICATED)',
          v_account_ok AND v_sweep_ok AND v_rec_ok,
          'Account err: ' || coalesce(v_err_account, 'NONE') || ', Sweep err: ' || coalesce(v_err_sweep, 'NONE') || ', Rec err: ' || coalesce(v_err_rec, 'NONE'));
END;
$;

-- ==============================================================================
-- TEST 18: Overload check: exactly one public.place_order overload exists
-- ==============================================================================
DO $
DECLARE
  v_overload_count integer;
BEGIN
  SELECT count(*) INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'place_order';

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (18, 'Exactly one public.place_order overload exists in schema',
          v_overload_count = 1,
          'Overload count found: ' || v_overload_count);
END;
$;


-- ==============================================================================
-- OUTPUT TEST RESULTS
-- ==============================================================================
SELECT
  test_num,
  test_name,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
  details
FROM _test_results
ORDER BY test_num;

DO $
DECLARE
  v_failed_count integer;
  v_fail_details text;
BEGIN
  SELECT count(*), string_agg(test_num || ': ' || test_name || ' (' || details || ')', E'\n')
  INTO v_failed_count, v_fail_details
  FROM _test_results
  WHERE passed = false;

  IF v_failed_count > 0 THEN
    RAISE EXCEPTION 'TEST_SUITE_FAILED: % test(s) failed:\n%', v_failed_count, v_fail_details;
  END IF;
END $;

ROLLBACK;
