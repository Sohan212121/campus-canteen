-- ==============================================================================
-- Migration: 0001_schema.sql
-- Description: Core schema, enums, sequences, tables, constraints, indexes & triggers
-- Campus Canteen Pre-Order & Smart Pickup System
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS
CREATE TYPE public.user_role AS ENUM (
  'student',
  'staff',
  'admin'
);

CREATE TYPE public.order_status AS ENUM (
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'COLLECTED',
  'CANCELLED',
  'REJECTED'
);

CREATE TYPE public.payment_method AS ENUM (
  'PAY_AT_PICKUP',
  'ONLINE',
  'WALLET'
);

CREATE TYPE public.payment_status AS ENUM (
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED'
);

-- 3. SEQUENCES
CREATE SEQUENCE IF NOT EXISTS public.order_code_seq START WITH 10001;

-- 4. TABLES

-- 4.1 Canteens
CREATE TABLE public.canteens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_canteens_name UNIQUE (name)
);

-- 4.2 Profiles (Linked 1:1 with auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  college_id text,
  role public.user_role NOT NULL DEFAULT 'student',
  canteen_id uuid REFERENCES public.canteens(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4.3 Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_categories_canteen_name UNIQUE (canteen_id, name)
);

-- 4.4 Menu Items (Money in paise, e.g. 5000 = ₹50.00)
CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  image_url text,
  is_veg boolean NOT NULL DEFAULT true,
  is_available boolean NOT NULL DEFAULT true,
  stock integer CHECK (stock IS NULL OR stock >= 0),
  prep_minutes integer NOT NULL DEFAULT 5 CHECK (prep_minutes >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_menu_items_canteen_name UNIQUE (canteen_id, name)
);

-- 4.5 Pickup Slots (Times in Asia/Kolkata IST)
CREATE TABLE public.pickup_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE CASCADE,
  slot_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  max_orders integer NOT NULL CHECK (max_orders > 0),
  cutoff_minutes integer NOT NULL DEFAULT 15 CHECK (cutoff_minutes >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_slot_time CHECK (end_time > start_time),
  CONSTRAINT uq_pickup_slots UNIQUE (canteen_id, slot_date, start_time, end_time)
);

-- 4.6 Orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE DEFAULT ('CN' || nextval('public.order_code_seq')::text),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES public.pickup_slots(id) ON DELETE RESTRICT,
  status public.order_status NOT NULL DEFAULT 'PLACED',
  payment_method public.payment_method NOT NULL DEFAULT 'PAY_AT_PICKUP',
  payment_status public.payment_status NOT NULL DEFAULT 'PENDING',
  total_paise integer NOT NULL CHECK (total_paise >= 0),
  pickup_token text NOT NULL UNIQUE,
  idempotency_key text,
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  CONSTRAINT uq_orders_user_idempotency UNIQUE (user_id, idempotency_key)
);

-- 4.7 Order Items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  name_snapshot text NOT NULL,
  unit_price_paise integer NOT NULL CHECK (unit_price_paise >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.8 Notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. PERFORMANCE INDEXES
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_canteen_id ON public.profiles(canteen_id);
CREATE INDEX idx_categories_canteen_id ON public.categories(canteen_id);
CREATE INDEX idx_menu_items_canteen_id ON public.menu_items(canteen_id);
CREATE INDEX idx_menu_items_category_id ON public.menu_items(category_id);
CREATE INDEX idx_menu_items_availability ON public.menu_items(canteen_id, is_active, is_available);
CREATE INDEX idx_pickup_slots_lookup ON public.pickup_slots(canteen_id, slot_date, is_active);
CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_orders_canteen_status ON public.orders(canteen_id, status);
CREATE INDEX idx_orders_slot_id ON public.orders(slot_id);
CREATE INDEX idx_orders_pickup_token ON public.orders(pickup_token);
CREATE INDEX idx_orders_placed_at ON public.orders(placed_at DESC);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id, is_read, created_at DESC);

-- 6. TRIGGERS

-- 6.1 Generic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_menu_items_updated_at ON public.menu_items;
CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6.2 New User Profile Creation Trigger (Strict student role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(NEW.raw_user_meta_data->>'college_id', NULL),
    'student'::public.user_role,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
