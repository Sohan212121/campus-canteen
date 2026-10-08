# Phase 5: Database Migration & Verification Guide

This document provides instructions for applying the Phase 5 database migration [`supabase/migrations/0003_place_order.sql`](../supabase/migrations/0003_place_order.sql) in the **Supabase Dashboard SQL Editor**, followed by running the manual test suite [`docs/PHASE5_TESTS.sql`](./PHASE5_TESTS.sql).

---

## 1. Migration Overview

Phase 5 introduces:
1. **Error-Code Prefixing on `estimate_ready_time`**: Updates existing function with standard machine-readable prefixes (`ORDERS_CLOSED`, `CANTEEN_CLOSED`, `SCHEDULE_TOO_EARLY`, `INVALID_SCHEDULE`, `ITEM_UNAVAILABLE`).
2. **Atomic Transactional `public.place_order`**:
   - `SECURITY DEFINER`, restricted to `authenticated` role (`auth.uid()`).
   - Idempotency deduplication check at start and re-check after acquiring canteen lock.
   - Per-user cap of max 3 active orders (`TOO_MANY_ACTIVE_ORDERS`).
   - Deadlock-free `menu_items` row locking (`FOR UPDATE ORDER BY id ASC`).
   - Dynamic pickup readiness estimation via `estimate_ready_time`.
   - Inventory deduction and order/order_items insertion in a sub-block with `unique_violation` fallback.
   - Generation of 6-digit numeric pickup token.
   - Automated notification creation.

---

## 2. Step-by-Step Migration Steps

### Step 1: Review Migration File
Open and review [`supabase/migrations/0003_place_order.sql`](../supabase/migrations/0003_place_order.sql).

### Step 2: Apply in Supabase Dashboard
1. Open your Supabase project dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **"+ New Query"**.
4. Paste the entire content of [`supabase/migrations/0003_place_order.sql`](../supabase/migrations/0003_place_order.sql).
5. Click **Run**.
6. Verify output confirms: `Success. No rows returned`.
7. **Important**: Migration 0003 includes `NOTIFY pgrst, 'reload schema';` at the bottom. If PostgREST does not immediately recognize `place_order`, run this quick statement in the SQL Editor:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```


---

## 3. Running the Verification Test Suite

[`docs/PHASE5_TESTS.sql`](./PHASE5_TESTS.sql) is wrapped in `BEGIN ... ROLLBACK` so none of the test orders or stock changes persist to your database.

1. Open [`docs/PHASE5_TESTS.sql`](./PHASE5_TESTS.sql).
2. Set the `c_test_user_id` constant at line 18 with the UUID of any existing active user in your `public.profiles` table:
   ```sql
   c_test_user_id CONSTANT uuid := 'your-active-user-uuid-here';
   ```
3. Copy the script, paste it into the Supabase SQL Editor, and click **Run**.
4. Review the "Notices" tab to verify all 7 tests pass:
   - `PASS [Test 1]: Normal ASAP order placed successfully`
   - `PASS [Test 2]: Idempotent re-submission returned same order with was_duplicate=true`
   - `PASS [Test 3]: Stock decremented properly`
   - `PASS [Test 4]: Out-of-stock order correctly rejected with INSUFFICIENT_STOCK`
   - `PASS [Test 5]: Early scheduled order rejected with SCHEDULE_TOO_EARLY`
   - `PASS [Test 6]: Queue workload pushed readiness back`
   - `PASS [Test 7]: 4th order correctly rejected with TOO_MANY_ACTIVE_ORDERS`
