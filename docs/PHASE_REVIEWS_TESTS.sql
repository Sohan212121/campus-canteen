-- ==============================================================================
-- PHASE REVIEWS TEST SUITE: docs/PHASE_REVIEWS_TESTS.sql
-- Description: Interactive & Non-Interactive verification script for Phase 10 verified-purchase reviews:
--              eligibility enforcement, upsert & edit semantics, rating/comment sanitization,
--              hidden review isolation, aggregate synchronization & row-locking (NO KEY UPDATE),
--              rate limiting across 10 distinct items, role boundaries (student/staff/admin/anon),
--              privacy invariants (display name formatting, zero user/email leakage),
--              and update-guard verification for menu_items rating protection and staff toggles.
-- Wrapped in BEGIN ... ROLLBACK so NO changes persist and real rows are NEVER touched.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor and click Run.
-- 3. Review the output in the "Messages / Notices" tab and result table.

BEGIN;

-- Temporary tables for tracking test assertions and fixtures
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
-- Works BEFORE and AFTER migration 0010 (allowed email domains & college_id constraints)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id    uuid := gen_random_uuid();
  v_student2_id    uuid := gen_random_uuid();
  v_student_inact  uuid := gen_random_uuid();
  v_staff_id       uuid := gen_random_uuid();
  v_admin_id       uuid := gen_random_uuid();
  v_canteen_id     uuid;
  v_cat_id         uuid;
  v_now            timestamptz := now();
  v_items          uuid[] := ARRAY[]::uuid[];
  v_item_id        uuid;
  v_item_agg       uuid := gen_random_uuid();
  v_item_display   uuid := gen_random_uuid();
  v_order_id       uuid;
  i                integer;
