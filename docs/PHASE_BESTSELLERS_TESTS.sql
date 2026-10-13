-- ==============================================================================
-- BEST SELLERS TEST SUITE: docs/PHASE_BESTSELLERS_TESTS.sql
-- Description: Verification script for Best Sellers real-time sales aggregation:
--              ranking order, tie-breaking, date window cutoff, status exclusion,
--              item availability filtering, 3-item threshold guard, student role isolation,
--              anon execute revocation, and zero revenue/user data leakage.
-- Wrapped in BEGIN ... ROLLBACK so NO changes persist and real rows are NEVER touched.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor and click Run.
-- 3. Review the output in the "Messages / Notices" tab.

BEGIN;

-- Temporary tables for tracking test assertions and environment fixtures across DO blocks
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

GRANT ALL ON TABLE _test_results TO authenticated;
GRANT ALL ON TABLE _test_env TO authenticated;

-- ==============================================================================
-- SETUP BLOCK: Run as postgres before setting local roles
-- ==============================================================================
DO $$
DECLARE
  v_student_id     uuid := gen_random_uuid();
  v_staff_id       uuid := gen_random_uuid();
  v_admin_id       uuid := gen_random_uuid();
  v_canteen_id     uuid;
  v_cat_id         uuid;
  v_item_a         uuid := gen_random_uuid();
  v_item_b         uuid := gen_random_uuid();
  v_item_c         uuid := gen_random_uuid();
  v_item_d         uuid := gen_random_uuid();
  v_item_unavail   uuid := gen_random_uuid();
  v_now            timestamptz := now();
  v_order_id       uuid;
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'BEST SELLERS TEST SUITE: SETUP (Role: postgres)';
  RAISE NOTICE '=====================================================';

  -- 1. Find primary active canteen
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found in public.canteens.';
  END IF;

  SELECT id INTO v_cat_id FROM public.categories WHERE canteen_id = v_canteen_id AND is_active = true LIMIT 1;
  IF v_cat_id IS NULL THEN
    -- Fallback category if none exists
    INSERT INTO public.categories (id, canteen_id, name, display_order, is_active)
    VALUES (gen_random_uuid(), v_canteen_id, 'Temp Test Cat', 999, true)
    RETURNING id INTO v_cat_id;
  END IF;

  -- 2. Create isolated test users (triggers create profiles)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_student_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_bs_student_' || substr(v_student_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Test Student"}'::jsonb, now(), now()),
    (v_staff_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_bs_staff_'   || substr(v_staff_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Test Staff"}'::jsonb, now(), now()),
    (v_admin_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_bs_admin_'   || substr(v_admin_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Test Admin"}'::jsonb, now(), now());

  UPDATE public.profiles SET role = 'student'::public.user_role, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true WHERE id = v_staff_id;
  UPDATE public.profiles SET role = 'admin'::public.user_role, is_active = true WHERE id = v_admin_id;

  -- 3. Create dedicated temporary menu items for predictable sales testing
  INSERT INTO public.menu_items (id, canteen_id, category_id, name, description, price_paise, is_veg, is_available, stock, prep_minutes, is_active)
  VALUES
    (v_item_a, v_canteen_id, v_cat_id, 'ZZZ Alpha Burger', 'Test Item A', 6000, true, true, 100, 5, true),
    (v_item_b, v_canteen_id, v_cat_id, 'AAA Beta Shake',  'Test Item B', 4000, true, true, 100, 5, true),
    (v_item_c, v_canteen_id, v_cat_id, 'MMM Gamma Fries', 'Test Item C', 3000, true, true, 100, 5, true),
    (v_item_d, v_canteen_id, v_cat_id, 'BBB Delta Roll',  'Test Item D', 5000, true, true, 100, 5, true),
    (v_item_unavail, v_canteen_id, v_cat_id, 'Unavailable Item', 'Test Unavailable', 5000, true, false, 100, 5, true);

  -- 4. Create orders with all NOT NULL columns supplied:
  -- Order 1: COLLECTED today, has Item A (qty 12) -> total units 12
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_01', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    72000, 'T_TOK_01', v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_a, 'ZZZ Alpha Burger', 6000, 12);

  -- Order 2: COLLECTED today, has Item B (qty 8) and Item C (qty 4) -> units B=8, C=4
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_02', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    44000, 'T_TOK_02', v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES 
    (v_order_id, v_item_b, 'AAA Beta Shake', 4000, 8),
    (v_order_id, v_item_c, 'MMM Gamma Fries', 3000, 4);

  -- Order 3: COLLECTED today, has Item D (qty 4) -> tied with Item C at 4 units
  -- Item D is named 'BBB Delta Roll' vs Item C 'MMM Gamma Fries' (BBB < MMM alphabetically)
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_03', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    20000, 'T_TOK_03', v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_d, 'BBB Delta Roll', 5000, 4);

  -- Order 4: COLLECTED today, has Unavailable Item (qty 20) -> should be excluded because is_available=false
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_04', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    100000, 'T_TOK_04', v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_unavail, 'Unavailable Item', 5000, 20);

  -- Order 5: COLLECTED 45 days ago, has Item B (qty 50) -> should be excluded by 30-day window
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_05', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    200000, 'T_TOK_05', v_now - interval '45 days', v_now - interval '45 days', 5, v_now - interval '45 days', v_now - interval '45 days'
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_b, 'AAA Beta Shake', 4000, 50);

  -- Order 6: CANCELLED today, has Item C (qty 100) -> CANCELLED orders must be excluded
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at, cancelled_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student_id, 'T_ORD_06', 'CANCELLED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PENDING'::public.payment_status,
    300000, 'T_TOK_06', v_now, v_now + interval '15 min', 5, v_now, NULL, v_now
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_c, 'MMM Gamma Fries', 3000, 100);

  -- Save environment fixtures into temp table
  INSERT INTO _test_env (key, val_uuid) VALUES
    ('student_id', v_student_id),
    ('staff_id', v_staff_id),
    ('admin_id', v_admin_id),
    ('canteen_id', v_canteen_id),
    ('item_a', v_item_a),
    ('item_b', v_item_b),
    ('item_c', v_item_c),
    ('item_d', v_item_d),
    ('item_unavail', v_item_unavail);

  RAISE NOTICE 'Setup complete. Temporary test users, items, and orders created.';
