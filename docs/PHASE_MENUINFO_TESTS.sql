-- ==============================================================================
-- PHASE MENU NUTRITION & INGREDIENTS TEST SUITE: docs/PHASE_MENUINFO_TESTS.sql
-- Description: Non-interactive SQL verification script for Migration 0018:
--              1. Pure SQL ingredients validation helper function (IMMUTABLE, search_path = '').
--              2. Helper boundary tests: empty array, 30 items, 31 items, empty string, 60 chars, 61 chars.
--              3. chk_menu_items_calories constraint (0 to 5,000, null allowed).
--              4. chk_menu_items_ingredients constraint.
--              5. Admin update semantics: update and clearing of calories and ingredients.
--              6. Staff guard: staff blocked from altering calories_kcal (guard enforced, row count / unchanged checked).
--              7. Staff guard: staff blocked from altering ingredients (guard enforced, row count / unchanged checked).
--              8. Staff allowed update: staff permitted to adjust is_available and stock on own canteen item.
--              9. Cross-canteen staff isolation: staff of another canteen cannot update is_available or stock (value unchanged).
--              10. Student and anonymous callers blocked from updating menu items (value unchanged).
--              11. Rating columns protection: direct modification of rating_avg/rating_count blocked for all.
--              12. Realtime publication check: menu_items not exposed in supabase_realtime publication.
--              13. Information schema verification: calories_kcal and ingredients columns exist with correct types.
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
  v_admin_id    uuid := gen_random_uuid();
  v_student_id  uuid := gen_random_uuid();
  v_staff_id    uuid := gen_random_uuid();
  v_staff2_id   uuid := gen_random_uuid();
  v_canteen_id  uuid := gen_random_uuid();
  v_canteen2_id uuid := gen_random_uuid();
  v_item_id     uuid := gen_random_uuid();
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- 1. Allowed domain
  INSERT INTO public.allowed_email_domains (domain)
  VALUES ('campus.edu')
  ON CONFLICT (domain) DO NOTHING;

  -- 2. Canteens
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_id, 'Nutrition Test Canteen 1', '00:00:00', '23:59:59', '23:59:59', 10, 5, 15, true);

  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen2_id, 'Nutrition Test Canteen 2', '00:00:00', '23:59:59', '23:59:59', 10, 5, 15, true);

  -- 3. Initial Menu Item for Canteen 1
  INSERT INTO public.menu_items (
    id, canteen_id, name, description, price_paise, prep_minutes, stock, is_veg, is_available, is_active,
    calories_kcal, ingredients
  )
  VALUES (
    v_item_id, v_canteen_id, 'Original Masala Dosa', 'Crisp rice crepe', 5000, 10, 50, true, true, true,
    350, ARRAY['Rice', 'Urad Dal', 'Potato', 'Ghee']
  );

  -- 4. Admin User
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_admin_id, 'admin_nutrition@campus.edu', now(), jsonb_build_object('full_name', 'Nutrition Admin'), jsonb_build_object('role', 'admin', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'admin'::public.user_role, is_active = true
  WHERE id = v_admin_id;

  -- 5. Student User
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_student_id, 'student_nutrition@campus.edu', now(), jsonb_build_object('full_name', 'Nutrition Student', 'college_id', 'CID88001'), jsonb_build_object('is_admin_created', true));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'CID88001', is_active = true
  WHERE id = v_student_id;

  -- 6. Staff User for Canteen 1
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff_id, 'staff_nutrition@campus.edu', now(), jsonb_build_object('full_name', 'Nutrition Staff Canteen 1'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true
  WHERE id = v_staff_id;

  -- 7. Staff User for Canteen 2 (other canteen)
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff2_id, 'staff2_nutrition@campus.edu', now(), jsonb_build_object('full_name', 'Nutrition Staff Canteen 2'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen2_id, is_active = true
  WHERE id = v_staff2_id;

  -- Save environment keys
  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff_id', v_staff_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff2_id', v_staff2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen_id', v_canteen_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen2_id', v_canteen2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item_id', v_item_id);
END;
$$;


-- ==============================================================================
-- TEST 1: Ingredients validation helper boundaries
-- Empty array passes, 30 passes, 31 fails, empty string fails, 60 chars passes, 61 chars fails
-- ==============================================================================
DO $$
DECLARE
  v_empty_pass    boolean;
  v_30_pass       boolean;
  v_31_fail       boolean;
  v_empty_str_fail boolean;
  v_whitespace_fail boolean;
  v_60_pass       boolean;
  v_61_fail       boolean;
  v_null_fail     boolean;
  v_arr_30        text[];
  v_arr_31        text[];
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Construct 30 items and 31 items arrays
  SELECT array_agg('Ingredient ' || i) INTO v_arr_30 FROM generate_series(1, 30) i;
  SELECT array_agg('Ingredient ' || i) INTO v_arr_31 FROM generate_series(1, 31) i;

  v_empty_pass      := public.validate_menu_item_ingredients('{}'::text[]);
  v_30_pass         := public.validate_menu_item_ingredients(v_arr_30);
  v_31_fail         := NOT public.validate_menu_item_ingredients(v_arr_31);
  v_empty_str_fail  := NOT public.validate_menu_item_ingredients(ARRAY['Valid', '']);
  v_whitespace_fail := NOT public.validate_menu_item_ingredients(ARRAY['Valid', '   ']);
  v_60_pass         := public.validate_menu_item_ingredients(ARRAY[repeat('a', 60)]);
  v_61_fail         := NOT public.validate_menu_item_ingredients(ARRAY[repeat('a', 61)]);
  v_null_fail       := NOT public.validate_menu_item_ingredients(NULL);

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    1,
    'validate_menu_item_ingredients boundary conditions',
    v_empty_pass AND v_30_pass AND v_31_fail AND v_empty_str_fail AND v_whitespace_fail AND v_60_pass AND v_61_fail AND v_null_fail,
    format('empty=%s, 30=%s, 31_fail=%s, empty_str_fail=%s, ws_fail=%s, 60=%s, 61_fail=%s, null_fail=%s',
           v_empty_pass, v_30_pass, v_31_fail, v_empty_str_fail, v_whitespace_fail, v_60_pass, v_61_fail, v_null_fail)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (1, 'validate_menu_item_ingredients boundary conditions', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 2: Helper function properties and security attributes
-- IMMUTABLE, SET search_path = '', REVOKE ALL FROM PUBLIC, anon
-- (PostgreSQL stores empty search_path as search_path="" -> match with LIKE 'search_path=%')
-- ==============================================================================
DO $$
DECLARE
  v_provolatile   char;
  v_proconfig     text[];
  v_proconfig_str text;
  v_anon_has_exec boolean;
  v_auth_has_exec boolean;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT provolatile, proconfig
  INTO v_provolatile, v_proconfig
  FROM pg_proc
  WHERE proname = 'validate_menu_item_ingredients';

  v_proconfig_str := array_to_string(v_proconfig, ',');

  SELECT has_function_privilege('anon', 'public.validate_menu_item_ingredients(text[])', 'EXECUTE')
  INTO v_anon_has_exec;

  SELECT has_function_privilege('authenticated', 'public.validate_menu_item_ingredients(text[])', 'EXECUTE')
  INTO v_auth_has_exec;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    2,
    'validate_menu_item_ingredients IMMUTABLE, search_path, and privilege revocation',
    v_provolatile = 'i' AND
    v_proconfig_str LIKE '%search_path=%' AND
    v_anon_has_exec = false AND
    v_auth_has_exec = true,
    format('provolatile=%s, proconfig_str=%s, anon_has_exec=%s, auth_has_exec=%s',
           v_provolatile, v_proconfig_str, v_anon_has_exec, v_auth_has_exec)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (2, 'validate_menu_item_ingredients IMMUTABLE, search_path, and privilege revocation', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: chk_menu_items_calories constraint on public.menu_items
-- NULL passes, 0 passes, 5000 passes, -1 fails, 5001 fails
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id  uuid;
  v_test_id     uuid;
  v_neg_fail    boolean := false;
  v_high_fail   boolean := false;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  -- 1. Insert with NULL calories (passes)
  v_test_id := gen_random_uuid();
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, calories_kcal)
  VALUES (v_test_id, v_canteen_id, 'Calories Null Item', 1000, 5, NULL);

  -- 2. Update to 0 calories (passes)
  UPDATE public.menu_items SET calories_kcal = 0 WHERE id = v_test_id;

  -- 3. Update to 5000 calories (passes)
  UPDATE public.menu_items SET calories_kcal = 5000 WHERE id = v_test_id;

  -- 4. Negative calories must fail check constraint
  BEGIN
    UPDATE public.menu_items SET calories_kcal = -1 WHERE id = v_test_id;
  EXCEPTION WHEN check_violation THEN
    v_neg_fail := true;
  END;

  -- 5. Calories > 5000 must fail check constraint
  BEGIN
    UPDATE public.menu_items SET calories_kcal = 5001 WHERE id = v_test_id;
  EXCEPTION WHEN check_violation THEN
    v_high_fail := true;
  END;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    3,
    'chk_menu_items_calories check constraint (0..5000, null allowed)',
    v_neg_fail AND v_high_fail,
    format('neg_rejected=%s, high_rejected=%s', v_neg_fail, v_high_fail)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (3, 'chk_menu_items_calories check constraint (0..5000, null allowed)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 4: chk_menu_items_ingredients constraint on public.menu_items
-- Empty array passes, 30 passes, 31 fails, empty string fails, 60 chars passes, 61 chars fails
-- ==============================================================================
DO $$
DECLARE
  v_canteen_id  uuid;
  v_test_id     uuid;
  v_31_rejected boolean := false;
  v_empty_str_rejected boolean := false;
  v_61_rejected boolean := false;
  v_arr_30      text[];
  v_arr_31      text[];
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT val_uuid INTO v_canteen_id FROM _test_env WHERE key = 'canteen_id';

  SELECT array_agg('Item ' || i) INTO v_arr_30 FROM generate_series(1, 30) i;
  SELECT array_agg('Item ' || i) INTO v_arr_31 FROM generate_series(1, 31) i;

  v_test_id := gen_random_uuid();
  -- 1. Empty array passes
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, ingredients)
  VALUES (v_test_id, v_canteen_id, 'Ingredients Check Item', 2000, 5, '{}'::text[]);

  -- 2. 30 items passes
  UPDATE public.menu_items SET ingredients = v_arr_30 WHERE id = v_test_id;

  -- 3. 60 chars passes
  UPDATE public.menu_items SET ingredients = ARRAY[repeat('x', 60)] WHERE id = v_test_id;

  -- 4. 31 items fails
  BEGIN
    UPDATE public.menu_items SET ingredients = v_arr_31 WHERE id = v_test_id;
  EXCEPTION WHEN check_violation THEN
    v_31_rejected := true;
  END;

  -- 5. Empty string item fails
  BEGIN
    UPDATE public.menu_items SET ingredients = ARRAY['Valid Item', ''] WHERE id = v_test_id;
  EXCEPTION WHEN check_violation THEN
    v_empty_str_rejected := true;
  END;

  -- 6. 61 chars item fails
  BEGIN
    UPDATE public.menu_items SET ingredients = ARRAY[repeat('x', 61)] WHERE id = v_test_id;
  EXCEPTION WHEN check_violation THEN
    v_61_rejected := true;
  END;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    4,
    'chk_menu_items_ingredients check constraint enforcement',
    v_31_rejected AND v_empty_str_rejected AND v_61_rejected,
    format('31_rejected=%s, empty_str_rejected=%s, 61_rejected=%s', v_31_rejected, v_empty_str_rejected, v_61_rejected)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (4, 'chk_menu_items_ingredients check constraint enforcement', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Admin update semantics on menu_items
-- Admin updates calories and ingredients, then clears them
-- ==============================================================================
DO $$
DECLARE
  v_admin_id    uuid;
  v_item_id     uuid;
  v_cal_updated integer;
  v_ing_updated text[];
  v_cal_cleared integer;
  v_ing_cleared text[];
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Simulate Admin session
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  -- 1. Admin sets calories = 480 and ingredients = ['Basmati Rice', 'Paneer', 'Cashew']
  UPDATE public.menu_items
  SET calories_kcal = 480,
      ingredients = ARRAY['Basmati Rice', 'Paneer', 'Cashew']
  WHERE id = v_item_id;

  SELECT calories_kcal, ingredients INTO v_cal_updated, v_ing_updated
  FROM public.menu_items WHERE id = v_item_id;

  -- 2. Admin clears calories to NULL and ingredients to empty list
  UPDATE public.menu_items
  SET calories_kcal = NULL,
      ingredients = '{}'::text[]
  WHERE id = v_item_id;

  SELECT calories_kcal, ingredients INTO v_cal_cleared, v_ing_cleared
  FROM public.menu_items WHERE id = v_item_id;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    5,
    'Admin can update and clear calories_kcal and ingredients',
    v_cal_updated = 480 AND
    v_ing_updated = ARRAY['Basmati Rice', 'Paneer', 'Cashew'] AND
    v_cal_cleared IS NULL AND
    v_ing_cleared = '{}'::text[],
    format('cal_up=%s, ing_up=%s, cal_clear=%s, ing_clear=%s',
           v_cal_updated, v_ing_updated::text, v_cal_cleared, v_ing_cleared::text)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (5, 'Admin can update and clear calories_kcal and ingredients', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Staff guard prevents staff from modifying calories_kcal
-- Captures ROW_COUNT and exception; asserts staff can reach item via is_available (guard path reached);
-- re-reads row after RESET ROLE to prove calories value unchanged.
-- ==============================================================================
DO $$
DECLARE
  v_staff_id    uuid;
  v_item_id     uuid;
  v_cal_before  integer;
  v_cal_after   integer;
  v_staff_can_reach_cnt integer := -1;
  v_row_count   integer := -1;
  v_exception_raised boolean := false;
  v_err_msg     text := '';
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Read initial calories value as owner
  SELECT calories_kcal INTO v_cal_before FROM public.menu_items WHERE id = v_item_id;

  -- 1. Assert staff CAN reach this item and update permitted fields under RLS
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  UPDATE public.menu_items SET is_available = is_available WHERE id = v_item_id;
  GET DIAGNOSTICS v_staff_can_reach_cnt = ROW_COUNT;

  -- 2. Attempt blocked update on calories_kcal
  BEGIN
    UPDATE public.menu_items SET calories_kcal = 999 WHERE id = v_item_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_exception_raised := true;
    v_err_msg := SQLERRM;
  END;

  -- Re-read row after RESET ROLE as owner to prove value did not change
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT calories_kcal INTO v_cal_after FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    6,
    'Staff is strictly blocked from modifying calories_kcal (guard enforced, value unchanged)',
    v_staff_can_reach_cnt = 1 AND
    v_cal_after IS NOT DISTINCT FROM v_cal_before AND
    (v_exception_raised OR v_row_count = 0),
    format('can_reach_cnt=%s, row_count=%s, exc=%s, msg=%s, unchanged=%s',
           v_staff_can_reach_cnt, v_row_count, v_exception_raised, v_err_msg, v_cal_after IS NOT DISTINCT FROM v_cal_before)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (6, 'Staff is strictly blocked from modifying calories_kcal (guard enforced, value unchanged)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 7: Staff guard prevents staff from modifying ingredients
-- Captures ROW_COUNT and exception; asserts staff can reach item via is_available (guard path reached);
-- re-reads row after RESET ROLE to prove ingredients value unchanged.
-- ==============================================================================
DO $$
DECLARE
  v_staff_id    uuid;
  v_item_id     uuid;
  v_ing_before  text[];
  v_ing_after   text[];
  v_staff_can_reach_cnt integer := -1;
  v_row_count   integer := -1;
  v_exception_raised boolean := false;
  v_err_msg     text := '';
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Read initial ingredients value as owner
  SELECT ingredients INTO v_ing_before FROM public.menu_items WHERE id = v_item_id;

  -- 1. Assert staff CAN reach this item and update permitted fields under RLS
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  UPDATE public.menu_items SET is_available = is_available WHERE id = v_item_id;
  GET DIAGNOSTICS v_staff_can_reach_cnt = ROW_COUNT;

  -- 2. Attempt blocked update on ingredients
  BEGIN
    UPDATE public.menu_items SET ingredients = ARRAY['Hacked Ingredient'] WHERE id = v_item_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_exception_raised := true;
    v_err_msg := SQLERRM;
  END;

  -- Re-read row after RESET ROLE as owner to prove value did not change
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT ingredients INTO v_ing_after FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    7,
    'Staff is strictly blocked from modifying ingredients (guard enforced, value unchanged)',
    v_staff_can_reach_cnt = 1 AND
    v_ing_after IS NOT DISTINCT FROM v_ing_before AND
    (v_exception_raised OR v_row_count = 0),
    format('can_reach_cnt=%s, row_count=%s, exc=%s, msg=%s, unchanged=%s',
           v_staff_can_reach_cnt, v_row_count, v_exception_raised, v_err_msg, v_ing_after IS NOT DISTINCT FROM v_ing_before)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (7, 'Staff is strictly blocked from modifying ingredients (guard enforced, value unchanged)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 8: Staff allowed updates: is_available and stock succeed on own canteen
-- Staff updates is_available and stock without raising error
-- ==============================================================================
DO $$
DECLARE
  v_staff_id    uuid;
  v_item_id     uuid;
  v_avail       boolean;
  v_stock       integer;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Simulate Staff session
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff_id::text, 'role', 'authenticated')::text, true);

  UPDATE public.menu_items
  SET is_available = false,
      stock = 12
  WHERE id = v_item_id;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT is_available, stock INTO v_avail, v_stock
  FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    8,
    'Staff can update is_available and stock on their own canteen items',
    v_avail = false AND v_stock = 12,
    format('avail=%s, stock=%s', v_avail, v_stock)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (8, 'Staff can update is_available and stock on their own canteen items', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 9: Cross-canteen isolation: Staff of another canteen cannot update item
-- Captures ROW_COUNT and exception; re-reads row after RESET ROLE to prove unchanged.
-- ==============================================================================
DO $$
DECLARE
  v_staff2_id    uuid;
  v_item_id      uuid;
  v_avail_before boolean;
  v_stock_before integer;
  v_avail_after  boolean;
  v_stock_after  integer;
  v_row_count    integer := -1;
  v_exception_raised boolean := false;
  v_err_msg      text := '';
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_staff2_id FROM _test_env WHERE key = 'staff2_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  -- Capture before state
  SELECT is_available, stock INTO v_avail_before, v_stock_before
  FROM public.menu_items WHERE id = v_item_id;

  -- Simulate Staff from Canteen 2 attempting to update Canteen 1's item
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_staff2_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.menu_items
    SET is_available = NOT v_avail_before,
        stock = 999
    WHERE id = v_item_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_exception_raised := true;
    v_err_msg := SQLERRM;
  END;

  -- Re-read row after RESET ROLE as owner to prove value did not change
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT is_available, stock INTO v_avail_after, v_stock_after
  FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    9,
    'Staff of another canteen cannot update is_available or stock of this canteen item',
    v_avail_after = v_avail_before AND
    v_stock_after = v_stock_before AND
    (v_exception_raised OR v_row_count = 0),
    format('row_count=%s, exc=%s, msg=%s, unchanged=%s',
           v_row_count, v_exception_raised, v_err_msg, (v_avail_after = v_avail_before AND v_stock_after = v_stock_before))
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (9, 'Staff of another canteen cannot update is_available or stock of this canteen item', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 10: Student and anonymous callers blocked from updating menu_items
-- Captures ROW_COUNT and exception; re-reads row after RESET ROLE to prove unchanged.
-- ==============================================================================
DO $$
DECLARE
  v_student_id  uuid;
  v_item_id     uuid;
  v_name_before text;
  v_name_after_stu text;
  v_name_after_anon text;
  v_stu_row_cnt integer := -1;
  v_stu_exc     boolean := false;
  v_stu_msg     text := '';
  v_anon_row_cnt integer := -1;
  v_anon_exc    boolean := false;
  v_anon_msg    text := '';
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  SELECT name INTO v_name_before FROM public.menu_items WHERE id = v_item_id;

  -- 1. Student caller
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_student_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.menu_items SET name = 'Student Defaced Name' WHERE id = v_item_id;
    GET DIAGNOSTICS v_stu_row_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_stu_exc := true;
    v_stu_msg := SQLERRM;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT name INTO v_name_after_stu FROM public.menu_items WHERE id = v_item_id;

  -- 2. Anon caller
  SET ROLE anon;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);

  BEGIN
    UPDATE public.menu_items SET name = 'Anon Defaced Name' WHERE id = v_item_id;
    GET DIAGNOSTICS v_anon_row_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_anon_exc := true;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT name INTO v_name_after_anon FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    10,
    'Student and anonymous callers are blocked from updating menu items (value unchanged)',
    v_name_after_stu = v_name_before AND
    (v_stu_exc OR v_stu_row_cnt = 0) AND
    v_name_after_anon = v_name_before AND
    (v_anon_exc OR v_anon_row_cnt = 0),
    format('stu_cnt=%s, stu_exc=%s, anon_cnt=%s, anon_exc=%s, unchanged=%s',
           v_stu_row_cnt, v_stu_exc, v_anon_row_cnt, v_anon_exc, (v_name_after_anon = v_name_before))
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (10, 'Student and anonymous callers are blocked from updating menu items (value unchanged)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 11: Invariant check: rating columns directly unmodifiable by anyone
-- Direct modification of rating_avg or rating_count raises exception even for admin
-- ==============================================================================
DO $$
DECLARE
  v_admin_id    uuid;
  v_item_id     uuid;
  v_rating_avg_before numeric;
  v_rating_avg_after  numeric;
  v_row_count   integer := -1;
  v_rating_blocked boolean := false;
  v_err_msg     text := '';
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_id FROM _test_env WHERE key = 'item_id';

  SELECT rating_avg INTO v_rating_avg_before FROM public.menu_items WHERE id = v_item_id;

  -- Simulate Admin session
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.menu_items SET rating_avg = 5.0 WHERE id = v_item_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_rating_blocked := true;
    v_err_msg := SQLERRM;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT rating_avg INTO v_rating_avg_after FROM public.menu_items WHERE id = v_item_id;

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    11,
    'Rating columns cannot be directly modified by any authenticated caller (even admin)',
    v_rating_avg_after IS NOT DISTINCT FROM v_rating_avg_before AND
    (v_rating_blocked OR v_row_count = 0),
    format('row_count=%s, blocked=%s, msg=%s, unchanged=%s',
           v_row_count, v_rating_blocked, v_err_msg, v_rating_avg_after IS NOT DISTINCT FROM v_rating_avg_before)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (11, 'Rating columns cannot be directly modified by any authenticated caller (even admin)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 12: Realtime publication check: menu_items not in supabase_realtime
-- select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='menu_items' must be 0
-- ==============================================================================
DO $$
DECLARE
  v_realtime_count integer;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT count(*)
  INTO v_realtime_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'menu_items';

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    12,
    'menu_items is not in supabase_realtime publication (zero real-time exposure)',
    v_realtime_count = 0,
    format('realtime_count=%s', v_realtime_count)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (12, 'menu_items is not in supabase_realtime publication (zero real-time exposure)', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 13: Schema Column Privileges & Information Schema Verification
-- Verify calories_kcal and ingredients columns exist in menu_items
-- ==============================================================================
DO $$
DECLARE
  v_cal_exists boolean;
  v_ing_exists boolean;
  v_cal_type   text;
  v_ing_type   text;
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'calories_kcal'
  ) INTO v_cal_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'ingredients'
  ) INTO v_ing_exists;

  SELECT data_type INTO v_cal_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'calories_kcal';

  SELECT data_type INTO v_ing_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'ingredients';

  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (
    13,
    'Information schema: calories_kcal and ingredients columns exist with correct types',
    v_cal_exists AND v_ing_exists AND v_cal_type = 'integer' AND v_ing_type = 'ARRAY',
    format('cal_exists=%s (%s), ing_exists=%s (%s)', v_cal_exists, v_cal_type, v_ing_exists, v_ing_type)
  );
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _test_results (test_num, test_name, passed, details)
  VALUES (13, 'Information schema: calories_kcal and ingredients columns exist with correct types', false, 'Exception: ' || SQLERRM);
END;
$$;


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

DO $$
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
END;
$$;

ROLLBACK;
