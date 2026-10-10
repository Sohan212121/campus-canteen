# Phase 6: Database Migration & Verification Guide

This document provides instructions for applying the Phase 6 database migration [`supabase/migrations/0004_order_tracking.sql`](../supabase/migrations/0004_order_tracking.sql) in the **Supabase Dashboard SQL Editor**, followed by running the manual test suite [`docs/PHASE6_TESTS.sql`](./PHASE6_TESTS.sql).

---

## 1. Migration Overview

Phase 6 introduces:
1. **Realtime Publication Configuration**: Adds `public.orders` and `public.notifications` to the `supabase_realtime` publication, guarded by `IF NOT EXISTS` on `pg_publication_tables`.
   - *Security Note*: Supabase Realtime respects PostgreSQL RLS. Students receive live updates strictly for their own `user_id`.
2. **Order Cancellation Procedure (`public.cancel_order`)**:
   - `SECURITY DEFINER`, restricted to `authenticated` and `service_role`.
   - Caller strictly derived from `auth.uid()`.
   - Acquires `FOR UPDATE` lock on the target order row.
   - Enforces ownership (`NOT_FOUND`), idempotency (`was_already_cancelled = true`), and status policy (`NOT_CANCELLABLE` if status is not `PLACED`).
   - Deadlock-free inventory restoration (locks `menu_items` in ascending ID order before restoring stock).
   - Generates in-app cancellation notification.
   - Excluded automatically from queue workload in `estimate_ready_time`.
3. **Status Change Trigger (`trg_order_status_notification`)**:
   - Dispatches in-app notifications on `AFTER UPDATE OF status` for `ACCEPTED`, `PREPARING`, `READY`, and `REJECTED` per PRD Section 13 copy.

---

## 2. Step-by-Step Migration Steps

### Step 1: Review Migration File
Review [`supabase/migrations/0004_order_tracking.sql`](../supabase/migrations/0004_order_tracking.sql).

### Step 2: Apply in Supabase Dashboard
1. Open your Supabase project dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **"+ New Query"**.
4. Paste the entire content of [`supabase/migrations/0004_order_tracking.sql`](../supabase/migrations/0004_order_tracking.sql).
5. Click **Run**.
6. Verify output confirms: `Success. No rows returned`.

---

## 3. Running the Verification Test Suite

[`docs/PHASE6_TESTS.sql`](./PHASE6_TESTS.sql) is wrapped in `BEGIN ... ROLLBACK` so none of the test records or stock modifications persist to your database.

1. Open [`docs/PHASE6_TESTS.sql`](./PHASE6_TESTS.sql).
2. Copy the entire file, paste it into the Supabase SQL Editor, and click **Run**.
3. Review the "Notices" tab to verify all 5 test cases pass:
   - `PASS [Test 1]: Cancel PLACED order + stock restored`
   - `PASS [Test 2]: Double cancel idempotent`
   - `PASS [Test 3]: Cancel PREPARING rejected with NOT_CANCELLABLE`
   - `PASS [Test 4]: Other user order NOT_FOUND`
   - `PASS [Test 5]: READY trigger notification`
