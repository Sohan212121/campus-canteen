-- ==============================================================================
-- PHASE PICKUP REMINDERS TEST SUITE: docs/PHASE_REMINDERS_TESTS.sql
-- Description: Interactive & Non-Interactive SQL verification script for Migration 0019:
--              1. Schema columns orders.reminder_5_sent_at and orders.reminder_2_sent_at.
--              2. Performance partial index idx_orders_ready_reminders.
--              3. Function signatures for send_pickup_reminders and send_my_pickup_reminders.
--              4. 5-minute reminder threshold trigger: notifications created & reminder_5_sent_at set.
--              5. 2-minute reminder threshold trigger: notifications created & reminder_2_sent_at set.
--              6. Strict idempotency: second sweep produces 0 notifications.
--              7. Expiry exclusion: expired orders past ready_at + hold_minutes are skipped.
--              8. Student caller isolation: send_my_pickup_reminders only processes auth.uid() orders.
--              9. Staff authorization & canteen bounding.
--              10. Anonymous caller rejection on protected routines.
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
  v_student_id   uuid := gen_random_uuid();
  v_other_id     uuid := gen_random_uuid();
  v_staff_id     uuid := gen_random_uuid();
  v_admin_id     uuid := gen_random_uuid();
  v_canteen_id   uuid := gen_random_uuid();
  v_canteen2_id  uuid := gen_random_uuid();
  v_item_id      uuid := gen_random_uuid();
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Allowed domain
  INSERT INTO public.allowed_email_domains (domain)
  VALUES ('campus.edu')
  ON CONFLICT (domain) DO NOTHING;

  -- Create Canteen (15m hold)
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_id, 'Reminder Test Canteen', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen2_id, 'Other Test Canteen', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  -- Menu Item
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, stock, is_available, is_active)
  VALUES (v_item_id, v_canteen_id, 'Test Coffee', 1500, 5, 100, true, true);

  -- Student 1
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_student_id, 'Reminder Student', '2026-REM-001', 'student'::public.user_role, true);

  -- Student 2 (Other)
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_other_id, 'Other Student', '2026-REM-002', 'student'::public.user_role, true);

  -- Staff
  INSERT INTO public.profiles (id, full_name, college_id, role, canteen_id, is_active)
  VALUES (v_staff_id, 'Reminder Staff', '2026-STA-001', 'staff'::public.user_role, v_canteen_id, true);

  -- Admin
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_admin_id, 'Reminder Admin', '2026-ADM-001', 'admin'::public.user_role, true);

  -- Save in test env
  INSERT INTO _test_env VALUES ('student_id', v_student_id, NULL);
  INSERT INTO _test_env VALUES ('other_id', v_other_id, NULL);
  INSERT INTO _test_env VALUES ('staff_id', v_staff_id, NULL);
  INSERT INTO _test_env VALUES ('admin_id', v_admin_id, NULL);
  INSERT INTO _test_env VALUES ('canteen_id', v_canteen_id, NULL);
  INSERT INTO _test_env VALUES ('canteen2_id', v_canteen2_id, NULL);
  INSERT INTO _test_env VALUES ('item_id', v_item_id, NULL);
END;
$$;

-- ==============================================================================
-- TEST 1: Schema Invariant - Columns and Index Existence
-- ==============================================================================
DO $$
DECLARE
  v_col_5 boolean;
  v_col_2 boolean;
  v_has_idx boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'reminder_5_sent_at'
  ) INTO v_col_5;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'reminder_2_sent_at'
  ) INTO v_col_2;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'orders' AND indexname = 'idx_orders_ready_reminders'
  ) INTO v_has_idx;

  INSERT INTO _test_results VALUES (
    1,
    'Schema Columns & Index Existence',
    (v_col_5 AND v_col_2 AND v_has_idx),
    'reminder_5_sent_at: ' || v_col_5 || ', reminder_2_sent_at: ' || v_col_2 || ', idx: ' || v_has_idx
  );
END;
$$;

