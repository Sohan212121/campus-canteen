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

-- 4.1 Canteens (With operating hours, kitchen capacity, lead and hold settings in IST)
CREATE TABLE public.canteens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  kitchen_capacity integer NOT NULL DEFAULT 3 CHECK (kitchen_capacity > 0),
  min_lead_minutes integer NOT NULL DEFAULT 5 CHECK (min_lead_minutes >= 0),
  hold_minutes integer NOT NULL DEFAULT 15 CHECK (hold_minutes >= 0),
  opens_at time NOT NULL DEFAULT '08:00:00',
  closes_at time NOT NULL DEFAULT '17:00:00',
  last_order_time time NOT NULL DEFAULT '16:30:00',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_canteens_name UNIQUE (name),
  CONSTRAINT chk_canteen_hours CHECK (closes_at > opens_at),
  CONSTRAINT chk_canteen_last_order CHECK (last_order_time <= closes_at AND last_order_time >= opens_at)
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

-- 4.5 Orders (Dynamic Pickup Design: ASAP or Scheduled, tracking queue load and lead times)
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE DEFAULT ('CN' || nextval('public.order_code_seq')::text),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  canteen_id uuid NOT NULL REFERENCES public.canteens(id) ON DELETE RESTRICT,
  status public.order_status NOT NULL DEFAULT 'PLACED',
  payment_method public.payment_method NOT NULL DEFAULT 'PAY_AT_PICKUP',
  payment_status public.payment_status NOT NULL DEFAULT 'PENDING',
  total_paise integer NOT NULL CHECK (total_paise >= 0),
  pickup_token text NOT NULL UNIQUE,
  idempotency_key text,
  requested_pickup_at timestamptz,
  estimated_ready_at timestamptz NOT NULL,
  pickup_window_end timestamptz NOT NULL,
  prep_minutes_total integer NOT NULL CHECK (prep_minutes_total >= 0),
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  CONSTRAINT uq_orders_user_idempotency UNIQUE (user_id, idempotency_key)
);

-- 4.6 Order Items
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  name_snapshot text NOT NULL,
  unit_price_paise integer NOT NULL CHECK (unit_price_paise >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.7 Notifications
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
CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_orders_canteen_status ON public.orders(canteen_id, status);
CREATE INDEX idx_orders_canteen_status_ready ON public.orders(canteen_id, status, estimated_ready_at);
CREATE INDEX idx_orders_placed_at ON public.orders(placed_at DESC);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id, is_read, created_at DESC);

-- 6. TRIGGERS

-- 6.1 Generic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
SET search_path = ''
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

-- 7. DYNAMIC PICKUP ESTIMATION FUNCTION
CREATE OR REPLACE FUNCTION public.estimate_ready_time(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": int}
  p_requested_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  estimated_ready_at timestamptz,
  pickup_window_end timestamptz,
  prep_minutes_total integer
)
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_canteen record;
  v_now_ist timestamptz;
  v_today_ist date;
  v_current_time_ist time;
  v_req_ist timestamptz;
  v_req_time_ist time;
  v_order_prep integer := 0;
  v_max_prep integer := 0;
  v_total_units integer := 0;
  v_candidate_ready_initial timestamptz;
  v_cutoff_time timestamptz;
  v_queued_load integer := 0;
  v_wait_minutes integer := 0;
  v_earliest_ready timestamptz;
  v_final_ready timestamptz;
  v_final_window_end timestamptz;
  v_ready_time_ist time;
  v_item record;
  v_menu_item record;
  v_item_id uuid;
  v_qty integer;
