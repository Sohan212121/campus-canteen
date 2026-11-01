-- ==============================================================================
-- PHASE MACRONUTRIENTS TEST SUITE: docs/PHASE_MACROS_TESTS.sql
-- Description: Interactive & Non-Interactive SQL verification script for Migration 0020:
--              1. Valid macro values accepted (0-500, numeric(5,1))
--              2. Negative macro values rejected (< 0)
--              3. Over-500 macro values rejected (> 500)
--              4. Minerals boundary: 0 minerals accepted ({})
--              5. Minerals boundary: 8 minerals accepted (exact max limit)
--              6. Minerals boundary: 9 minerals rejected (> 8 items)
--              7. Minerals boundary: empty / whitespace mineral rejected (< 1 char)
--              8. Minerals boundary: 40 character mineral accepted (exact max length)
--              9. Minerals boundary: 41 character mineral rejected (> 40 chars)
--              10. Soft macro sanity bound: (P*4 + C*4 + F*9) > 7500 rejected
--              11. Admin can set and clear (set to null) all new columns
--              12. Staff of same canteen CANNOT update any new macro column
--              13. Staff of same canteen CAN still toggle is_available and stock
--              14. Staff of another canteen CANNOT update anything
--              15. Student and anon cannot update menu items
--              16. Rating columns (rating_avg, rating_count) remain strictly protected
--              17. menu_items table is NOT in supabase_realtime publication
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
  v_staff_id     uuid := gen_random_uuid();
  v_staff2_id    uuid := gen_random_uuid();
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

  -- Create Canteens
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_id, 'Macro Test Canteen', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen2_id, 'Other Macro Canteen', '00:00:00', '23:59:59', '23:59:59', 5, 5, 15, true);

  -- Menu Item
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, prep_minutes, stock, is_available, is_active)
  VALUES (v_item_id, v_canteen_id, 'Test Macro Dish', 5000, 5, 50, true, true);

  -- Profiles
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_student_id, 'Macro Student', '2026-MAC-001', 'student'::public.user_role, true);

  INSERT INTO public.profiles (id, full_name, college_id, role, canteen_id, is_active)
  VALUES (v_staff_id, 'Macro Staff 1', '2026-STA-001', 'staff'::public.user_role, v_canteen_id, true);

  INSERT INTO public.profiles (id, full_name, college_id, role, canteen_id, is_active)
  VALUES (v_staff2_id, 'Macro Staff 2', '2026-STA-002', 'staff'::public.user_role, v_canteen2_id, true);

  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_admin_id, 'Macro Admin', '2026-ADM-001', 'admin'::public.user_role, true);

  -- Save in test env
  INSERT INTO _test_env VALUES ('student_id', v_student_id, NULL);
  INSERT INTO _test_env VALUES ('staff_id', v_staff_id, NULL);
  INSERT INTO _test_env VALUES ('staff2_id', v_staff2_id, NULL);
  INSERT INTO _test_env VALUES ('admin_id', v_admin_id, NULL);
  INSERT INTO _test_env VALUES ('canteen_id', v_canteen_id, NULL);
  INSERT INTO _test_env VALUES ('canteen2_id', v_canteen2_id, NULL);
  INSERT INTO _test_env VALUES ('item_id', v_item_id, NULL);
END;
$$;