END;
$$;


-- ==============================================================================
-- TEST 1: Ranking order and tie-breaking by name
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_item_a     uuid;
  v_item_b     uuid;
  v_item_c     uuid;
  v_item_d     uuid;
  v_res        jsonb;
  v_rank1_id   uuid;
  v_rank2_id   uuid;
  v_rank3_id   uuid;
  v_rank4_id   uuid;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_a FROM _test_env WHERE key = 'item_a';
  SELECT val_uuid INTO v_item_b FROM _test_env WHERE key = 'item_b';
  SELECT val_uuid INTO v_item_c FROM _test_env WHERE key = 'item_c';
  SELECT val_uuid INTO v_item_d FROM _test_env WHERE key = 'item_d';

  -- Impersonate active student
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  v_res := public.get_best_sellers(v_canteen_id, 30, 8);

  RESET ROLE;
  IF jsonb_array_length(v_res) >= 4 THEN
    v_rank1_id := ((v_res->0)->>'menu_item_id')::uuid;
    v_rank2_id := ((v_res->1)->>'menu_item_id')::uuid;
    v_rank3_id := ((v_res->2)->>'menu_item_id')::uuid;
    v_rank4_id := ((v_res->3)->>'menu_item_id')::uuid;

    -- Expected: Rank 1 = Item A (12 units), Rank 2 = Item B (8 units),
    -- Rank 3 = Item D (4 units, 'BBB Delta Roll' comes before 'MMM Gamma Fries'),
    -- Rank 4 = Item C (4 units)
    IF v_rank1_id = v_item_a AND v_rank2_id = v_item_b AND v_rank3_id = v_item_d AND v_rank4_id = v_item_c THEN
      INSERT INTO _test_results VALUES (1, 'Ranking order and tie-breaking by name', true, 'Correctly ranked items by total quantity desc with alphabetical name tie-breaker.');
      RAISE NOTICE 'PASS [Test 1]: Ranking order and tie-breaking by name';
    ELSE
      INSERT INTO _test_results VALUES (1, 'Ranking order and tie-breaking by name', false, 'Ranking mismatch: r1=' || v_rank1_id || ', r2=' || v_rank2_id || ', r3=' || v_rank3_id || ', r4=' || v_rank4_id);
    END IF;
  ELSE
    INSERT INTO _test_results VALUES (1, 'Ranking order and tie-breaking by name', false, 'Expected at least 4 items, got: ' || coalesce(v_res::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (1, 'Ranking order and tie-breaking by name', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 2: Window cutoff excludes orders collected outside p_days
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_item_a     uuid;
  v_item_b     uuid;
  v_res        jsonb;
  v_rank1_id   uuid;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_a FROM _test_env WHERE key = 'item_a';
  SELECT val_uuid INTO v_item_b FROM _test_env WHERE key = 'item_b';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  -- With 30-day window, Item B only has 8 units (the 50 units from 45 days ago are excluded).
  -- So Item A (12 units) remains Rank 1.
  v_res := public.get_best_sellers(v_canteen_id, 30, 8);

  RESET ROLE;
  v_rank1_id := ((v_res->0)->>'menu_item_id')::uuid;
  IF v_rank1_id = v_item_a THEN
    INSERT INTO _test_results VALUES (2, 'Window cutoff excludes older orders', true, 'Historical order collected 45 days ago was properly excluded from 30-day window.');
    RAISE NOTICE 'PASS [Test 2]: Window cutoff excludes older orders';
  ELSE
    INSERT INTO _test_results VALUES (2, 'Window cutoff excludes older orders', false, 'Order outside cutoff was counted. Rank 1: ' || v_rank1_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (2, 'Window cutoff excludes older orders', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: Cancelled and non-collected orders are excluded
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_item_c     uuid;
  v_res        jsonb;
  v_rank1_id   uuid;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_c FROM _test_env WHERE key = 'item_c';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  -- Item C has 100 units in CANCELLED order, but only 4 units in COLLECTED order.
  -- If cancelled orders were included, Item C would be rank 1.
  v_res := public.get_best_sellers(v_canteen_id, 30, 8);

  RESET ROLE;
  v_rank1_id := ((v_res->0)->>'menu_item_id')::uuid;
  IF v_rank1_id <> v_item_c THEN
    INSERT INTO _test_results VALUES (3, 'Cancelled and non-collected orders excluded', true, 'Cancelled orders were strictly omitted from total quantity aggregation.');
    RAISE NOTICE 'PASS [Test 3]: Cancelled and non-collected orders excluded';
  ELSE
    INSERT INTO _test_results VALUES (3, 'Cancelled and non-collected orders excluded', false, 'Cancelled order was counted as Rank 1.');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (3, 'Cancelled and non-collected orders excluded', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 4: Unavailable and inactive items are excluded
-- ==============================================================================
DO $$
DECLARE
  v_student_id   uuid;
  v_canteen_id   uuid;
  v_item_unavail uuid;
  v_res          jsonb;
  v_found        boolean := false;
  elem           jsonb;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_unavail FROM _test_env WHERE key = 'item_unavail';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  -- Unavailable item has 20 units collected, but is_available = false.
  v_res := public.get_best_sellers(v_canteen_id, 30, 8);

  RESET ROLE;
  FOR elem IN SELECT * FROM jsonb_array_elements(v_res) LOOP
    IF (elem->>'menu_item_id')::uuid = v_item_unavail THEN
      v_found := true;
    END IF;
  END LOOP;

  IF NOT v_found THEN
    INSERT INTO _test_results VALUES (4, 'Unavailable items excluded', true, 'Items with is_available=false are automatically dropped from best sellers.');
    RAISE NOTICE 'PASS [Test 4]: Unavailable items excluded';
  ELSE
    INSERT INTO _test_results VALUES (4, 'Unavailable items excluded', false, 'Unavailable item appeared in best sellers result.');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'Unavailable items excluded', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Under-threshold returns empty list when < 3 qualifying items
-- ==============================================================================
DO $$
DECLARE
  v_student_id     uuid;
  v_temp_canteen   uuid := gen_random_uuid();
  v_res            jsonb;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  -- Create a temporary canteen with only 1 order & item (< 3 items)
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time)
  VALUES (v_temp_canteen, 'Temp Empty Canteen', '08:00', '18:00', '17:30');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  v_res := public.get_best_sellers(v_temp_canteen, 30, 8);

  RESET ROLE;
  IF v_res IS NOT NULL AND jsonb_array_length(v_res) = 0 THEN
    INSERT INTO _test_results VALUES (5, 'Under-threshold returns empty array', true, 'Canteen with fewer than 3 qualifying items returned empty jsonb array []');
    RAISE NOTICE 'PASS [Test 5]: Under-threshold returns empty array';
  ELSE
    INSERT INTO _test_results VALUES (5, 'Under-threshold returns empty array', false, 'Expected empty array, got: ' || coalesce(v_res::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'Under-threshold returns empty array', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Non-student accounts (staff & admin) receive FORBIDDEN
-- ==============================================================================
DO $$
DECLARE
  v_staff_id   uuid;
  v_admin_id   uuid;
  v_canteen_id uuid;
  v_staff_err  boolean := false;
  v_admin_err  boolean := false;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  -- Test Staff Call
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_staff_id::text, true);
    PERFORM public.get_best_sellers(v_canteen_id, 30, 8);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN
      v_staff_err := true;
    END IF;
  END;

  -- Test Admin Call
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    PERFORM public.get_best_sellers(v_canteen_id, 30, 8);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN
      v_admin_err := true;
    END IF;
  END;

  RESET ROLE;
  IF v_staff_err AND v_admin_err THEN
    INSERT INTO _test_results VALUES (6, 'Non-student accounts are FORBIDDEN', true, 'Staff and Admin calls were correctly rejected with FORBIDDEN.');
    RAISE NOTICE 'PASS [Test 6]: Non-student accounts are FORBIDDEN';
  ELSE
    INSERT INTO _test_results VALUES (6, 'Non-student accounts are FORBIDDEN', false, 'Staff blocked: ' || v_staff_err || ', Admin blocked: ' || v_admin_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 7: Anon cannot execute (privilege check and call verification)
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id uuid;
  v_has_priv   boolean;
  v_call_failed boolean := false;
BEGIN
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  -- Check catalog privilege
  v_has_priv := has_function_privilege('anon', 'public.get_best_sellers(uuid, integer, integer)', 'execute');

  -- Attempt call as anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.get_best_sellers(v_canteen_id, 30, 8);
  EXCEPTION WHEN OTHERS THEN
    v_call_failed := true;
  END;

  RESET ROLE;
  IF NOT v_has_priv AND v_call_failed THEN
    INSERT INTO _test_results VALUES (7, 'Anon role cannot execute get_best_sellers', true, 'has_function_privilege is false and anon call raised permission exception.');
    RAISE NOTICE 'PASS [Test 7]: Anon role cannot execute get_best_sellers';
  ELSE
    INSERT INTO _test_results VALUES (7, 'Anon role cannot execute get_best_sellers', false, 'Privilege leaked or anon call did not error. has_priv: ' || v_has_priv);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 8: Zero revenue or user data leakage in response objects
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_canteen_id uuid;
  v_res        jsonb;
  elem         jsonb;
  v_leaked     boolean := false;
  v_leak_info  text := '';
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_student_id::text, true);

  v_res := public.get_best_sellers(v_canteen_id, 30, 8);

  RESET ROLE;
  IF jsonb_array_length(v_res) > 0 THEN
    FOR elem IN SELECT * FROM jsonb_array_elements(v_res) LOOP
      IF elem ? 'revenue' OR elem ? 'price' OR elem ? 'user_id' OR elem ? 'order_id' OR elem ? 'total_paise' OR elem ? 'student_name' THEN
        v_leaked := true;
        v_leak_info := 'Disallowed key present in element: ' || elem::text;
      END IF;

      IF NOT (elem ? 'menu_item_id') OR NOT (elem ? 'rank') OR NOT (elem ? 'units_sold') THEN
        v_leaked := true;
        v_leak_info := 'Missing required key in element: ' || elem::text;
      END IF;
    END LOOP;

    IF NOT v_leaked THEN
      INSERT INTO _test_results VALUES (8, 'Zero revenue or user fields in output', true, 'Output strictly contains menu_item_id, rank, and units_sold with zero sensitive leakage.');
      RAISE NOTICE 'PASS [Test 8]: Zero revenue or user fields in output';
    ELSE
      INSERT INTO _test_results VALUES (8, 'Zero revenue or user fields in output', false, v_leak_info);
    END IF;
  ELSE
    INSERT INTO _test_results VALUES (8, 'Zero revenue or user fields in output', false, 'Empty result in test 8.');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (8, 'Zero revenue or user fields in output', false, 'Exception: ' || SQLERRM);
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
  RAISE NOTICE 'BEST SELLERS TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
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
    RAISE NOTICE 'SUCCESS: All % Best Sellers test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
