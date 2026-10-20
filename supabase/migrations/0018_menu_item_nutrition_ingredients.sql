-- ==============================================================================
-- Migration: 0018_menu_item_nutrition_ingredients.sql
-- Description: Adds calories_kcal and ingredients to public.menu_items
--              and updates prevent_menu_item_unauthorized_update to restrict
--              staff from altering nutrition and ingredient columns.
-- ==============================================================================

BEGIN;

-- 1. Helper function for ingredients validation
CREATE OR REPLACE FUNCTION public.validate_menu_item_ingredients(p_ingredients text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT
    p_ingredients IS NOT NULL
    AND cardinality(p_ingredients) <= 30
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_ingredients) AS item
      WHERE item IS NULL
         OR length(btrim(item)) < 1
         OR length(item) > 60
    );
$$;

REVOKE ALL ON FUNCTION public.validate_menu_item_ingredients(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_menu_item_ingredients(text[]) TO authenticated, service_role;

-- 2. Add columns to public.menu_items
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS calories_kcal integer NULL,
  ADD COLUMN IF NOT EXISTS ingredients text[] NOT NULL DEFAULT '{}'::text[];

-- 3. Check constraints
ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_calories,
  ADD CONSTRAINT chk_menu_items_calories
    CHECK (calories_kcal IS NULL OR (calories_kcal >= 0 AND calories_kcal <= 5000));

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS chk_menu_items_ingredients,
  ADD CONSTRAINT chk_menu_items_ingredients
    CHECK (public.validate_menu_item_ingredients(ingredients));

-- 4. Replace prevent_menu_item_unauthorized_update with staff restrictions for calories and ingredients
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