BEGIN
  -- 1. Fetch and validate canteen
  SELECT 
    id, opens_at, closes_at, last_order_time, 
    kitchen_capacity, min_lead_minutes, hold_minutes, is_active
  INTO v_canteen
  FROM public.canteens
  WHERE id = p_canteen_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canteen % not found', p_canteen_id;
  END IF;

  IF NOT v_canteen.is_active THEN
    RAISE EXCEPTION 'Canteen is currently inactive';
  END IF;

  -- Time in Asia/Kolkata
  v_now_ist := clock_timestamp() AT TIME ZONE 'Asia/Kolkata';
  v_today_ist := v_now_ist::date;
  v_current_time_ist := v_now_ist::time;

  -- Validate current operating hours
  IF v_current_time_ist > v_canteen.last_order_time THEN
    RAISE EXCEPTION 'Orders are closed for today. Last order time was % IST', v_canteen.last_order_time;
  END IF;

  IF v_current_time_ist < v_canteen.opens_at THEN
    RAISE EXCEPTION 'Canteen is not open yet. Operating hours: % to % IST', v_canteen.opens_at, v_canteen.closes_at;
  END IF;

  -- 2. Validate items array and compute order_prep from active, available menu items
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order items payload cannot be empty';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item.value->>'menu_item_id')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item %', v_qty, v_item_id;
    END IF;

    SELECT prep_minutes, is_available, is_active
    INTO v_menu_item
    FROM public.menu_items
    WHERE id = v_item_id AND canteen_id = p_canteen_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu item % does not exist in this canteen', v_item_id;
    END IF;

    IF NOT v_menu_item.is_active OR NOT v_menu_item.is_available THEN
      RAISE EXCEPTION 'Menu item % is currently unavailable', v_item_id;
    END IF;

    IF v_menu_item.prep_minutes > v_max_prep THEN
      v_max_prep := v_menu_item.prep_minutes;
    END IF;

    v_total_units := v_total_units + v_qty;
  END LOOP;

  -- order_prep = max(prep_minutes) + 1 minute per extra unit
  v_order_prep := v_max_prep + GREATEST(v_total_units - 1, 0);

  -- 3. Calculate candidate_ready_initial and cutoff time for queued load
  v_candidate_ready_initial := clock_timestamp() + (v_canteen.min_lead_minutes * interval '1 minute') + (v_order_prep * interval '1 minute');

  IF p_requested_at IS NOT NULL THEN
    v_cutoff_time := p_requested_at;
  ELSE
    v_cutoff_time := v_candidate_ready_initial;
  END IF;

  -- 4. Calculate queued_load of active orders in this canteen up to cutoff_time
  SELECT COALESCE(SUM(prep_minutes_total), 0)
  INTO v_queued_load
  FROM public.orders
  WHERE canteen_id = p_canteen_id
    AND status IN ('PLACED'::public.order_status, 'ACCEPTED'::public.order_status, 'PREPARING'::public.order_status)
    AND estimated_ready_at <= v_cutoff_time;

  -- Wait from queue
  v_wait_minutes := ceil(v_queued_load::numeric / v_canteen.kitchen_capacity)::integer;

  -- Earliest possible ready time = now + min_lead + wait + order_prep
  v_earliest_ready := clock_timestamp() + (v_canteen.min_lead_minutes * interval '1 minute') + (v_wait_minutes * interval '1 minute') + (v_order_prep * interval '1 minute');

  -- 5. Determine final ready time based on mode
  IF p_requested_at IS NULL THEN
    -- ASAP Mode: ready is earliest achievable
    v_final_ready := v_earliest_ready;
  ELSE
    -- Scheduled Mode: requested_pickup_at is desired ready time
    v_req_ist := p_requested_at AT TIME ZONE 'Asia/Kolkata';

    -- Must be on the same IST day
    IF v_req_ist::date <> v_today_ist THEN
      RAISE EXCEPTION 'Scheduled pickup time must be on the same day (%)', v_today_ist;
    END IF;

    v_req_time_ist := v_req_ist::time;
    IF v_req_time_ist < v_canteen.opens_at OR v_req_time_ist > v_canteen.closes_at THEN
      RAISE EXCEPTION 'Scheduled pickup time % IST is outside canteen operating hours (% to % IST)',
        v_req_time_ist, v_canteen.opens_at, v_canteen.closes_at;
    END IF;

    IF p_requested_at >= v_earliest_ready THEN
      v_final_ready := p_requested_at;
    ELSE
      RAISE EXCEPTION 'Requested pickup time % is earlier than earliest achievable time %',
        to_char(p_requested_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS'),
        to_char(v_earliest_ready AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS')
        USING HINT = to_char(v_earliest_ready AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SSOF');
    END IF;
  END IF;

  -- Validate ready time does not exceed closing time
  v_ready_time_ist := (v_final_ready AT TIME ZONE 'Asia/Kolkata')::time;
  IF v_ready_time_ist > v_canteen.closes_at THEN
    RAISE EXCEPTION 'Ready time % IST exceeds canteen closing time % IST',
      v_ready_time_ist, v_canteen.closes_at;
  END IF;

  v_final_window_end := v_final_ready + (v_canteen.hold_minutes * interval '1 minute');

  RETURN QUERY SELECT v_final_ready, v_final_window_end, v_order_prep;
END;
$$;