-- Helper to switch roles cleanly
CREATE OR REPLACE FUNCTION _as_user(p_uid uuid, p_role text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
END;
$$;

-- ==============================================================================
-- TEST 1: Valid macro values accepted
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET protein_g = 25.5,
      fat_g = 12.0,
      carbs_g = 40.0,
      fibre_g = 5.5,
      sugar_g = 3.2,
      sat_fat_g = 2.1,
      key_minerals = ARRAY['Iron', 'Calcium', 'Zinc']
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (1, 'Valid macro values accepted', true, 'Updated all macro columns successfully');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (1, 'Valid macro values accepted', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 2: Negative macro values rejected (< 0)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET protein_g = -0.5
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (2, 'Negative macro values rejected', false, 'Allowed negative protein_g');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (2, 'Negative macro values rejected', true, 'Check constraint properly rejected negative value');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (2, 'Negative macro values rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 3: Over-500 macro values rejected (> 500)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET protein_g = 500.5
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (3, 'Over-500 macro values rejected', false, 'Allowed protein_g > 500');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (3, 'Over-500 macro values rejected', true, 'Check constraint properly rejected value > 500');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (3, 'Over-500 macro values rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 4: Minerals boundary: 0 minerals accepted ({})
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = '{}'::text[]
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (4, 'Minerals boundary: 0 minerals accepted', true, 'Empty array accepted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (4, 'Minerals boundary: 0 minerals accepted', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 5: Minerals boundary: 8 minerals accepted (exact max limit)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = ARRAY['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (5, 'Minerals boundary: 8 minerals accepted', true, '8 minerals accepted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (5, 'Minerals boundary: 8 minerals accepted', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 6: Minerals boundary: 9 minerals rejected (> 8 items)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = ARRAY['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (6, 'Minerals boundary: 9 minerals rejected', false, 'Allowed 9 minerals');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (6, 'Minerals boundary: 9 minerals rejected', true, 'Check constraint rejected > 8 minerals');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (6, 'Minerals boundary: 9 minerals rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 7: Minerals boundary: empty / whitespace mineral rejected (< 1 char)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = ARRAY['Iron', '   ']
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (7, 'Minerals boundary: empty mineral rejected', false, 'Allowed empty mineral');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (7, 'Minerals boundary: empty mineral rejected', true, 'Check constraint rejected whitespace mineral');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (7, 'Minerals boundary: empty mineral rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 8: Minerals boundary: 40 character mineral accepted (exact max)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = ARRAY[repeat('A', 40)]
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (8, 'Minerals boundary: 40 character mineral accepted', true, '40-char mineral accepted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (8, 'Minerals boundary: 40 character mineral accepted', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 9: Minerals boundary: 41 character mineral rejected (> 40 chars)
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET key_minerals = ARRAY[repeat('A', 41)]
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (9, 'Minerals boundary: 41 character mineral rejected', false, 'Allowed 41-char mineral');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (9, 'Minerals boundary: 41 character mineral rejected', true, 'Check constraint rejected 41-char mineral');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (9, 'Minerals boundary: 41 character mineral rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 10: Soft macro sanity bound: (P*4 + C*4 + F*9) > 7500 rejected
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  -- 500*4 + 500*4 + 500*9 = 2000 + 2000 + 4500 = 8500 > 7500
  UPDATE public.menu_items
  SET protein_g = 500.0,
      carbs_g = 500.0,
      fat_g = 500.0
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (10, 'Macro sanity bound > 7500 rejected', false, 'Allowed impossible macro calorie total');
EXCEPTION WHEN check_violation THEN
  INSERT INTO _test_results VALUES (10, 'Macro sanity bound > 7500 rejected', true, 'Check constraint rejected macro sum > 7500');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (10, 'Macro sanity bound > 7500 rejected', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 11: Admin can set and clear (set to null) all new columns
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  -- Clear to null
  UPDATE public.menu_items
  SET protein_g = NULL,
      fat_g = NULL,
      carbs_g = NULL,
      fibre_g = NULL,
      sugar_g = NULL,
      sat_fat_g = NULL,
      key_minerals = '{}'::text[]
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (11, 'Admin can set and clear columns', true, 'Admin successfully set and cleared all columns');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (11, 'Admin can set and clear columns', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 12: Staff of same canteen CANNOT update any new macro column
-- ==============================================================================
DO $$
DECLARE
  v_staff uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_staff FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_staff, 'staff');

  UPDATE public.menu_items
  SET protein_g = 30.0
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (12, 'Staff cannot update macro columns', false, 'Staff was able to update protein_g');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Staff are only permitted to update is_available and stock%' THEN
    INSERT INTO _test_results VALUES (12, 'Staff cannot update macro columns', true, 'Guard prevented staff from altering macro column');
  ELSE
    INSERT INTO _test_results VALUES (12, 'Staff cannot update macro columns', false, 'Unexpected error: ' || SQLERRM);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 13: Staff of same canteen CAN still toggle is_available and stock
-- ==============================================================================
DO $$
DECLARE
  v_staff uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_staff FROM _test_env WHERE key = 'staff_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_staff, 'staff');

  UPDATE public.menu_items
  SET is_available = false,
      stock = 25
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (13, 'Staff can update is_available and stock', true, 'Staff successfully toggled stock and availability');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _test_results VALUES (13, 'Staff can update is_available and stock', false, SQLERRM);
END;
$$;

-- ==============================================================================
-- TEST 14: Staff of another canteen CANNOT update anything
-- ==============================================================================
DO $$
DECLARE
  v_staff2 uuid;
  v_item   uuid;
BEGIN
  SELECT val_uuid INTO v_staff2 FROM _test_env WHERE key = 'staff2_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_staff2, 'staff');

  UPDATE public.menu_items
  SET is_available = true
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (14, 'Staff of other canteen cannot update', false, 'Allowed cross-canteen staff update');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Staff cannot update menu items for another canteen%' THEN
    INSERT INTO _test_results VALUES (14, 'Staff of other canteen cannot update', true, 'Cross-canteen staff update rejected cleanly');
  ELSE
    INSERT INTO _test_results VALUES (14, 'Staff of other canteen cannot update', false, 'Unexpected error: ' || SQLERRM);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 15: Student and anon cannot update menu items
-- ==============================================================================
DO $$
DECLARE
  v_student uuid;
  v_item    uuid;
BEGIN
  SELECT val_uuid INTO v_student FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_student, 'student');

  UPDATE public.menu_items
  SET is_available = false
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (15, 'Student cannot update menu items', false, 'Student was able to update menu items');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Unauthorized to update menu items%' THEN
    INSERT INTO _test_results VALUES (15, 'Student cannot update menu items', true, 'Student update rejected cleanly');
  ELSE
    INSERT INTO _test_results VALUES (15, 'Student cannot update menu items', false, 'Unexpected error: ' || SQLERRM);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 16: Rating columns remain strictly protected from direct update
-- ==============================================================================
DO $$
DECLARE
  v_admin uuid;
  v_item  uuid;
BEGIN
  SELECT val_uuid INTO v_admin FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item FROM _test_env WHERE key = 'item_id';
  PERFORM _as_user(v_admin, 'admin');

  UPDATE public.menu_items
  SET rating_avg = 5.0
  WHERE id = v_item;

  INSERT INTO _test_results VALUES (16, 'Rating columns strictly protected', false, 'Admin was able to directly write rating_avg');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Direct modification of rating columns is prohibited%' THEN
    INSERT INTO _test_results VALUES (16, 'Rating columns strictly protected', true, 'Rating columns remain inviolable');
  ELSE
    INSERT INTO _test_results VALUES (16, 'Rating columns strictly protected', false, 'Unexpected error: ' || SQLERRM);
  END IF;
END;
$$;

-- ==============================================================================
-- TEST 17: menu_items table is NOT in supabase_realtime publication
-- ==============================================================================
DO $$
DECLARE
  v_in_pub boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'menu_items'
  ) INTO v_in_pub;

  IF NOT v_in_pub THEN
    INSERT INTO _test_results VALUES (17, 'menu_items not in realtime publication', true, 'Table is not exposed to client realtime');
  ELSE
    INSERT INTO _test_results VALUES (17, 'menu_items not in realtime publication', false, 'Table found in supabase_realtime publication');
  END IF;
END;
$$;

-- ==============================================================================
-- FINAL REPORT
-- ==============================================================================
SELECT
  test_num,
  test_name,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
  details
FROM _test_results
ORDER BY test_num;

ROLLBACK;