-- ==============================================================================
-- TEST 2: 5-Minute Reminder Sweep Trigger
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_staff_id   uuid;
  v_order_id   uuid := gen_random_uuid();
  v_res        jsonb;
  v_notif_cnt  integer;
  v_order_rec  record;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';

  -- Create order with ready_at set such that exactly 4 minutes remain in 15m hold window
  -- Expiry = ready_at + 15 min. Target expiry = now + 4 min => ready_at = now - 11 min.
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total,
    placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 1500,
    'TOK-REM-5M', clock_timestamp() - interval '15 minutes', clock_timestamp() + interval '4 minutes', 5,
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '11 minutes'
  );

  -- Set claims as Staff
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  -- Run staff sweep
  v_res := public.send_pickup_reminders(v_canteen_id);

  -- Check notification created
  SELECT count(*) INTO v_notif_cnt
  FROM public.notifications
  WHERE order_id = v_order_id
    AND title = 'Pickup Reminder: 5 Minutes Left';

  SELECT reminder_5_sent_at, reminder_2_sent_at INTO v_order_rec
  FROM public.orders
  WHERE id = v_order_id;

  INSERT INTO _test_results VALUES (
    2,
    '5-Minute Reminder Sweep Trigger',
    ((v_res->>'sent_count')::int >= 1 AND v_notif_cnt = 1 AND v_order_rec.reminder_5_sent_at IS NOT NULL AND v_order_rec.reminder_2_sent_at IS NULL),
    'sent_count: ' || (v_res->>'sent_count') || ', notif_cnt: ' || v_notif_cnt || ', reminder_5_sent_at: ' || coalesce(v_order_rec.reminder_5_sent_at::text, 'null')
  );
END;
$$;

-- ==============================================================================
-- TEST 3: Strict Idempotency (Repeat Sweep Produces 0 Notifications)
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id uuid;
  v_staff_id   uuid;
  v_res        jsonb;
BEGIN
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  -- Second execution immediately following Test 2
  v_res := public.send_pickup_reminders(v_canteen_id);

  INSERT INTO _test_results VALUES (
    3,
    'Strict Idempotency on Repeated Sweep',
    ((v_res->>'sent_count')::int = 0),
    'sent_count: ' || (v_res->>'sent_count')
  );
END;
$$;

-- ==============================================================================
-- TEST 4: 2-Minute Final Call Sweep Trigger
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_staff_id   uuid;
  v_order_id   uuid := gen_random_uuid();
  v_res        jsonb;
  v_notif_cnt  integer;
  v_order_rec  record;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';

  -- Target expiry = now + 90 seconds (1.5 min) => ready_at = now - 13.5 min in 15m hold
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total,
    placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 1500,
    'TOK-REM-2M', clock_timestamp() - interval '15 minutes', clock_timestamp() + interval '90 seconds', 5,
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '13 minutes 30 seconds'
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  v_res := public.send_pickup_reminders(v_canteen_id);

  SELECT count(*) INTO v_notif_cnt
  FROM public.notifications
  WHERE order_id = v_order_id
    AND title = 'Final Call: 2 Minutes Left';

  SELECT reminder_5_sent_at, reminder_2_sent_at INTO v_order_rec
  FROM public.orders
  WHERE id = v_order_id;

  INSERT INTO _test_results VALUES (
    4,
    '2-Minute Final Call Sweep Trigger',
    ((v_res->>'sent_count')::int >= 1 AND v_notif_cnt = 1 AND v_order_rec.reminder_2_sent_at IS NOT NULL),
    'sent_count: ' || (v_res->>'sent_count') || ', notif_cnt: ' || v_notif_cnt || ', reminder_2_sent_at: ' || coalesce(v_order_rec.reminder_2_sent_at::text, 'null')
  );
END;
$$;

-- ==============================================================================
-- TEST 5: Expiry Guard (Expired Orders Are Skipped)
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_staff_id   uuid;
  v_order_id   uuid := gen_random_uuid();
  v_res        jsonb;
  v_notif_cnt  integer;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';

  -- Expired order: ready_at = now - 20 minutes in 15m hold window
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total,
    placed_at, ready_at
  ) VALUES (
    v_order_id, v_student_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 1500,
    'TOK-REM-EXP', clock_timestamp() - interval '25 minutes', clock_timestamp() - interval '5 minutes', 5,
    clock_timestamp() - interval '30 minutes', clock_timestamp() - interval '20 minutes'
  );

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  v_res := public.send_pickup_reminders(v_canteen_id);

  SELECT count(*) INTO v_notif_cnt
  FROM public.notifications
  WHERE order_id = v_order_id;

  INSERT INTO _test_results VALUES (
    5,
    'Expiry Guard Skips Expired Orders',
    (v_notif_cnt = 0),
    'notif_cnt: ' || v_notif_cnt
  );
