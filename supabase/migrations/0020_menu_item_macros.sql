-- ==============================================================================
-- Migration: 0020_menu_item_macros.sql
-- Description: Adds macronutrient columns (protein, fat, carbs, fibre, sugar, sat_fat)
--              and key_minerals to public.menu_items. Updates
--              prevent_menu_item_unauthorized_update to restrict staff from altering
--              the new macro columns while preserving admin and rating safeguards.
-- ==============================================================================

BEGIN;

-- 1. Helper function for key minerals validation (max 8 items, 1-40 chars each)
CREATE OR REPLACE FUNCTION public.validate_menu_item_minerals(p_minerals text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT
    p_minerals IS NOT NULL
    AND cardinality(p_minerals) <= 8
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_minerals) AS item
      WHERE item IS NULL
         OR length(btrim(item)) < 1
         OR length(item) > 40
    );
$$;

REVOKE ALL ON FUNCTION public.validate_menu_item_minerals(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_menu_item_minerals(text[]) TO authenticated, service_role;

-- 2. Add macronutrient and mineral columns to public.menu_items
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS protein_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS fat_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS carbs_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS fibre_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS sugar_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS sat_fat_g numeric(5,1) NULL,
  ADD COLUMN IF NOT EXISTS key_minerals text[] NOT NULL DEFAULT '{}'::text[];

-- 3. Individual column check constraints (0 to 500)
ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_protein,
  ADD CONSTRAINT chk_menu_items_protein
    CHECK (protein_g IS NULL OR (protein_g >= 0 AND protein_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_fat,
  ADD CONSTRAINT chk_menu_items_fat
    CHECK (fat_g IS NULL OR (fat_g >= 0 AND fat_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_carbs,
  ADD CONSTRAINT chk_menu_items_carbs
    CHECK (carbs_g IS NULL OR (carbs_g >= 0 AND carbs_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_fibre,
  ADD CONSTRAINT chk_menu_items_fibre
    CHECK (fibre_g IS NULL OR (fibre_g >= 0 AND fibre_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_sugar,
  ADD CONSTRAINT chk_menu_items_sugar
    CHECK (sugar_g IS NULL OR (sugar_g >= 0 AND sugar_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_sat_fat,
  ADD CONSTRAINT chk_menu_items_sat_fat
    CHECK (sat_fat_g IS NULL OR (sat_fat_g >= 0 AND sat_fat_g <= 500));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_minerals,
  ADD CONSTRAINT chk_menu_items_minerals
    CHECK (public.validate_menu_item_minerals(key_minerals));

-- 4. Table-level soft macro sanity bound (protein*4 + carbs*4 + fat*9 between 0 and 7500)
ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_macro_sanity,
  ADD CONSTRAINT chk_menu_items_macro_sanity
    CHECK (
      protein_g IS NULL OR fat_g IS NULL OR carbs_g IS NULL OR (
        (protein_g * 4 + carbs_g * 4 + fat_g * 9 >= 0) AND
        (protein_g * 4 + carbs_g * 4 + fat_g * 9 <= 7500)
      )
    );

-- 5. Replace prevent_menu_item_unauthorized_update with staff restrictions on macro columns
CREATE OR REPLACE FUNCTION public.prevent_menu_item_unauthorized_update()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_canteen uuid;
BEGIN
  -- Allow postgres / service_role / background processes / SECURITY DEFINER trigger functions
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- CRITICAL SECURITY INVARIANT:
  -- Block ANY authenticated caller (student, staff, or admin) from directly writing rating columns.
  -- rating_avg and rating_count are strictly maintained by public.handle_review_rating_sync.
  IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg OR
     NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'Direct modification of rating columns is prohibited';
  END IF;

  v_caller_role := public.current_user_role();

  -- Admin can update any other menu item column
  IF v_caller_role = 'admin'::public.user_role THEN
    RETURN NEW;
  END IF;

  -- Staff can ONLY update is_available and stock of their own canteen
  IF v_caller_role = 'staff'::public.user_role THEN
    v_caller_canteen := public.current_user_canteen();

    IF OLD.canteen_id IS DISTINCT FROM v_caller_canteen THEN
      RAISE EXCEPTION 'Staff cannot update menu items for another canteen';
    END IF;

    -- Block any modification to fields other than is_available and stock
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.canteen_id IS DISTINCT FROM OLD.canteen_id OR
       NEW.category_id IS DISTINCT FROM OLD.category_id OR
       NEW.name IS DISTINCT FROM OLD.name OR
       NEW.description IS DISTINCT FROM OLD.description OR
       NEW.price_paise IS DISTINCT FROM OLD.price_paise OR
       NEW.image_url IS DISTINCT FROM OLD.image_url OR
       NEW.is_veg IS DISTINCT FROM OLD.is_veg OR
       NEW.prep_minutes IS DISTINCT FROM OLD.prep_minutes OR
       NEW.is_active IS DISTINCT FROM OLD.is_active OR
       NEW.calories_kcal IS DISTINCT FROM OLD.calories_kcal OR
       NEW.ingredients IS DISTINCT FROM OLD.ingredients OR
       NEW.protein_g IS DISTINCT FROM OLD.protein_g OR
       NEW.fat_g IS DISTINCT FROM OLD.fat_g OR
       NEW.carbs_g IS DISTINCT FROM OLD.carbs_g OR
       NEW.fibre_g IS DISTINCT FROM OLD.fibre_g OR
       NEW.sugar_g IS DISTINCT FROM OLD.sugar_g OR
       NEW.sat_fat_g IS DISTINCT FROM OLD.sat_fat_g OR
       NEW.key_minerals IS DISTINCT FROM OLD.key_minerals OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Staff are only permitted to update is_available and stock';
    END IF;

    RETURN NEW;
  END IF;

  -- Students or other roles cannot update menu items
  RAISE EXCEPTION 'Unauthorized to update menu items';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_menu_item_unauthorized_update() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
