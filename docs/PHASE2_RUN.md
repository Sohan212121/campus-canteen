# Phase 2: Supabase SQL Execution Guide

This document provides step-by-step instructions for running the database migrations and seed script in the **Supabase Dashboard SQL Editor**, followed by an end-to-end verification checklist and diagnostic test queries.

---

## 1. Execution Order

Run the following three SQL files in order inside the **Supabase Dashboard → SQL Editor** (New Query):

```
Step 1: supabase/migrations/0001_schema.sql  (Tables, enums, sequences, constraints, indexes, triggers, estimate_ready_time)
Step 2: supabase/migrations/0002_rls.sql     (Helper functions, RLS policies, column guards, grants, default privileges)
Step 3: supabase/seed.sql                   (Canteen with operating hours, categories, 24 menu items)
```

---

## 2. Step-by-Step Instructions

### Step 1: Run `0001_schema.sql`
1. Open your project on [database.supabase.com](https://supabase.com/dashboard).
2. Navigate to the **SQL Editor** tab from the left sidebar.
3. Click **"+ New Query"**.
4. Copy the entire contents of [`supabase/migrations/0001_schema.sql`](../supabase/migrations/0001_schema.sql) and paste into the editor.
5. Click **Run** (or press `Cmd/Ctrl + Enter`).
6. Confirm the result returns: `Success. No rows returned`.

### Step 2: Run `0002_rls.sql`
1. Click **"+ New Query"**.
2. Copy the entire contents of [`supabase/migrations/0002_rls.sql`](../supabase/migrations/0002_rls.sql) and paste into the editor.
3. Click **Run**.
4. Confirm the result returns: `Success. No rows returned`.

### Step 3: Run `seed.sql`
1. Click **"+ New Query"**.
2. Copy the entire contents of [`supabase/seed.sql`](../supabase/seed.sql) and paste into the editor.
3. Click **Run**.
4. Confirm output contains: `NOTICE: Seed completed successfully for canteen id: <uuid>`.

> **Note on Idempotency**: `seed.sql` uses `ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name` for canteens and categories, and `DO NOTHING` for menu items. It is completely safe to run multiple times without mutating user data or creating duplicates.

---

## 3. Post-Execution Verification Checklist

Execute the queries below in the SQL Editor to verify the installation.

### 3.1 Verify Table Row Counts & Seed Integrity

```sql
SELECT 
  'canteens' AS table_name, count(*) AS count FROM public.canteens
UNION ALL
SELECT 'categories', count(*) FROM public.categories
UNION ALL
SELECT 'menu_items', count(*) FROM public.menu_items;
```

**Expected Results:**
- `canteens`: 1 ("Main Campus Canteen")
- `categories`: 6
- `menu_items`: 24

---

### 3.2 Verify Canteen Operating Hours & Capacity (IST)

```sql
SELECT 
  name,
  kitchen_capacity,
  min_lead_minutes,
  hold_minutes,
  opens_at,
  closes_at,
  last_order_time
FROM public.canteens;
```

**Expected Result:**
- `kitchen_capacity`: 3
- `min_lead_minutes`: 5
- `hold_minutes`: 15
- `opens_at`: `08:00:00`
- `closes_at`: `17:00:00`
- `last_order_time`: `16:30:00`

---

### 3.3 Verify RLS is Enabled on All 7 Tables

```sql
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'canteens', 'profiles', 'categories', 'menu_items',
    'orders', 'order_items', 'notifications'
  )
ORDER BY tablename;
```

**Expected Result:** `rls_enabled` must be `true` for all 7 tables.

---

### 3.4 Test `estimate_ready_time` Function

Run a test estimation query using an item from the seed (e.g. Masala Dosa):

```sql
DO $$
DECLARE
  v_canteen_id uuid;
  v_item_id uuid;
  v_result record;
BEGIN
  SELECT id INTO v_canteen_id FROM public.canteens LIMIT 1;
  SELECT id INTO v_item_id FROM public.menu_items WHERE canteen_id = v_canteen_id LIMIT 1;

  SELECT * INTO v_result 
  FROM public.estimate_ready_time(
    v_canteen_id,
    jsonb_build_array(
      jsonb_build_object('menu_item_id', v_item_id, 'quantity', 2)
    ),
    NULL -- ASAP mode
  );

  RAISE NOTICE 'ASAP Estimation -> Estimated Ready: %, Window End: %, Total Prep Mins: %',
    v_result.estimated_ready_at, v_result.pickup_window_end, v_result.prep_minutes_total;
END;
$$;
```

---

## 4. Security & Role Assignment Tests

### 4.1 Promoting a User to Staff or Admin (Manual Operation)
Since `current_user` in the Supabase Dashboard SQL Editor runs as `postgres` (which is not in `('authenticated', 'anon')`), the protective triggers will not block manual administrative promotions:

```sql
-- Promote a user to Admin:
UPDATE public.profiles
SET role = 'admin'
WHERE id = '<USER_UUID>';

-- Assign a user to Staff for the Main Campus Canteen:
UPDATE public.profiles
SET 
  role = 'staff',
  canteen_id = (SELECT id FROM public.canteens WHERE name = 'Main Campus Canteen' LIMIT 1)
WHERE id = '<USER_UUID>';
```

---

## 5. Troubleshooting & Rollback

If you ever need to reset the schema during development:

```sql
-- Complete reset (drops all public canteen tables, functions, and types)
DROP FUNCTION IF EXISTS public.estimate_ready_time(uuid, jsonb, timestamptz);
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.canteens CASCADE;

DROP TYPE IF EXISTS public.payment_status CASCADE;
DROP TYPE IF EXISTS public.payment_method CASCADE;
DROP TYPE IF EXISTS public.order_status CASCADE;
DROP TYPE IF EXISTS public.user_role CASCADE;

DROP SEQUENCE IF EXISTS public.order_code_seq CASCADE;
```
Then re-run steps 1, 2, and 3.
