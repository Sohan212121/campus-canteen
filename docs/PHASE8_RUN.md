# Phase 8 Manual Verification Runbook

## Scope: Administrative Panel & Platform Analytics

This runbook guides execution of the Phase 8 migration and test suite in the Supabase SQL Editor.

---

### Step 1: Run Migration `0006_admin_operations.sql`

1. Open your Supabase Dashboard $\rightarrow$ **SQL Editor**.
2. Copy the full content of [`supabase/migrations/0006_admin_operations.sql`](file:///f:/campus-canteen/campus-canteen/supabase/migrations/0006_admin_operations.sql).
3. Paste into the editor and click **Run**.
4. Confirm success:
   - Table `public.admin_audit_log` created with RLS enabled.
   - Procedures `admin_set_user_role`, `admin_set_user_active`, `admin_update_canteen_settings`, `admin_dashboard_stats`, `admin_list_orders`, and `admin_list_users` created.
   - Storage bucket `menu-images` configured with RLS policies.
   - Schema cache reloaded via `NOTIFY pgrst`.

---

### Step 2: Run Verification Test Suite `docs/PHASE8_TESTS.sql`

1. In Supabase **SQL Editor**, open a new query tab.
2. Copy the full content of [`docs/PHASE8_TESTS.sql`](file:///f:/campus-canteen/campus-canteen/docs/PHASE8_TESTS.sql).
3. Click **Run**.
4. Switch to the **Messages** / **Notices** tab.
5. All 8 test cases run within a transaction and are automatically rolled back (`BEGIN ... ROLLBACK`):
   - **Test 1**: Non-admin rejected on all 6 routines with `FORBIDDEN`.
   - **Test 2**: Admin cannot change own role (`CANNOT_MODIFY_SELF`).
   - **Test 3**: Admin cannot deactivate self (`CANNOT_MODIFY_SELF`).
   - **Test 4**: Last admin protected against demotion and deactivation (`LAST_ADMIN`).
   - **Test 5**: Staff requires valid canteen; student resets canteen to NULL.
   - **Test 6**: Canteen settings validation rejects invalid hours and ranges (`INVALID_INPUT`).
   - **Test 7**: Dashboard stats returns valid revenue and all 24 hours zero-filled.
   - **Test 8**: Orders list strictly never exposes `pickup_token`.
6. Confirm notice:
   ```text
   SUCCESS: All 8 Phase 8 test cases passed successfully.
   ```