END;
$$;

-- ==============================================================================
-- TEST 6: Student Self-Sweep Isolation (send_my_pickup_reminders)
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_other_id   uuid;
  v_canteen_id uuid;
  v_order_own  uuid := gen_random_uuid();
  v_order_oth  uuid := gen_random_uuid();
  v_res        jsonb;
  v_own_cnt    integer;
  v_oth_cnt    integer;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_other_id FROM _test_env WHERE key = 'other_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  -- Own order (eligible for 5m reminder)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total,
    placed_at, ready_at
  ) VALUES (
    v_order_own, v_student_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 1500,
    'TOK-REM-OWN', clock_timestamp() - interval '15 minutes', clock_timestamp() + interval '3 minutes', 5,
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '12 minutes'
  );

  -- Other student order (eligible for 5m reminder)
  INSERT INTO public.orders (
    id, user_id, canteen_id, status, payment_method, payment_status, total_paise,
    pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total,
    placed_at, ready_at
  ) VALUES (
    v_order_oth, v_other_id, v_canteen_id, 'READY', 'PAY_AT_PICKUP', 'PENDING', 1500,
    'TOK-REM-OTH', clock_timestamp() - interval '15 minutes', clock_timestamp() + interval '3 minutes', 5,
    clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '12 minutes'
  );

  -- Set claims as Student 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  -- Run student self-sweep
  v_res := public.send_my_pickup_reminders();

  -- Own order got notification
  SELECT count(*) INTO v_own_cnt
  FROM public.notifications
  WHERE order_id = v_order_own;

  -- Other student order must NOT get notification from this call
  SELECT count(*) INTO v_oth_cnt
  FROM public.notifications
  WHERE order_id = v_order_oth;

  INSERT INTO _test_results VALUES (
    6,
    'Student Self-Sweep Caller Isolation',
    (v_own_cnt = 1 AND v_oth_cnt = 0 AND (v_res->>'sent_count')::int = 1),
    'own_cnt: ' || v_own_cnt || ', oth_cnt: ' || v_oth_cnt || ', sent_count: ' || (v_res->>'sent_count')
  );
END;
$$;

-- ==============================================================================
-- TEST 7: Staff Canteen Bounding Guard
-- ==============================================================================
DO $$
DECLARE
  v_staff_id    uuid;
  v_canteen2_id uuid;
  v_failed      boolean := false;
  v_err_msg     text := '';
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_canteen2_id FROM _test_env WHERE key = 'canteen2_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  -- Attempt to sweep other canteen
  BEGIN
    PERFORM public.send_pickup_reminders(v_canteen2_id);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_err_msg := SQLERRM;
  END;

  INSERT INTO _test_results VALUES (
    7,
    'Staff Canteen Bounding Guard',
    (v_failed AND v_err_msg LIKE '%FORBIDDEN%'),
    'err_msg: ' || v_err_msg
  );
END;
$$;

-- ==============================================================================
-- TEST 8: Anonymous Caller Rejection
-- ==============================================================================
DO $$
DECLARE
  v_failed boolean := false;
  v_err_msg text := '';
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    PERFORM public.send_my_pickup_reminders();
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_err_msg := SQLERRM;
  END;

  INSERT INTO _test_results VALUES (
    8,
    'Anonymous Caller Rejection on send_my_pickup_reminders',
    (v_failed AND v_err_msg LIKE '%UNAUTHENTICATED%'),
    'err_msg: ' || v_err_msg
  );
END;
$$;

-- ==============================================================================
-- OUTPUT RESULTS TABLE
-- ==============================================================================
SELECT
  test_num AS "#",
  test_name AS "Test Case",
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS "Status",
  details AS "Details"
FROM _test_results
ORDER BY test_num ASC;

-- Clean rollback
ROLLBACK;

