# Phase 7: Database Migration & Verification Guide

This document provides instructions for applying the Phase 7 database migration [`supabase/migrations/0005_staff_operations.sql`](../supabase/migrations/0005_staff_operations.sql) in the **Supabase Dashboard SQL Editor**, followed by running the manual test suite [`docs/PHASE7_TESTS.sql`](./PHASE7_TESTS.sql).

---

## 1. Migration Overview

Phase 7 introduces:
1. **Pickup Verification Ledger (`public.pickup_verify_attempts`)**:
   - Stores failed pickup token lookups for brute-force mitigation.
   - Protected by RLS with zero user-facing policies; accessible strictly by service_role and internal `SECURITY DEFINER` routines.
2. **Order Lifecycle Transition (`public.transition_order`)**:
   - `SECURITY DEFINER`, strictly derived from `auth.uid()`.
   - Enforces role (`staff` or `admin`) and canteen boundaries (`IS DISTINCT FROM`).
   - Allowed state transitions:
     - `PLACED` $\rightarrow$ `ACCEPTED` or `REJECTED`
     - `ACCEPTED` $\rightarrow$ `PREPARING`
     - `PREPARING` $\rightarrow$ `READY`
     - `READY` $\rightarrow$ `COLLECTED`
   - Same-status calls return `was_noop = true` (idempotent; safe against double-taps).
   - On `COLLECTED`: If `payment_method = 'PAY_AT_PICKUP'`, automatically marks `payment_status = 'PAID'`.
   - On `REJECTED`: Restores inventory stock using ordered locks on `menu_items`.
   - Student notifications are generated automatically by existing trigger `trg_order_status_notification`.
3. **Pickup Token Verification (`public.verify_pickup`)**:
   - Matches orders currently in status `READY` matching the 6-digit `pickup_token`.
   - Returns order details, customer name, total amount, and line items without changing status.
   - Rate limited: $\ge 10$ failed attempts within 5 minutes raises `RATE_LIMITED`.
   - On a miss, records the attempt into `pickup_verify_attempts` and returns `{ "found": false }`.
4. **Item Availability Management (`public.set_item_availability`)**:
   - Allows staff of that item's canteen or admins to toggle `is_available`.

---

## 2. Step-by-Step Migration Steps

### Step 1: Review Migration File
Open and review [`supabase/migrations/0005_staff_operations.sql`](../supabase/migrations/0005_staff_operations.sql).

### Step 2: Apply in Supabase Dashboard
1. Open your Supabase project dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **"+ New Query"**.
4. Paste the entire content of [`supabase/migrations/0005_staff_operations.sql`](../supabase/migrations/0005_staff_operations.sql).
5. Click **Run**.
6. Verify output confirms: `Success. No rows returned`.

---

## 3. Running the Verification Test Suite

[`docs/PHASE7_TESTS.sql`](./PHASE7_TESTS.sql) is wrapped in `BEGIN ... ROLLBACK` so none of the temporary canteens, test orders, or stock modifications persist to your database.

1. Open [`docs/PHASE7_TESTS.sql`](./PHASE7_TESTS.sql).
2. Copy the entire script, paste it into the Supabase SQL Editor, and click **Run**.
3. Review the "Notices" tab to verify all 8 test cases pass:
   - `PASS [Test 1]: Valid sequential transition chain`
   - `PASS [Test 2]: Invalid transition jump rejected`
   - `PASS [Test 3]: Student caller rejected with FORBIDDEN`
   - `PASS [Test 4]: Cross-canteen staff rejected with FORBIDDEN`
   - `PASS [Test 5]: Double tap is a no-op`
   - `PASS [Test 6]: Reject on PLACED order restores inventory stock`
   - `PASS [Test 7]: verify_pickup matches READY orders only`
   - `PASS [Test 8]: Rate limit triggers on 11th failed attempt`
