-- ==============================================================================
-- Migration: 0002_rls.sql
-- Description: Security Definer helper functions, RLS policies, column triggers & GRANTs
-- Campus Canteen Pre-Order & Smart Pickup System
-- ==============================================================================

-- 1. HELPER FUNCTIONS (SECURITY DEFINER, search_path = '')

-- 1.1 Get current user's role from profiles
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
SECURITY DEFINER
SET search_path = ''
STABLE
LANGUAGE plpgsql AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_role;
END;
$$;

-- 1.2 Get current user's assigned canteen_id
CREATE OR REPLACE FUNCTION public.current_user_canteen()
RETURNS uuid
SECURITY DEFINER
SET search_path = ''
STABLE
LANGUAGE plpgsql AS $$
DECLARE
  v_canteen_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT canteen_id INTO v_canteen_id
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_canteen_id;
END;
$$;

-- 1.3 Check if caller is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
SECURITY DEFINER
SET search_path = ''
STABLE
LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.current_user_role() = 'admin'::public.user_role;
END;
$$;

-- 1.4 Check if caller is staff or admin
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
SECURITY DEFINER
SET search_path = ''
STABLE
LANGUAGE plpgsql AS $$
DECLARE
  v_role public.user_role;
BEGIN
  v_role := public.current_user_role();
  RETURN v_role = 'admin'::public.user_role OR v_role = 'staff'::public.user_role;
END;
$$;

-- 1.5 Function Permissions
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.current_user_canteen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_canteen() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, service_role;


-- 2. SECURITY TRIGGERS (Enforce column boundaries at DB level)

-- 2.1 Profile escalation guard:
-- Allow changes when auth.uid() IS NULL (SQL Editor / migrations / service role)
-- Block role, canteen_id, is_active modifications for authenticated non-admins
CREATE OR REPLACE FUNCTION public.prevent_profile_escalation()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  -- Allow direct SQL Editor / service role migrations (auth.uid() IS NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow postgres / service_role / background processes / SECURITY DEFINER functions
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_caller_role := public.current_user_role();

  -- Admin can modify any profile column
  IF v_caller_role = 'admin'::public.user_role THEN
    RETURN NEW;
  END IF;

  -- Authenticated non-admin: block role, canteen_id, is_active changes
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their role';
  END IF;

  IF NEW.canteen_id IS DISTINCT FROM OLD.canteen_id THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their canteen_id';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Non-admin users cannot alter their active status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_escalation();

-- 2.2 Menu item update guard:
-- Non-admins (staff) can ONLY change is_available and stock for their own canteen.
CREATE OR REPLACE FUNCTION public.prevent_menu_item_unauthorized_update()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_canteen uuid;
BEGIN
  -- Allow direct SQL Editor / service role (auth.uid() IS NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow postgres / service_role / background processes / SECURITY DEFINER functions
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_caller_role := public.current_user_role();

  -- Admin can update any menu item column
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
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Staff are only permitted to update is_available and stock';
    END IF;

    RETURN NEW;
  END IF;

  -- Students or other roles cannot update menu items
  RAISE EXCEPTION 'Unauthorized to update menu items';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_menu_item_unauthorized_update ON public.menu_items;
CREATE TRIGGER trg_prevent_menu_item_unauthorized_update
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_menu_item_unauthorized_update();


-- 3. ENABLE ROW LEVEL SECURITY ON ALL TABLES

ALTER TABLE public.canteens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;


-- 4. ROW LEVEL SECURITY POLICIES

-- 4.1 Canteens
-- Readable by all authenticated users; writable by admin only
CREATE POLICY "canteens_select_authenticated"
  ON public.canteens FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "canteens_all_admin"
  ON public.canteens FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.2 Profiles
-- Users read their own profile; staff read profiles of customers ordering from their canteen; admin reads all
CREATE POLICY "profiles_select_self"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR (
      public.current_user_role() = 'staff'::public.user_role
      AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.user_id = profiles.id
        AND o.canteen_id = public.current_user_canteen()
      )
    )
  );

-- Users update their own profile (trigger guards role/canteen_id/is_active)
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 4.3 Categories
-- Readable by all authenticated; managed by admin
CREATE POLICY "categories_select_authenticated"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "categories_all_admin"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.4 Menu Items
-- Readable by all authenticated; admin has full write; staff can update availability/stock for own canteen
CREATE POLICY "menu_items_select_authenticated"
  ON public.menu_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "menu_items_insert_admin"
  ON public.menu_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "menu_items_delete_admin"
  ON public.menu_items FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "menu_items_update_admin"
  ON public.menu_items FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "menu_items_update_staff"
  ON public.menu_items FOR UPDATE
  TO authenticated
  USING (
    public.current_user_role() = 'staff'::public.user_role
    AND canteen_id = public.current_user_canteen()
  )
  WITH CHECK (
    public.current_user_role() = 'staff'::public.user_role
    AND canteen_id = public.current_user_canteen()
  );

-- 4.5 Pickup Slots
-- Readable by all authenticated; managed by admin
CREATE POLICY "pickup_slots_select_authenticated"
  ON public.pickup_slots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pickup_slots_all_admin"
  ON public.pickup_slots FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.6 Orders
-- Students read their own orders; staff read orders for their canteen; admin reads all
-- Direct insert/update/delete blocked for students & staff (performed via server functions in Phase 5)
CREATE POLICY "orders_select_self"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.current_user_role() = 'staff'::public.user_role
      AND canteen_id = public.current_user_canteen()
    )
    OR public.is_admin()
  );

CREATE POLICY "orders_all_admin"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.7 Order Items
-- Students read items for their own orders; staff read items for their canteen's orders; admin reads all
CREATE POLICY "order_items_select_self"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
      AND (
        o.user_id = auth.uid()
        OR (
          public.current_user_role() = 'staff'::public.user_role
          AND o.canteen_id = public.current_user_canteen()
        )
        OR public.is_admin()
      )
    )
  );

CREATE POLICY "order_items_all_admin"
  ON public.order_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4.8 Notifications
-- Users read their own notifications; admin reads all; users update is_read only
CREATE POLICY "notifications_select_self"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "notifications_update_self"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_all_admin"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- 5. EXPLICIT GRANTS & PERMISSIONS

-- 5.1 Schema Usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 5.2 Sequences
GRANT USAGE, SELECT ON SEQUENCE public.order_code_seq TO service_role;

-- 5.3 Service Role (Unrestricted backend access)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- 5.4 Authenticated Role Grants
GRANT SELECT ON public.canteens, public.categories, public.menu_items, public.pickup_slots TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT UPDATE ON public.menu_items TO authenticated;
GRANT SELECT ON public.orders, public.order_items TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- Admin grants for menu/category management through authenticated admin client
GRANT INSERT, DELETE ON public.categories, public.menu_items, public.pickup_slots, public.canteens TO authenticated;
GRANT UPDATE ON public.categories, public.pickup_slots, public.canteens TO authenticated;

-- 5.5 Anon Role Grants (Zero access to any public schema tables or sequences)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
