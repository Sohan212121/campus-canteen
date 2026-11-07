# Campus Canteen Performance Architecture & Benchmarks

This document details the server performance enhancements, query optimizations, timeout resilience patterns, and architectural rules implemented for Campus Canteen (Phase 3: Server Speed).

---

## 1. Executive Summary

Phase 3 focused on optimizing server-side execution speed, eliminating redundant database round trips between proxy middleware, layouts, and page components, guarding against upstream Supabase network latencies, and introducing safe cross-request caching for public, rarely changing canteen data without risking user data leakage.

### Key Performance Accomplishments:
- **Per-Request Memoisation**: Wrapped core auth and canteen resolution helpers (`getCurrentUser`, `getActiveCanteenId`, `getCanteenById`, `getPublicCategories`) in `React.cache()`, reducing database calls per page request from 3–5 down to 1 single deduplicated lookup.
- **Parallel Query Execution**: Replaced sequential waterfalls on staff and student views with concurrent `Promise.all()` pipelines.
- **Strict Column Projections**: Verified 0 wildcard `select('*')` queries across the application, saving serialization overhead and network bandwidth.
- **Timeout Safety & Resilience**: Added a strict 4-second timeout (`AbortSignal`) on auth/profile resolutions. Latency spikes or Supabase degradation return an accessible, branded HTTP 503 "Service Unavailable" response with `Retry-After: 5` rather than hanging requests for 25+ seconds, and never trigger erroneous session logouts or redirect loops.
- **Safe Public Data & Per-Request Caching**: Canteen settings and category catalogs are deduplicated per request using `React.cache()`. Next.js 16 dynamic data source restrictions prohibit accessing session `cookies()` inside `unstable_cache()`; since Supabase RLS policies require the authenticated session context, per-request memoisation via `React.cache()` guarantees single-query efficiency without dynamic data source conflicts.

---

## 2. Before vs. After Architectural Comparison

| Dimension | Baseline (Pre-Phase 3) | Optimized (Phase 3) |
| :--- | :--- | :--- |
| **User & Profile Lookups** | Proxy checked session; Layout re-queried user profile; Page called `requireRole` and re-fetched profile. | Single `getCurrentUser()` execution shared across proxy, layout, and page via `React.cache()`. |
| **Canteen Resolution** | Multiple independent queries for `canteens` table per page navigation. | Deduplicated within request via `React.cache()` across layouts, components, and pages. |
| **Category Queries** | Every request to Home and Menu queried `public.categories`. | Deduplicated within request via `React.cache()` (`getPublicCategories`), avoiding multiple queries per render pass. |
| **Staff Dashboard Queries** | Sequential waterfall: Canteen resolved $\rightarrow$ Kitchen board orders fetched $\rightarrow$ Completed counts fetched. | Parallelized: Canteen lookup, active orders, and completion metrics execute concurrently via `Promise.all()`. |
| **Wildcard Queries** | Risk of schema drift and fetching unneeded JSON/text columns. | 100% explicit column projections; verified by automated static analyzer (`no-wildcard-select.test.ts`). |
| **Supabase Latency Spikes** | Unhandled `AuthRetryableFetchError` or 25s+ request hangs; false redirect to `/login` wiping state. | 4-second timeout boundary (`AbortSignal`). Public pages load instantly; protected pages render HTTP 503 with Retry button; session preserved. |
| **Test Suite Coverage** | Standard feature tests. | Added 46 new unit tests for per-request caching, query limits, timeout safety, 503 responses, and tag invalidation (537 total passing tests). |

---

## 3. Database Indexes: Dependencies & Suggestions

> [!NOTE]
> In accordance with Phase 3 constraints, no migrations were created or applied during this phase. The following represents an audit of index dependencies and recommended optimizations for future migrations.

### Queries That Depend on Existing Indexes
1. `idx_profiles_role` & `idx_profiles_canteen_id`: Utilized by `requireRole` and staff layout canteen association.
2. `idx_menu_items_availability` (`canteen_id, is_active, is_available`): Utilized by menu and home queries to retrieve active items.
3. `idx_orders_canteen_status` & `idx_orders_canteen_status_ready`: Utilized by staff kitchen board and pickup board.
4. `idx_notifications_user_id` (`user_id, is_read, created_at DESC`): Utilized by student header unread notification badge count.

### Recommended Missing Database Indexes (SUGGESTIONS ONLY)

To further accelerate database read performance when traffic scales, the following composite and partial indexes are suggested:

```sql
-- 1. Student Active Order Lookup (Student Home First Paint)
-- Query: orders WHERE user_id = $1 AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY') ORDER BY placed_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_orders_user_active 
ON public.orders (user_id, status, placed_at DESC);

-- 2. Student Order History (Orders Page)
-- Query: orders WHERE user_id = $1 ORDER BY placed_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_user_placed_at 
ON public.orders (user_id, placed_at DESC);

-- 3. Category Catalog Index-Only Scan
-- Query: categories WHERE canteen_id = $1 AND is_active = true ORDER BY display_order ASC
CREATE INDEX IF NOT EXISTS idx_categories_canteen_active_order 
ON public.categories (canteen_id, is_active, display_order) 
INCLUDE (name);

-- 4. Active Canteen Lookup Partial Index
-- Query: canteens WHERE is_active = true ORDER BY created_at ASC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_canteens_active_partial 
ON public.canteens (created_at ASC) 
WHERE is_active = true;
```

---

## 4. Architectural Rules for New Routes

All developers and agents working on Campus Canteen must adhere to these server performance rules:

1. **Per-Request Memoisation for Shared Entities**:
   - Any helper that fetches user profiles, authentication state, or canteen configuration MUST be wrapped in `React.cache()`.
   - Never re-query `auth.getUser()` if `requireRole()` has already verified the user in that request.

2. **Zero Wildcard Projections**:
   - Never use `select('*')` or unprojected `.select()`. Always specify the exact column list needed for that view (e.g. `select('id, name, price_cents, is_available')`).

3. **No Sequential Query Waterfalls**:
   - If a page requires multiple pieces of data (e.g. categories, menu items, active orders), execute them concurrently using `Promise.all([ ... ])`.

4. **Never Access Dynamic Data Sources Inside `unstable_cache`**:
   - `unstable_cache` must NEVER be used with functions that call `cookies()`, `headers()`, or `createReadOnlyClient()`. Next.js 16 will throw a dynamic data source error.
   - For all Supabase queries governed by RLS, use `React.cache()` for per-request memoisation instead.

5. **Tag-Based Revalidation for Static/Public Caches**:
   - When public caches or static pages are used, ensure admin mutation actions call the appropriate path or tag invalidation (`revalidatePath` / `safeRevalidateTag`).

6. **Enforce 4-Second Timeout on Upstream Services**:
   - When calling external or upstream authentication/database services, enforce a timeout boundary using `withTimeout(fn, 4000)`.
   - On timeout, log `"auth service unreachable"` without logging tokens or keys, render a 503 Service Unavailable page, and never clear user session cookies.