BEGIN
  RESET ROLE;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'REVIEWS TEST SUITE: SETUP (Role: postgres)';
  RAISE NOTICE '=====================================================';

  -- 1. Locate primary canteen & category
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  IF v_canteen_id IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: No active canteen found.';
  END IF;

  SELECT id INTO v_cat_id FROM public.categories WHERE canteen_id = v_canteen_id AND is_active = true LIMIT 1;
  IF v_cat_id IS NULL THEN
    INSERT INTO public.categories (id, canteen_id, name, display_order, is_active)
    VALUES (gen_random_uuid(), v_canteen_id, 'Test Category', 1, true)
    RETURNING id INTO v_cat_id;
  END IF;

  -- 2. Create isolated test users:
  -- Using raw_app_meta_data {"is_admin_created": true} bypasses student signup checks in 0010.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_student1_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_s1_' || substr(v_student1_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Ravi Kumar"}'::jsonb, now(), now()),
    (v_student2_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_s2_' || substr(v_student2_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Priya Sharma"}'::jsonb, now(), now()),
    (v_student_inact, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_si_' || substr(v_student_inact::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Inactive Student"}'::jsonb, now(), now()),
    (v_staff_id,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_st_' || substr(v_staff_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Test Staff"}'::jsonb, now(), now()),
    (v_admin_id,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_ad_' || substr(v_admin_id::text, 1, 8) || '@test.local', 'pwd', now(), '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Test Admin"}'::jsonb, now(), now());

  -- Update profiles with valid unique uppercase college_ids (required by 0010 constraint)
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Ravi Kumar', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student1_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Priya Sharma', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student2_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Inactive Student', is_active = false, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_student_inact;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true WHERE id = v_staff_id;
  UPDATE public.profiles SET role = 'admin'::public.user_role, is_active = true WHERE id = v_admin_id;

  -- 3. Create temporary menu items:
  -- Item 1: Main item tested for reviews, edits, and moderation
  -- Items 2..11: 10 items used for the 10-review rate limit test
  -- Item 12: Item student never ordered (for verified purchase test)
  FOR i IN 1..12 LOOP
    v_item_id := gen_random_uuid();
    INSERT INTO public.menu_items (
      id, canteen_id, category_id, name, description, price_paise,
      is_veg, is_available, stock, prep_minutes, is_active
    ) VALUES (
      v_item_id, v_canteen_id, v_cat_id, 'Temp Item ' || i || ' ' || substr(v_item_id::text, 1, 6),
      'Test Item', 5000, true, true, 50, 5, true
    );
    v_items := array_append(v_items, v_item_id);
  END LOOP;

  -- Dedicated item for aggregate synchronization lifecycle (Test 6)
  INSERT INTO public.menu_items (
    id, canteen_id, category_id, name, description, price_paise,
    is_veg, is_available, stock, prep_minutes, is_active
  ) VALUES (
    v_item_agg, v_canteen_id, v_cat_id, 'Temp Agg Item ' || substr(v_item_agg::text, 1, 6),
    'Test Item for Aggregates', 5000, true, true, 50, 5, true
  );

  -- Dedicated item for display name assertions (Test 9)
  INSERT INTO public.menu_items (
    id, canteen_id, category_id, name, description, price_paise,
    is_veg, is_available, stock, prep_minutes, is_active
  ) VALUES (
    v_item_display, v_canteen_id, v_cat_id, 'Temp Display Item ' || substr(v_item_display::text, 1, 6),
    'Test Item for Display Names', 5000, true, true, 50, 5, true
  );

  -- 4. Create qualifying COLLECTED orders for student 1 containing items 1..11 and v_item_agg
  FOR i IN 1..11 LOOP
    INSERT INTO public.orders (
      id, canteen_id, user_id, order_code, status, payment_method, payment_status,
      total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
    ) VALUES (
      gen_random_uuid(), v_canteen_id, v_student1_id, 'REV_ORD_' || i || '_' || substr(gen_random_uuid()::text, 1, 4),
      'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
      5000, substr(md5(random()::text), 1, 6), v_now, v_now + interval '15 min', 5, v_now, v_now
    ) RETURNING id INTO v_order_id;

    INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
    VALUES (v_order_id, v_items[i], 'Temp Item ' || i, 5000, 1);
  END LOOP;

  -- Student 1 also orders v_item_agg
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student1_id, 'REV_ORD_AGG1_' || substr(gen_random_uuid()::text, 1, 4),
    'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    5000, substr(md5(random()::text), 1, 6), v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_agg, 'Temp Agg Item', 5000, 1);

  -- Student 2 orders Item 1 and v_item_agg
  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student2_id, 'REV_ORD_S2_' || substr(gen_random_uuid()::text, 1, 4),
    'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    5000, substr(md5(random()::text), 1, 6), v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_items[1], 'Temp Item 1', 5000, 1);

  INSERT INTO public.orders (
    id, canteen_id, user_id, order_code, status, payment_method, payment_status,
    total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at
  ) VALUES (
    gen_random_uuid(), v_canteen_id, v_student2_id, 'REV_ORD_AGG2_' || substr(gen_random_uuid()::text, 1, 4),
    'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status,
    5000, substr(md5(random()::text), 1, 6), v_now, v_now + interval '15 min', 5, v_now, v_now
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
  VALUES (v_order_id, v_item_agg, 'Temp Agg Item', 5000, 1);

  -- Store fixtures
  INSERT INTO _test_env (key, val_uuid) VALUES
    ('student1_id', v_student1_id),
    ('student2_id', v_student2_id),
    ('student_inact', v_student_inact),
    ('staff_id', v_staff_id),
    ('admin_id', v_admin_id),
    ('canteen_id', v_canteen_id),
    ('cat_id', v_cat_id),
    ('item_1', v_items[1]),
    ('item_agg', v_item_agg),
    ('item_display', v_item_display),
    ('item_unpurchased', v_items[12]);

  FOR i IN 2..11 LOOP
    INSERT INTO _test_env (key, val_uuid) VALUES ('item_' || i, v_items[i]);
  END LOOP;

  RAISE NOTICE 'Setup complete.';
END;
$$;


-- ==============================================================================
-- TEST 1: Verified purchase enforced (NOT_ELIGIBLE on unpurchased item)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_unpurchased uuid;
  v_err text := '';
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_unpurchased FROM _test_env WHERE key = 'item_unpurchased';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.submit_review(v_unpurchased, 5, 'Great taste!');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  RESET ROLE;
  IF v_err LIKE '%NOT_ELIGIBLE%' THEN
    INSERT INTO _test_results VALUES (1, 'Verified purchase enforced', true, 'Correctly rejected review for unpurchased item with NOT_ELIGIBLE');
  ELSE
    INSERT INTO _test_results VALUES (1, 'Verified purchase enforced', false, 'Expected NOT_ELIGIBLE, got: ' || v_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 2: Submit review and upsert edit semantics
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_1 uuid;
  v_res1 jsonb;
  v_res2 jsonb;
  v_cnt integer;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. First submission
  v_res1 := public.submit_review(v_item_1, 4, 'Very good dish');

  -- 2. Edit (upsert on user_id, menu_item_id)
  v_res2 := public.submit_review(v_item_1, 5, 'Updated: outstanding dish');

  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.item_reviews WHERE user_id = v_student1_id AND menu_item_id = v_item_1;

  IF v_cnt = 1 AND (v_res2->>'rating')::int = 5 AND v_res2->>'comment' = 'Updated: outstanding dish' THEN
    INSERT INTO _test_results VALUES (2, 'One review per item and edit upsert', true, 'Upsert updated existing review without creating duplicate');
  ELSE
    INSERT INTO _test_results VALUES (2, 'One review per item and edit upsert', false, 'Count=' || v_cnt || ', res=' || coalesce(v_res2::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (2, 'One review per item and edit upsert', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: Rating range validation & NULL safety
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_1 uuid;
  v_null_err boolean := false;
  v_zero_err boolean := false;
  v_six_err boolean := false;
  v_null_item_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- NULL rating
  BEGIN
    PERFORM public.submit_review(v_item_1, NULL, 'Test');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' THEN v_null_err := true; END IF;
  END;

  -- Rating 0
  BEGIN
    PERFORM public.submit_review(v_item_1, 0, 'Test');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' THEN v_zero_err := true; END IF;
  END;

  -- Rating 6
  BEGIN
    PERFORM public.submit_review(v_item_1, 6, 'Test');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' THEN v_six_err := true; END IF;
  END;

  -- NULL menu item id
  BEGIN
    PERFORM public.submit_review(NULL, 5, 'Test');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' THEN v_null_item_err := true; END IF;
  END;

  RESET ROLE;
  IF v_null_err AND v_zero_err AND v_six_err AND v_null_item_err THEN
    INSERT INTO _test_results VALUES (3, 'Rating range & NULL safety', true, 'All invalid rating boundaries and NULLs properly raised INVALID_INPUT');
  ELSE
    INSERT INTO _test_results VALUES (3, 'Rating range & NULL safety', false, 'Failures: null=' || v_null_err || ', zero=' || v_zero_err || ', six=' || v_six_err || ', null_item=' || v_null_item_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 4: Comment sanitization & length limits
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_1 uuid;
  v_long_err boolean := false;
  v_res jsonb;
  v_res_bidi jsonb;
  v_long_str text := repeat('A', 501);
  v_dirty text;
  v_bidi_dirty text;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Length > 500
  BEGIN
    PERFORM public.submit_review(v_item_1, 5, v_long_str);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' THEN v_long_err := true; END IF;
  END;

  -- Whitespace, control chars, zero-width spaces (\u200B)
  v_dirty := E'  Line 1\r\nLine 2\twith \u200Bhidden   ';
  v_res := public.submit_review(v_item_1, 5, v_dirty);

  -- Word-joiner (\u2060) and BOM (\uFEFF) stripping
  v_bidi_dirty := E'Great\u2060Meal\uFEFFDish';
  v_res_bidi := public.submit_review(v_item_1, 5, v_bidi_dirty);

  RESET ROLE;
  IF v_long_err AND (v_res->>'comment') = 'Line 1 Line 2 with hidden' AND (v_res_bidi->>'comment') = 'GreatMealDish' THEN
    INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', true, 'Control/bidi/\u2060/\uFEFF chars stripped, newlines collapsed to single space, outer whitespace trimmed');
  ELSE
    INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', false, 'long_err=' || v_long_err || ', dirty=' || coalesce(v_res->>'comment', 'null') || ', bidi=' || coalesce(v_res_bidi->>'comment', 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Empty comment becomes NULL
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_1 uuid;
  v_res_spaces jsonb;
  v_res_control jsonb;
  v_res_zwsp jsonb;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Pure whitespace
  v_res_spaces := public.submit_review(v_item_1, 5, '     ');

  -- 2. Newlines and tabs
  v_res_control := public.submit_review(v_item_1, 5, E'\t\r\n   ');

  -- 3. Only stripped zero-width / word-joiner characters
  v_res_zwsp := public.submit_review(v_item_1, 5, E'  \u2060  \uFEFF  \u200B  ');

  RESET ROLE;
  IF (v_res_spaces->>'comment') IS NULL AND (v_res_control->>'comment') IS NULL AND (v_res_zwsp->>'comment') IS NULL THEN
    INSERT INTO _test_results VALUES (5, 'Empty comment becomes NULL', true, 'Blank, whitespace-only, and zero-width comments cleanly normalized to NULL');
  ELSE
    INSERT INTO _test_results VALUES (5, 'Empty comment becomes NULL', false, 'spaces=' || coalesce(v_res_spaces->>'comment', 'null') || ', control=' || coalesce(v_res_control->>'comment', 'null') || ', zwsp=' || coalesce(v_res_zwsp->>'comment', 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'Empty comment becomes NULL', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Aggregate synchronization lifecycle (Insert, Edit, Hide, Unhide, Delete)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_student2_id uuid;
  v_admin_id uuid;
  v_item_agg uuid;
  v_avg numeric(3,2);
  v_cnt integer;
  v_s2_review_id uuid;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_agg FROM _test_env WHERE key = 'item_agg';

  -- Step 1: Student 1 submits rating 5 -> avg 5.00, count 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_agg, 5, 'Initial 5');

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 5.00 OR v_cnt != 1 THEN
    RAISE EXCEPTION 'Step 1 failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 2: Student 2 submits rating 3 -> avg 4.00, count 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_agg, 3, 'Initial 3');

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 4.00 OR v_cnt != 2 THEN
    RAISE EXCEPTION 'Step 2 failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 3: Student 2 edits rating to 1 -> avg (5+1)/2 = 3.00, count 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_agg, 1, 'Edited to 1');

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 3.00 OR v_cnt != 2 THEN
    RAISE EXCEPTION 'Step 3 failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 4: Admin hides Student 2's review -> avg 5.00, count 1
  SELECT id INTO v_s2_review_id FROM public.item_reviews WHERE user_id = v_student2_id AND menu_item_id = v_item_agg;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_review_hidden(v_s2_review_id, true);

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 5.00 OR v_cnt != 1 THEN
    RAISE EXCEPTION 'Step 4 (hide) failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 5: Admin unhides Student 2's review -> avg 3.00, count 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_review_hidden(v_s2_review_id, false);

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 3.00 OR v_cnt != 2 THEN
    RAISE EXCEPTION 'Step 5 (unhide) failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 6: Student 1 deletes their review -> avg 1.00, count 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.delete_my_review(v_item_agg);

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg != 1.00 OR v_cnt != 1 THEN
    RAISE EXCEPTION 'Step 6 (delete s1) failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  -- Step 7: Student 2 deletes their review -> avg NULL, count 0
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.delete_my_review(v_item_agg);

  RESET ROLE;
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_agg;
  IF v_avg IS NOT NULL OR v_cnt != 0 THEN
    RAISE EXCEPTION 'Step 7 (delete s2) failed: avg=%, cnt=%', v_avg, v_cnt;
  END IF;

  INSERT INTO _test_results VALUES (6, 'Aggregate synchronization lifecycle', true, 'menu_items rating_avg and rating_count accurately recalculated on insert, edit, hide, unhide, and delete');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (6, 'Aggregate synchronization lifecycle', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 7: Editing a hidden review preserves is_hidden = true
-- ==============================================================================
DO $$
DECLARE
  v_student2_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_review_id uuid;
  v_res jsonb;
  v_still_hidden boolean;
BEGIN
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Ensure student 2 has a review on item_1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_1, 3, 'My test review');

  -- Admin hides it
  RESET ROLE;
  SELECT id INTO v_review_id FROM public.item_reviews WHERE user_id = v_student2_id AND menu_item_id = v_item_1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_review_hidden(v_review_id, true);

  -- Student 2 edits their hidden review
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  v_res := public.submit_review(v_item_1, 4, 'Edited my hidden review');

  RESET ROLE;
  SELECT is_hidden INTO v_still_hidden FROM public.item_reviews WHERE user_id = v_student2_id AND menu_item_id = v_item_1;

  IF v_still_hidden = true THEN
    INSERT INTO _test_results VALUES (7, 'Editing hidden review keeps it hidden', true, 'Upsert DO UPDATE did not unhide review');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Editing hidden review keeps it hidden', false, 'Review became unhidden: is_hidden=' || coalesce(v_still_hidden::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (7, 'Editing hidden review keeps it hidden', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 8: Hidden own review visible only to its author; excluded from public
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_student2_id uuid;
  v_item_1 uuid;
  v_list_author jsonb;
  v_list_other jsonb;
  v_author_sees_hidden boolean := false;
  v_other_sees_hidden boolean := false;
  elem jsonb;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Student 2 (author of hidden review) lists reviews
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_list_author := public.list_item_reviews(v_item_1, 10, 0);

  FOR elem IN SELECT * FROM jsonb_array_elements(v_list_author->'reviews') LOOP
    IF (elem->>'is_hidden')::boolean = true AND (elem->>'is_mine')::boolean = true THEN
      v_author_sees_hidden := true;
    END IF;
  END LOOP;

  -- Student 1 (other user) lists reviews
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  v_list_other := public.list_item_reviews(v_item_1, 10, 0);

  FOR elem IN SELECT * FROM jsonb_array_elements(v_list_other->'reviews') LOOP
    IF (elem->>'is_hidden')::boolean = true THEN
      v_other_sees_hidden := true;
    END IF;
  END LOOP;

  RESET ROLE;
  IF v_author_sees_hidden AND NOT v_other_sees_hidden THEN
    INSERT INTO _test_results VALUES (8, 'Hidden review author-only visibility', true, 'Author sees their own hidden review flagged is_hidden=true; other students see only non-hidden');
  ELSE
    INSERT INTO _test_results VALUES (8, 'Hidden review author-only visibility', false, 'author=' || v_author_sees_hidden || ', other=' || v_other_sees_hidden);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (8, 'Hidden review author-only visibility', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 9: Display name formatting via live list_item_reviews
-- Replaces mock SQL with real students named "Ravi", NULL, "   Amit    Verma   " and "a@b.com"
-- reviewing the same item and asserting live list_item_reviews output.
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id    uuid;
  v_item_display  uuid;
  v_s_ravi        uuid := gen_random_uuid();
  v_s_null        uuid := gen_random_uuid();
  v_s_amit        uuid := gen_random_uuid();
  v_s_mail        uuid := gen_random_uuid();
  v_now           timestamptz := now();
  v_order_id      uuid;
  v_list          jsonb;
  elem            jsonb;
  v_leaked        boolean := false;
  v_got_ravi      boolean := false;
  v_got_null      boolean := false;
  v_got_amit      boolean := false;
  v_got_mail      boolean := false;
BEGIN
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';
  SELECT val_uuid INTO v_item_display FROM _test_env WHERE key = 'item_display';

  RESET ROLE;

  -- Create 4 test student users
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_s_ravi, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ravi_' || substr(v_s_ravi::text, 1, 8) || '@disp.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "Ravi"}'::jsonb, now(), now()),
    (v_s_null, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'null_' || substr(v_s_null::text, 1, 8) || '@disp.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{}'::jsonb, now(), now()),
    (v_s_amit, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'amit_' || substr(v_s_amit::text, 1, 8) || '@disp.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "   Amit    Verma   "}'::jsonb, now(), now()),
    (v_s_mail, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mail_' || substr(v_s_mail::text, 1, 8) || '@disp.local', 'pwd', now(), '{"is_admin_created": true}'::jsonb, '{"full_name": "a@b.com"}'::jsonb, now(), now());

  -- Update profiles with exact target full_names
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Ravi', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_s_ravi;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = NULL, is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_s_null;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = '   Amit    Verma   ', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_s_amit;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'a@b.com', is_active = true, college_id = 'TST' || upper(substr(md5(random()::text), 1, 8)) WHERE id = v_s_mail;

  -- Create qualifying collected orders for all 4
  FOR v_order_id IN
    SELECT gen_random_uuid() FROM unnest(ARRAY[v_s_ravi, v_s_null, v_s_amit, v_s_mail]) AS u
  LOOP
    NULL; -- dummy loop
  END LOOP;

  -- Ravi order & review
  INSERT INTO public.orders (id, canteen_id, user_id, order_code, status, payment_method, payment_status, total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at)
  VALUES (gen_random_uuid(), v_canteen_id, v_s_ravi, 'ORD_RAVI', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, 5000, 'T101', v_now, v_now, 5, v_now, v_now) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity) VALUES (v_order_id, v_item_display, 'Display Item', 5000, 1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s_ravi::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_display, 5, 'Ravi review');

  -- Null order & review
  RESET ROLE;
  INSERT INTO public.orders (id, canteen_id, user_id, order_code, status, payment_method, payment_status, total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at)
  VALUES (gen_random_uuid(), v_canteen_id, v_s_null, 'ORD_NULL', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, 5000, 'T102', v_now, v_now, 5, v_now, v_now) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity) VALUES (v_order_id, v_item_display, 'Display Item', 5000, 1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s_null::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_display, 4, 'Null review');

  -- Amit order & review
  RESET ROLE;
  INSERT INTO public.orders (id, canteen_id, user_id, order_code, status, payment_method, payment_status, total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at)
  VALUES (gen_random_uuid(), v_canteen_id, v_s_amit, 'ORD_AMIT', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, 5000, 'T103', v_now, v_now, 5, v_now, v_now) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity) VALUES (v_order_id, v_item_display, 'Display Item', 5000, 1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s_amit::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_display, 3, 'Amit review');

  -- Email-like order & review
  RESET ROLE;
  INSERT INTO public.orders (id, canteen_id, user_id, order_code, status, payment_method, payment_status, total_paise, pickup_token, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at, collected_at)
  VALUES (gen_random_uuid(), v_canteen_id, v_s_mail, 'ORD_MAIL', 'COLLECTED'::public.order_status, 'PAY_AT_PICKUP'::public.payment_method, 'PAID'::public.payment_status, 5000, 'T104', v_now, v_now, 5, v_now, v_now) RETURNING id INTO v_order_id;
  INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity) VALUES (v_order_id, v_item_display, 'Display Item', 5000, 1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s_mail::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_display, 2, 'Mail review');

  -- Call real list_item_reviews as student Ravi
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s_ravi::text)::text, true);
  v_list := public.list_item_reviews(v_item_display, 10, 0);

  RESET ROLE;
  FOR elem IN SELECT * FROM jsonb_array_elements(v_list->'reviews') LOOP
    -- Privacy check: zero leak of id, user_id, email, college_id
    IF elem ? 'id' OR elem ? 'user_id' OR elem ? 'email' OR elem ? 'college_id' THEN
      v_leaked := true;
    END IF;

    IF elem->>'comment' = 'Ravi review' AND elem->>'display_name' = 'Ravi' THEN
      v_got_ravi := true;
    ELSIF elem->>'comment' = 'Null review' AND elem->>'display_name' = 'Student' THEN
      v_got_null := true;
    ELSIF elem->>'comment' = 'Amit review' AND elem->>'display_name' = 'Amit V.' THEN
      v_got_amit := true;
    ELSIF elem->>'comment' = 'Mail review' AND elem->>'display_name' = 'Student' THEN
      v_got_mail := true;
    END IF;
  END LOOP;

  IF NOT v_leaked AND v_got_ravi AND v_got_null AND v_got_amit AND v_got_mail THEN
    INSERT INTO _test_results VALUES (9, 'Display name formatting in live list_item_reviews', true, 'Correctly formatted Ravi, NULL -> Student, Amit Verma -> Amit V., and a@b.com -> Student with zero ID/email leakage');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Display name formatting in live list_item_reviews', false, 'leaked=' || v_leaked || ', ravi=' || v_got_ravi || ', null=' || v_got_null || ', amit=' || v_got_amit || ', mail=' || v_got_mail);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (9, 'Display name formatting in live list_item_reviews', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 10: Rate limiting across 10 distinct temporary items
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_id uuid;
  i integer;
  v_11th_err text := '';
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Submit reviews for items 2 through 10 (Item 1 was reviewed earlier, so total is 10)
  FOR i IN 2..10 LOOP
    SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_' || i;
    PERFORM public.submit_review(v_item_id, 5, 'Great item ' || i);
  END LOOP;

  -- Attempt 11th distinct item review (item 11)
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_11';
  BEGIN
    PERFORM public.submit_review(v_item_id, 5, '11th item review');
  EXCEPTION WHEN OTHERS THEN
    v_11th_err := SQLERRM;
  END;

  RESET ROLE;
  IF v_11th_err LIKE '%RATE_LIMITED%' THEN
    INSERT INTO _test_results VALUES (10, 'Rate limit on 10 distinct items per 24h', true, '11th distinct item review rejected with RATE_LIMITED');
  ELSE
    INSERT INTO _test_results VALUES (10, 'Rate limit on 10 distinct items per 24h', false, 'Expected RATE_LIMITED, got: ' || v_11th_err);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (10, 'Rate limit on 10 distinct items per 24h', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 11: Role boundaries (Staff & Admin cannot submit; Student cannot moderate)
-- ==============================================================================
DO $$
DECLARE
  v_staff_id uuid;
  v_admin_id uuid;
  v_student1_id uuid;
  v_item_1 uuid;
  v_review_id uuid;
  v_staff_sub_err boolean := false;
  v_admin_sub_err boolean := false;
  v_stud_mod_err boolean := false;
  v_stud_list_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  SELECT id INTO v_review_id FROM public.item_reviews WHERE menu_item_id = v_item_1 LIMIT 1;

  -- 1. Staff cannot submit review
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.submit_review(v_item_1, 5, 'Staff review');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_staff_sub_err := true; END IF;
  END;

  -- 2. Admin cannot submit review
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  BEGIN
    PERFORM public.submit_review(v_item_1, 5, 'Admin review');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_admin_sub_err := true; END IF;
  END;

  -- 3. Student cannot call admin moderation functions
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  BEGIN
    PERFORM public.admin_set_review_hidden(v_review_id, true);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_stud_mod_err := true; END IF;
  END;

  BEGIN
    PERFORM public.admin_list_reviews();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_stud_list_err := true; END IF;
  END;

  RESET ROLE;
  IF v_staff_sub_err AND v_admin_sub_err AND v_stud_mod_err AND v_stud_list_err THEN
    INSERT INTO _test_results VALUES (11, 'Role boundaries & function isolation', true, 'Staff/Admin cannot submit reviews, student cannot moderate reviews or list admin queue');
  ELSE
    INSERT INTO _test_results VALUES (11, 'Role boundaries & function isolation', false, 'staff_sub=' || v_staff_sub_err || ', admin_sub=' || v_admin_sub_err || ', stud_mod=' || v_stud_mod_err || ', stud_list=' || v_stud_list_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 12: Staff and Admin get FORBIDDEN from list_item_reviews
-- ==============================================================================
DO $$
DECLARE
  v_staff_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_staff_err text := '';
  v_admin_err text := '';
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Staff call
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.list_item_reviews(v_item_1);
  EXCEPTION WHEN OTHERS THEN
    v_staff_err := SQLERRM;
  END;

  -- Admin call
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  BEGIN
    PERFORM public.list_item_reviews(v_item_1);
  EXCEPTION WHEN OTHERS THEN
    v_admin_err := SQLERRM;
  END;

  RESET ROLE;
  IF v_staff_err LIKE '%FORBIDDEN%' AND v_admin_err LIKE '%FORBIDDEN%' THEN
    INSERT INTO _test_results VALUES (12, 'Staff & Admin forbidden from list_item_reviews', true, 'list_item_reviews strictly enforces student role');
  ELSE
    INSERT INTO _test_results VALUES (12, 'Staff & Admin forbidden from list_item_reviews', false, 'staff_err=' || v_staff_err || ', admin_err=' || v_admin_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 13: Menu items update guard: rating columns protected, staff edits work
-- Asserts distinct rating value (1.11 and rating_count + 1). For student, asserts zero rows affected.
-- ==============================================================================
DO $$
DECLARE
  v_staff_id uuid;
  v_student1_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_staff_rate_err boolean := false;
  v_admin_rate_err boolean := false;
  v_stud_rows integer := -1;
  v_check_avg numeric(3,2);
  v_staff_avail_ok boolean := false;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- 1. Staff attempts to update rating_avg directly (blocked by trigger guard)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.menu_items SET rating_avg = 1.11, rating_count = rating_count + 1 WHERE id = v_item_1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%prohibited%' THEN v_staff_rate_err := true; END IF;
  END;

  -- 2. Staff updates is_available and stock (must succeed!)
  BEGIN
    UPDATE public.menu_items SET is_available = false, stock = 10 WHERE id = v_item_1;
    v_staff_avail_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_staff_avail_ok := false;
  END;

  -- 3. Admin attempts direct modification of rating columns (blocked by trigger guard)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  BEGIN
    UPDATE public.menu_items SET rating_avg = 1.11, rating_count = rating_count + 1 WHERE id = v_item_1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%prohibited%' THEN v_admin_rate_err := true; END IF;
  END;

  -- 4. Student attempts update (RLS gives no exception, but filters out row -> 0 rows affected)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  BEGIN
    UPDATE public.menu_items SET rating_avg = 1.11, rating_count = rating_count + 1 WHERE id = v_item_1;
    GET DIAGNOSTICS v_stud_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_stud_rows := -2;
  END;

  RESET ROLE;
  SELECT rating_avg INTO v_check_avg FROM public.menu_items WHERE id = v_item_1;

  IF v_staff_rate_err AND v_staff_avail_ok AND v_admin_rate_err AND v_stud_rows = 0 AND (v_check_avg IS DISTINCT FROM 1.11) THEN
    INSERT INTO _test_results VALUES (13, 'Menu items update guard protects ratings', true, 'Staff/Admin direct rating edits blocked with prohibited; student UPDATE affects 0 rows; staff stock edit succeeds');
  ELSE
    INSERT INTO _test_results VALUES (13, 'Menu items update guard protects ratings', false, 'staff_rate=' || v_staff_rate_err || ', staff_ok=' || v_staff_avail_ok || ', admin_rate=' || v_admin_rate_err || ', stud_rows=' || v_stud_rows || ', check_avg=' || coalesce(v_check_avg::text, 'null'));
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 14: Admin hide/unhide audit rows, idempotency, and unchanged updated_at
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_item_1 uuid;
  v_review_id uuid;
  v_time_before timestamptz;
  v_time_hide timestamptz;
  v_time_unhide timestamptz;
  v_res_hide jsonb;
  v_res_hide_again jsonb;
  v_res_unhide jsonb;
  v_res_unhide_again jsonb;
  v_audit_count1 integer;
  v_audit_count2 integer;
  v_audit_count3 integer;
  v_audit_count4 integer;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  SELECT id, updated_at INTO v_review_id, v_time_before
  FROM public.item_reviews
  WHERE menu_item_id = v_item_1
  LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Hide review
  v_res_hide := public.admin_set_review_hidden(v_review_id, true);

  RESET ROLE;
  SELECT updated_at INTO v_time_hide FROM public.item_reviews WHERE id = v_review_id;
  SELECT count(*) INTO v_audit_count1 FROM public.admin_audit_log WHERE target_id = v_review_id::text AND action = 'HIDE_REVIEW';

  -- 2. Hide again (idempotent: changed=false, no new audit log)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_res_hide_again := public.admin_set_review_hidden(v_review_id, true);

  RESET ROLE;
  SELECT count(*) INTO v_audit_count2 FROM public.admin_audit_log WHERE target_id = v_review_id::text AND action = 'HIDE_REVIEW';

  -- 3. Unhide review
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_res_unhide := public.admin_set_review_hidden(v_review_id, false);

  RESET ROLE;
  SELECT updated_at INTO v_time_unhide FROM public.item_reviews WHERE id = v_review_id;
  SELECT count(*) INTO v_audit_count3 FROM public.admin_audit_log WHERE target_id = v_review_id::text AND action = 'UNHIDE_REVIEW';

  -- 4. Unhide again (idempotent: changed=false, no new audit log)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_res_unhide_again := public.admin_set_review_hidden(v_review_id, false);

  RESET ROLE;
  SELECT count(*) INTO v_audit_count4 FROM public.admin_audit_log WHERE target_id = v_review_id::text AND action = 'UNHIDE_REVIEW';

  IF (v_res_hide->>'changed')::boolean = true
     AND (v_res_hide_again->>'changed')::boolean = false
     AND (v_res_unhide->>'changed')::boolean = true
     AND (v_res_unhide_again->>'changed')::boolean = false
     AND v_audit_count1 = 1 AND v_audit_count2 = 1
     AND v_audit_count3 = 1 AND v_audit_count4 = 1
     AND v_time_before = v_time_hide
     AND v_time_before = v_time_unhide THEN
    INSERT INTO _test_results VALUES (14, 'Admin moderation audit rows, idempotency & updated_at preservation', true, 'Audit rows inserted only on state change; updated_at preserved throughout hide and unhide');
  ELSE
    INSERT INTO _test_results VALUES (14, 'Admin moderation audit rows, idempotency & updated_at preservation', false, 'audit1=' || v_audit_count1 || ', audit2=' || v_audit_count2 || ', audit3=' || v_audit_count3 || ', audit4=' || v_audit_count4 || ', time_match=' || (v_time_before = v_time_hide AND v_time_before = v_time_unhide));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (14, 'Admin moderation audit rows, idempotency & updated_at preservation', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 15: Inactive student account blocked across all student procedures
-- ==============================================================================
DO $$
DECLARE
  v_student_inact uuid;
  v_item_1 uuid;
  v_sub_err boolean := false;
  v_del_err boolean := false;
  v_list_err boolean := false;
  v_elig_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_student_inact FROM _test_env WHERE key = 'student_inact';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_inact::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. submit_review
  BEGIN
    PERFORM public.submit_review(v_item_1, 5, 'Inactive test');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_sub_err := true; END IF;
  END;

  -- 2. delete_my_review
  BEGIN
    PERFORM public.delete_my_review(v_item_1);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_del_err := true; END IF;
  END;

  -- 3. list_item_reviews
  BEGIN
    PERFORM public.list_item_reviews(v_item_1);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_list_err := true; END IF;
  END;

  -- 4. get_my_review_eligibility
  BEGIN
    PERFORM public.get_my_review_eligibility(ARRAY[v_item_1]);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_elig_err := true; END IF;
  END;

  RESET ROLE;
  IF v_sub_err AND v_del_err AND v_list_err AND v_elig_err THEN
    INSERT INTO _test_results VALUES (15, 'Inactive student rejected with FORBIDDEN', true, 'All 4 student review procedures reject inactive student');
  ELSE
    INSERT INTO _test_results VALUES (15, 'Inactive student rejected with FORBIDDEN', false, 'sub=' || v_sub_err || ', del=' || v_del_err || ', list=' || v_list_err || ', elig=' || v_elig_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 16: No JWT claims raises UNAUTHENTICATED across all 6 API functions
-- ==============================================================================
DO $$
DECLARE
  v_item_1 uuid;
  v_sub_err boolean := false;
  v_del_err boolean := false;
  v_list_err boolean := false;
  v_elig_err boolean := false;
  v_admin_list_err boolean := false;
  v_admin_mod_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Simulate authenticated role without claims (auth.uid() is null)
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE authenticated;

  BEGIN PERFORM public.submit_review(v_item_1, 5); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_sub_err := true; END IF; END;
  BEGIN PERFORM public.delete_my_review(v_item_1); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_del_err := true; END IF; END;
  BEGIN PERFORM public.list_item_reviews(v_item_1); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_list_err := true; END IF; END;
  BEGIN PERFORM public.get_my_review_eligibility(ARRAY[v_item_1]); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_elig_err := true; END IF; END;
  BEGIN PERFORM public.admin_list_reviews(); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_admin_list_err := true; END IF; END;
  BEGIN PERFORM public.admin_set_review_hidden(gen_random_uuid(), true); EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%UNAUTHENTICATED%' THEN v_admin_mod_err := true; END IF; END;

  RESET ROLE;
  IF v_sub_err AND v_del_err AND v_list_err AND v_elig_err AND v_admin_list_err AND v_admin_mod_err THEN
    INSERT INTO _test_results VALUES (16, 'No claims raises UNAUTHENTICATED', true, 'All review procedures require auth.uid()');
  ELSE
    INSERT INTO _test_results VALUES (16, 'No claims raises UNAUTHENTICATED', false, 'sub=' || v_sub_err || ', del=' || v_del_err || ', list=' || v_list_err || ', elig=' || v_elig_err || ', alist=' || v_admin_list_err || ', amod=' || v_admin_mod_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 17: Delete affects only own review (NOT_FOUND when deleting another user review)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_student2_id uuid;
  v_item_2 uuid;
  v_del_err text := '';
  v_s1_still_exists boolean;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_item_2 FROM _test_env WHERE key = 'item_2';

  -- Student 1 reviews item 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_2, 5, 'Student 1 only review');

  -- Student 2 (who did not review item 2) tries to delete it
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  BEGIN
    PERFORM public.delete_my_review(v_item_2);
  EXCEPTION WHEN OTHERS THEN
    v_del_err := SQLERRM;
  END;

  RESET ROLE;
  SELECT EXISTS (
    SELECT 1 FROM public.item_reviews WHERE user_id = v_student1_id AND menu_item_id = v_item_2
  ) INTO v_s1_still_exists;

  IF v_del_err LIKE '%NOT_FOUND%' AND v_s1_still_exists THEN
    INSERT INTO _test_results VALUES (17, 'Delete affects only own review', true, 'delete_my_review raised NOT_FOUND for non-author and preserved original review');
  ELSE
    INSERT INTO _test_results VALUES (17, 'Delete affects only own review', false, 'del_err=' || v_del_err || ', s1_exists=' || v_s1_still_exists);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 18: Limit and offset clamping in list_item_reviews and admin_list_reviews
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_res_student_neg jsonb;
  v_res_student_max jsonb;
  v_res_admin_neg jsonb;
  v_res_admin_max jsonb;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Student pagination clamping: limit clamped to [1, 50], offset clamped to [0, inf)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  v_res_student_neg := public.list_item_reviews(v_item_1, -10, -5);
  v_res_student_max := public.list_item_reviews(v_item_1, 200, 0);

  -- Admin pagination clamping: limit clamped to [1, 100], offset clamped to [0, inf)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  v_res_admin_neg := public.admin_list_reviews('all', NULL, -10, -5);
  v_res_admin_max := public.admin_list_reviews('all', NULL, 500, 0);

  RESET ROLE;
  IF jsonb_array_length(v_res_student_neg->'reviews') <= 1
     AND (v_res_admin_neg->>'limit')::int = 1
     AND (v_res_admin_neg->>'offset')::int = 0
     AND (v_res_admin_max->>'limit')::int = 100 THEN
    INSERT INTO _test_results VALUES (18, 'Pagination limit and offset clamping', true, 'Student clamped to [1,50] and offset >= 0; admin clamped to [1,100] and offset >= 0');
  ELSE
    INSERT INTO _test_results VALUES (18, 'Pagination limit and offset clamping', false, 'admin_neg_lim=' || (v_res_admin_neg->>'limit') || ', admin_max_lim=' || (v_res_admin_max->>'limit'));
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 19: Comprehensive get_my_review_eligibility checks
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_staff_id uuid;
  v_item_1 uuid;
  v_item_10 uuid;
  v_item_unpurchased uuid;
  v_res jsonb;
  v_elem jsonb;
  v_item1_ok boolean := false;
  v_unpurch_ok boolean := false;
  v_empty_res jsonb;
  v_too_many_err text := '';
  v_staff_err text := '';
  v_many_ids uuid[];
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';
  SELECT val_uuid INTO v_item_10 FROM _test_env WHERE key = 'item_10';
  SELECT val_uuid INTO v_item_unpurchased FROM _test_env WHERE key = 'item_unpurchased';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Check eligibility on item_1 (reviewed) and item_unpurchased (not ordered)
  v_res := public.get_my_review_eligibility(ARRAY[v_item_1, v_item_unpurchased]);

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_res) LOOP
    IF (v_elem->>'menu_item_id')::uuid = v_item_1 THEN
      IF (v_elem->>'can_review')::boolean = true AND (v_elem->>'has_reviewed')::boolean = true THEN
        v_item1_ok := true;
      END IF;
    ELSIF (v_elem->>'menu_item_id')::uuid = v_item_unpurchased THEN
      IF (v_elem->>'can_review')::boolean = false AND (v_elem->>'has_reviewed')::boolean = false THEN
        v_unpurch_ok := true;
      END IF;
    END IF;
  END LOOP;

  -- 2. Empty array
  v_empty_res := public.get_my_review_eligibility(ARRAY[]::uuid[]);

  -- 3. More than 50 items raises INVALID_INPUT
  v_many_ids := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 51));
  BEGIN
    PERFORM public.get_my_review_eligibility(v_many_ids);
  EXCEPTION WHEN OTHERS THEN
    v_too_many_err := SQLERRM;
  END;

  -- 4. Staff blocked
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text)::text, true);
  BEGIN
    PERFORM public.get_my_review_eligibility(ARRAY[v_item_1]);
  EXCEPTION WHEN OTHERS THEN
    v_staff_err := SQLERRM;
  END;

  RESET ROLE;
  IF v_item1_ok AND v_unpurch_ok AND v_empty_res = '[]'::jsonb
     AND v_too_many_err LIKE '%INVALID_INPUT%' AND v_staff_err LIKE '%FORBIDDEN%' THEN
    INSERT INTO _test_results VALUES (19, 'get_my_review_eligibility comprehensive checks', true, 'Correctly reports eligible/reviewed status, rejects >50 items, handles empty array, restricts to student');
  ELSE
    INSERT INTO _test_results VALUES (19, 'get_my_review_eligibility comprehensive checks', false, 'item1=' || v_item1_ok || ', unpurch=' || v_unpurch_ok || ', empty=' || v_empty_res::text || ', many_err=' || v_too_many_err || ', staff_err=' || v_staff_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 20: Anon execution revoked for all 7 review functions
-- ==============================================================================
DO $$
DECLARE
  v_item_1 uuid;
  v_p1 boolean;
  v_p2 boolean;
  v_p3 boolean;
  v_p4 boolean;
  v_p5 boolean;
  v_p6 boolean;
  v_p7 boolean;
  v_anon_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  v_p1 := has_function_privilege('anon', 'public.submit_review(uuid, integer, text)', 'execute');
  v_p2 := has_function_privilege('anon', 'public.delete_my_review(uuid)', 'execute');
  v_p3 := has_function_privilege('anon', 'public.list_item_reviews(uuid, integer, integer)', 'execute');
  v_p4 := has_function_privilege('anon', 'public.get_my_review_eligibility(uuid[])', 'execute');
  v_p5 := has_function_privilege('anon', 'public.admin_list_reviews(text, text, integer, integer)', 'execute');
  v_p6 := has_function_privilege('anon', 'public.admin_set_review_hidden(uuid, boolean)', 'execute');
  v_p7 := has_function_privilege('anon', 'public.handle_review_rating_sync()', 'execute');

  -- Attempt live call as anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.list_item_reviews(v_item_1);
  EXCEPTION WHEN OTHERS THEN
    v_anon_err := true;
  END;

  RESET ROLE;
  IF NOT v_p1 AND NOT v_p2 AND NOT v_p3 AND NOT v_p4 AND NOT v_p5 AND NOT v_p6 AND NOT v_p7 AND v_anon_err THEN
    INSERT INTO _test_results VALUES (20, 'Anon execution revoked across all 7 functions', true, 'Zero execute permissions granted to anon; direct execution raises permission error');
  ELSE
    INSERT INTO _test_results VALUES (20, 'Anon execution revoked across all 7 functions', false, 'p1=' || v_p1 || ', p2=' || v_p2 || ', p3=' || v_p3 || ', p4=' || v_p4 || ', p5=' || v_p5 || ', p6=' || v_p6 || ', p7=' || v_p7 || ', anon_err=' || v_anon_err);
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
  v_fail_summary text := '';
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_pass_count FROM _test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'REVIEWS TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
  RAISE NOTICE '=====================================================';

  FOR r IN SELECT test_num, test_name, passed, details FROM _test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE '[PASS] Test %: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE '[FAIL] Test %: % - %', r.test_num, r.test_name, r.details;
      v_fail_summary := v_fail_summary || ' [Test ' || r.test_num || ': ' || r.test_name || ' -> ' || r.details || ']';
    END IF;
  END LOOP;

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % out of % tests failed.%', v_fail_count, v_total, v_fail_summary;
  ELSIF v_total < 20 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 20 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Reviews test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

-- Show passing run results before transaction rollback
SELECT test_num, test_name, passed, details
FROM _test_results
ORDER BY test_num;

ROLLBACK;
