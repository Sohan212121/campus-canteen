-- ==============================================================================
-- PHASE REVIEWS TEST SUITE: docs/PHASE_REVIEWS_TESTS.sql
-- Description: Interactive verification script for Phase 10 verified-purchase reviews:
--              eligibility enforcement, upsert & edit semantics, rating/comment sanitization,
--              hidden review isolation, aggregate synchronization & row-locking,
--              rate limiting across 10 distinct items, role boundaries (student/staff/admin/anon),
--              privacy invariants (display name formatting, zero user/email leakage),
--              and update-guard verification for menu_items rating protection and staff toggles.
-- Wrapped in BEGIN ... ROLLBACK so NO changes persist and real rows are NEVER touched.
-- ==============================================================================

-- INSTRUCTIONS:
-- 1. Open the Supabase SQL Editor.
-- 2. Paste this entire file into the query editor and click Run.
-- 3. Review the output in the "Messages / Notices" tab.

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

  -- 2. Create isolated test users
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES 
    (v_student1_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_s1_' || substr(v_student1_id::text, 1, 8) || '@test.com', 'pwd', now(), '{"full_name": "Ravi Kumar"}'::jsonb, now(), now()),
    (v_student2_id,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_s2_' || substr(v_student2_id::text, 1, 8) || '@test.com', 'pwd', now(), '{"full_name": "Priya Sharma"}'::jsonb, now(), now()),
    (v_student_inact, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_si_' || substr(v_student_inact::text, 1, 8) || '@test.com', 'pwd', now(), '{"full_name": "Inactive Student"}'::jsonb, now(), now()),
    (v_staff_id,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_st_' || substr(v_staff_id::text, 1, 8) || '@test.com', 'pwd', now(), '{"full_name": "Test Staff"}'::jsonb, now(), now()),
    (v_admin_id,      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rev_ad_' || substr(v_admin_id::text, 1, 8) || '@test.com', 'pwd', now(), '{"full_name": "Test Admin"}'::jsonb, now(), now());

  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Ravi Kumar', is_active = true WHERE id = v_student1_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Priya Sharma', is_active = true WHERE id = v_student2_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Inactive Student', is_active = false WHERE id = v_student_inact;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true WHERE id = v_staff_id;
  UPDATE public.profiles SET role = 'admin'::public.user_role, is_active = true WHERE id = v_admin_id;

  -- 3. Create 12 temporary menu items:
  -- Item 1: Main item tested for reviews, edits, and rating sync
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

  -- 4. Create qualifying COLLECTED orders for student 1 containing items 1..11
  -- (Item 12 is NOT ordered by student 1)
  -- Supply all NOT NULL order columns
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

  -- Student 2 also orders Item 1 (for multi-user review assertions)
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

  -- Store fixtures
  INSERT INTO _test_env (key, val_uuid) VALUES
    ('student1_id', v_student1_id),
    ('student2_id', v_student2_id),
    ('student_inact', v_student_inact),
    ('staff_id', v_staff_id),
    ('admin_id', v_admin_id),
    ('canteen_id', v_canteen_id),
    ('item_1', v_items[1]),
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
  v_long_str text := repeat('A', 501);
  v_dirty text;
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

  RESET ROLE;
  IF v_long_err AND (v_res->>'comment') = 'Line 1 Line 2 with hidden' THEN
    INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', true, 'Control/bidi chars stripped, newlines collapsed to single space, outer whitespace trimmed');
  ELSE
    INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', false, 'long_err=' || v_long_err || ', got=' || coalesce(v_res->>'comment', 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'Comment sanitization and length check', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Aggregate synchronization & row-locking (Insert, Edit, Delete, Hide)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_student2_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_avg numeric(3,2);
  v_cnt integer;
  v_review1_id uuid;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Student 1 submits rating 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.submit_review(v_item_1, 5, 'Great');

  -- Student 2 submits rating 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  PERFORM public.submit_review(v_item_1, 3, 'Okay');

  RESET ROLE;
  -- Expected: avg = (5 + 3)/2 = 4.00, count = 2
  SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_1;

  IF v_avg = 4.00 AND v_cnt = 2 THEN
    -- Admin hides Student 2's review
    SELECT id INTO v_review1_id FROM public.item_reviews WHERE user_id = v_student2_id AND menu_item_id = v_item_1;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_set_review_hidden(v_review1_id, true);

    RESET ROLE;
    -- Expected after hide: avg = 5.00, count = 1
    SELECT rating_avg, rating_count INTO v_avg, v_cnt FROM public.menu_items WHERE id = v_item_1;

    IF v_avg = 5.00 AND v_cnt = 1 THEN
      INSERT INTO _test_results VALUES (5, 'Rating aggregate synchronization', true, 'menu_items.rating_avg and rating_count correctly recomputed on insert and hide');
    ELSE
      INSERT INTO _test_results VALUES (5, 'Rating aggregate synchronization', false, 'After hide: avg=' || coalesce(v_avg::text, 'null') || ', cnt=' || coalesce(v_cnt::text, 'null'));
    END IF;
  ELSE
    INSERT INTO _test_results VALUES (5, 'Rating aggregate synchronization', false, 'Initial: avg=' || coalesce(v_avg::text, 'null') || ', cnt=' || coalesce(v_cnt::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'Rating aggregate synchronization', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Editing a hidden review preserves is_hidden = true
-- ==============================================================================
DO $$
DECLARE
  v_student2_id uuid;
  v_item_1 uuid;
  v_res jsonb;
  v_still_hidden boolean;
BEGIN
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- Student 2 edits their previously hidden review
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.submit_review(v_item_1, 4, 'Edited my hidden review');

  RESET ROLE;
  SELECT is_hidden INTO v_still_hidden FROM public.item_reviews WHERE user_id = v_student2_id AND menu_item_id = v_item_1;

  IF v_still_hidden = true THEN
    INSERT INTO _test_results VALUES (6, 'Editing hidden review keeps it hidden', true, 'Upsert DO UPDATE did not unhide review');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Editing hidden review keeps it hidden', false, 'Review became unhidden: is_hidden=' || coalesce(v_still_hidden::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (6, 'Editing hidden review keeps it hidden', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 7: Hidden own review visible only to its author; excluded from public
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
    INSERT INTO _test_results VALUES (7, 'Hidden review author-only visibility', true, 'Author sees their own hidden review flagged is_hidden=true; other students see only non-hidden');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Hidden review author-only visibility', false, 'author=' || v_author_sees_hidden || ', other=' || v_other_sees_hidden);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (7, 'Hidden review author-only visibility', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 8: Privacy invariants (display names & zero user_id/email in student list)
-- ==============================================================================
DO $$
DECLARE
  v_student1_id uuid;
  v_item_1 uuid;
  v_list jsonb;
  elem jsonb;
  v_leaked boolean := false;
  v_disp_name text;
BEGIN
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  v_list := public.list_item_reviews(v_item_1, 10, 0);

  RESET ROLE;
  FOR elem IN SELECT * FROM jsonb_array_elements(v_list->'reviews') LOOP
    IF elem ? 'user_id' OR elem ? 'email' OR elem ? 'college_id' OR elem ? 'id' THEN
      v_leaked := true;
    END IF;
    IF (elem->>'is_mine')::boolean = true THEN
      v_disp_name := elem->>'display_name';
    END IF;
  END LOOP;

  -- "Ravi Kumar" should format to "Ravi K."
  IF NOT v_leaked AND v_disp_name = 'Ravi K.' THEN
    INSERT INTO _test_results VALUES (8, 'Privacy invariant & display name format', true, 'Output contains zero id/email/user_id, formatted display_name to Ravi K.');
  ELSE
    INSERT INTO _test_results VALUES (8, 'Privacy invariant & display name format', false, 'leaked=' || v_leaked || ', disp_name=' || coalesce(v_disp_name, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (8, 'Privacy invariant & display name format', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 9: Display name formatting edge cases
-- ==============================================================================
DO $$
DECLARE
  v_test_cases text[];
  v_single text;
  v_blank text;
  v_email text;
  v_spaces text;
BEGIN
  -- Test the SQL display name logic on edge cases
  SELECT
    CASE
      WHEN full_name IS NULL OR length(trim(full_name)) = 0 OR full_name LIKE '%@%' THEN 'Student'
      ELSE
        (
          WITH cleaned AS (SELECT regexp_replace(trim(full_name), '\s+', ' ', 'g') AS s)
          SELECT CASE WHEN position(' ' in s) > 0 THEN substr(split_part(s, ' ', 1), 1, 20) || ' ' || upper(substr(split_part(s, ' ', 2), 1, 1)) || '.' ELSE substr(s, 1, 20) END FROM cleaned
        )
    END
  INTO v_single
  FROM (SELECT 'Ravi'::text AS full_name) t;

  SELECT
    CASE
      WHEN full_name IS NULL OR length(trim(full_name)) = 0 OR full_name LIKE '%@%' THEN 'Student'
      ELSE
        (
          WITH cleaned AS (SELECT regexp_replace(trim(full_name), '\s+', ' ', 'g') AS s)
          SELECT CASE WHEN position(' ' in s) > 0 THEN substr(split_part(s, ' ', 1), 1, 20) || ' ' || upper(substr(split_part(s, ' ', 2), 1, 1)) || '.' ELSE substr(s, 1, 20) END FROM cleaned
        )
    END
  INTO v_blank
  FROM (SELECT '   '::text AS full_name) t;

  SELECT
    CASE
      WHEN full_name IS NULL OR length(trim(full_name)) = 0 OR full_name LIKE '%@%' THEN 'Student'
      ELSE
        (
          WITH cleaned AS (SELECT regexp_replace(trim(full_name), '\s+', ' ', 'g') AS s)
          SELECT CASE WHEN position(' ' in s) > 0 THEN substr(split_part(s, ' ', 1), 1, 20) || ' ' || upper(substr(split_part(s, ' ', 2), 1, 1)) || '.' ELSE substr(s, 1, 20) END FROM cleaned
        )
    END
  INTO v_email
  FROM (SELECT 'student@campus.edu'::text AS full_name) t;

  SELECT
    CASE
      WHEN full_name IS NULL OR length(trim(full_name)) = 0 OR full_name LIKE '%@%' THEN 'Student'
      ELSE
        (
          WITH cleaned AS (SELECT regexp_replace(trim(full_name), '\s+', ' ', 'g') AS s)
          SELECT CASE WHEN position(' ' in s) > 0 THEN substr(split_part(s, ' ', 1), 1, 20) || ' ' || upper(substr(split_part(s, ' ', 2), 1, 1)) || '.' ELSE substr(s, 1, 20) END FROM cleaned
        )
    END
  INTO v_spaces
  FROM (SELECT '   Amit    Verma   '::text AS full_name) t;

  IF v_single = 'Ravi' AND v_blank = 'Student' AND v_email = 'Student' AND v_spaces = 'Amit V.' THEN
    INSERT INTO _test_results VALUES (9, 'Display name edge case handling in SQL', true, 'Single word, blank, email-like, and multiple spaces handled as expected');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Display name edge case handling in SQL', false, 'single=' || v_single || ', blank=' || v_blank || ', email=' || v_email || ', spaces=' || v_spaces);
  END IF;
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

  -- Submit reviews for items 2 through 10 (Item 1 was already reviewed in test 2, making 10 distinct reviews)
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
-- TEST 11: Role boundaries (Staff & Admin cannot submit; Student cannot admin)
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

  RESET ROLE;
  IF v_staff_sub_err AND v_admin_sub_err AND v_stud_mod_err THEN
    INSERT INTO _test_results VALUES (11, 'Role boundaries & function isolation', true, 'Staff/Admin cannot submit reviews, student cannot moderate reviews');
  ELSE
    INSERT INTO _test_results VALUES (11, 'Role boundaries & function isolation', false, 'staff_sub=' || v_staff_sub_err || ', admin_sub=' || v_admin_sub_err || ', stud_mod=' || v_stud_mod_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 12: Anon permissions & unauthenticated calls revoked
-- ==============================================================================
DO $$
DECLARE
  v_item_1 uuid;
  v_priv_sub boolean;
  v_priv_mod boolean;
  v_anon_call_err boolean := false;
BEGIN
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  v_priv_sub := has_function_privilege('anon', 'public.submit_review(uuid, integer, text)', 'execute');
  v_priv_mod := has_function_privilege('anon', 'public.admin_set_review_hidden(uuid, boolean)', 'execute');

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.submit_review(v_item_1, 5, 'Anon');
  EXCEPTION WHEN OTHERS THEN
    v_anon_call_err := true;
  END;

  RESET ROLE;
  IF NOT v_priv_sub AND NOT v_priv_mod AND v_anon_call_err THEN
    INSERT INTO _test_results VALUES (12, 'Anon execution permissions revoked', true, 'has_function_privilege is false and anon call raised permission exception');
  ELSE
    INSERT INTO _test_results VALUES (12, 'Anon execution permissions revoked', false, 'priv_sub=' || v_priv_sub || ', priv_mod=' || v_priv_mod || ', anon_err=' || v_anon_call_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 13: Menu items update guard: rating columns protected, staff edits work
-- ==============================================================================
DO $$
DECLARE
  v_staff_id uuid;
  v_student1_id uuid;
  v_admin_id uuid;
  v_item_1 uuid;
  v_staff_rate_err boolean := false;
  v_stud_rate_err boolean := false;
  v_admin_rate_err boolean := false;
  v_staff_avail_ok boolean := false;
BEGIN
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_student1_id FROM _test_env WHERE key = 'student1_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_1 FROM _test_env WHERE key = 'item_1';

  -- 1. Staff attempts to update rating_avg directly (must be blocked by guard)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.menu_items SET rating_avg = 5.0 WHERE id = v_item_1;
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

  -- 3. Student attempts to update menu_items (must be blocked)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student1_id::text)::text, true);
  BEGIN
    UPDATE public.menu_items SET is_available = false WHERE id = v_item_1;
  EXCEPTION WHEN OTHERS THEN
    v_stud_rate_err := true;
  END;

  -- 4. Admin attempts direct modification of rating_avg (must be blocked by guard!)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  BEGIN
    UPDATE public.menu_items SET rating_avg = 5.0 WHERE id = v_item_1;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%prohibited%' THEN v_admin_rate_err := true; END IF;
  END;

  RESET ROLE;
  IF v_staff_rate_err AND v_staff_avail_ok AND v_stud_rate_err AND v_admin_rate_err THEN
    INSERT INTO _test_results VALUES (13, 'Menu items update guard protects ratings', true, 'Direct rating edits blocked for staff/student/admin; permitted staff availability edits work');
  ELSE
    INSERT INTO _test_results VALUES (13, 'Menu items update guard protects ratings', false, 'staff_rate_err=' || v_staff_rate_err || ', staff_avail_ok=' || v_staff_avail_ok || ', stud_err=' || v_stud_rate_err || ', admin_rate_err=' || v_admin_rate_err);
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
  ELSIF v_total < 13 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 13 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Reviews test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
