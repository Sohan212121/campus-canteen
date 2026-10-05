# Phase 2: Supabase SQL Execution Guide

This document provides step-by-step instructions for running the database migrations and seed script in the **Supabase Dashboard SQL Editor**, followed by an end-to-end verification checklist and diagnostic test queries.

---

## 1. Execution Order

Run the following three SQL files in order inside the **Supabase Dashboard → SQL Editor** (New Query):

```
Step 1: supabase/migrations/0001_schema.sql  (Tables, enums, sequences, constraints, indexes, triggers)
Step 2: supabase/migrations/0002_rls.sql     (Helper functions, RLS policies, column guards, grants)
Step 3: supabase/seed.sql                   (Canteen, categories, 24 menu items, 7-day pickup slots)
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

> **Note on Idempotency**: `seed.sql` uses `ON CONFLICT DO NOTHING` / `DO UPDATE`. It is completely safe to run multiple times.

---

## 3. Post-Execution Verification Checklist

Execute the queries below in the SQL Editor to verify the installation.

### 3.1 Verify Table Row Counts & Seed Integrity
Run this query to check all seeded entities:

```sql
SELECT 
  'canteens' AS table_name, count(*) AS count FROM public.canteens
UNION ALL
SELECT 'categories', count(*) FROM public.categories
UNION ALL
SELECT 'menu_items', count(*) FROM public.menu_items
UNION ALL
SELECT 'pickup_slots', count(*) FROM public.pickup_slots;
```

**Expected Results:**
- `canteens`: 1 ("Main Campus Canteen")
- `categories`: 6
- `menu_items`: 24
- `pickup_slots`: 28 (4 slots/day × 7 days)

---

### 3.2 Verify RLS is Enabled on All 8 Tables

```sql
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'canteens', 'profiles', 'categories', 'menu_items',
    'pickup_slots', 'orders', 'order_items', 'notifications'
  )
ORDER BY tablename;
```

**Expected Result:** `rls_enabled` must be `true` for all 8 tables.

---

### 3.3 Verify Pickup Slot Dates and IST Timezone

```sql
SELECT 
  slot_date, 
  start_time, 
  end_time, 
  max_orders, 
  cutoff_minutes
FROM public.pickup_slots
ORDER BY slot_date, start_time
LIMIT 8;
```

**Expected Result:**
- Slots should span from today (`CURRENT_DATE` in Asia/Kolkata) for 7 consecutive days.
- Times: `10:30:00 - 10:45:00`, `10:45:00 - 11:00:00`, `13:00:00 - 13:15:00`, `13:15:00 - 13:30:00`.
- All `max_orders = 30` and `cutoff_minutes = 15`.

---

### 3.4 Verify Menu Items and Pricing (in Paise)

```sql
SELECT 
  m.name AS item_name,
  c.name AS category_name,
  m.price_paise,
  (m.price_paise / 100.0) AS price_inr,
  m.is_veg,
  m.prep_minutes
FROM public.menu_items m
JOIN public.categories c ON c.id = m.category_id
ORDER BY c.display_order, m.price_paise
LIMIT 10;
```

**Expected Result:** Shows realistic Indian campus items formatted with prices in paise (e.g. ₹15 Chai = 1500, ₹50 Masala Dosa = 5000).

---

## 4. Security & Constraint Tests

### 4.1 Test Profile Creation on New Auth User
Simulate auth user creation (or register a user through Supabase Auth):
- The `handle_new_user` trigger automatically populates `public.profiles` with `role = 'student'`.

### 4.2 Promoting a User to Staff or Admin (Manual Operation)
Since `auth.uid() IS NULL` when executing SQL in the Dashboard SQL Editor, you can manually promote any user without triggering escalation barriers:

```sql
-- Replace with actual user ID from auth.users or profiles
UPDATE public.profiles
SET role = 'admin'
WHERE id = '<USER_UUID>';

-- Or assign staff to the main canteen:
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
-- Complete reset (drops all public canteen tables and types)
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.pickup_slots CASCADE;
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
