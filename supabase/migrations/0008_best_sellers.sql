-- =============================================================================
-- Migration 0008: Best Sellers Real-Time Aggregation & Indexing
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Index Analysis & Partial Composite Index on Orders
-- 2. Procedure: public.get_best_sellers (student-only, ranked sales aggregation)
-- 3. Permissions & Grants
-- 4. PostgREST Schema Cache Reload
-- =============================================================================

-- =============================================================================
-- 1. INDEX ANALYSIS & PARTIAL COMPOSITE INDEX
-- =============================================================================
-- Index Analysis:
-- 1. public.orders already has idx_orders_canteen_status on (canteen_id, status).
--    However, the best-sellers routine queries orders filtering specifically on
--    status = 'COLLECTED' within a dynamic collected_at time window. The partial
--    index below indexes only collected orders ordered by collected_at DESC, enabling
--    efficient range scans without scanning non-collected or older orders.
-- 2. public.order_items already has idx_order_items_order_id on (order_id),
--    which fully covers the relational join between orders and order_items.
--    No additional order_items index is required.

CREATE INDEX IF NOT EXISTS idx_orders_best_sellers_collected
ON public.orders(canteen_id, collected_at DESC)
WHERE status = 'COLLECTED';

-- =============================================================================
-- 2. PROCEDURE: public.get_best_sellers
-- =============================================================================
-- Signature: get_best_sellers(p_canteen_id uuid, p_days int DEFAULT 30, p_limit int DEFAULT 8)
-- Security: SECURITY DEFINER, search_path = ''
-- Access: Restricted strictly to active student accounts.
-- Output: Array of {"menu_item_id": uuid, "rank": integer, "units_sold": text}
-- Privacy invariant: Strictly never returns monetary revenue, user IDs, or order references.
-- Threshold rule: Returns empty array '[]'::jsonb if fewer than 3 items have qualifying sales.

CREATE OR REPLACE FUNCTION public.get_best_sellers(
  p_canteen_id uuid,
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_user_id uuid;
  v_profile_active boolean;
  v_profile_role public.user_role;
  v_days integer;
  v_limit integer;
  v_qualifying_count integer := 0;
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- 1. Authentication & Active Student Profile Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT p.is_active, p.role INTO v_profile_active, v_profile_role
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF NOT FOUND OR NOT v_profile_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: User profile is deactivated or does not exist';
  END IF;

  IF v_profile_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can view best sellers';
  END IF;

  -- 2. Canteen ID Check
  IF p_canteen_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 3. Clamp Parameters (days: 1..90, limit: 1..20)
  v_days := GREATEST(1, LEAST(COALESCE(p_days, 30), 90));
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 8), 20));

  -- 4. Sales Aggregation & Ranking
  -- Threshold of at least 3 items is evaluated over the full qualifying set
  -- (after availability filtering, BEFORE applying p_limit).
  WITH sales AS (
    SELECT 
      oi.menu_item_id,
      mi.name AS item_name,
      SUM(oi.quantity)::integer AS total_sold
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    WHERE o.canteen_id = p_canteen_id
      AND o.status = 'COLLECTED'::public.order_status
      AND o.collected_at >= (now() - make_interval(days => v_days))
      AND mi.canteen_id = p_canteen_id
      AND mi.is_active = true
      AND mi.is_available = true
    GROUP BY oi.menu_item_id, mi.name
    HAVING SUM(oi.quantity) > 0
  ),
  ranked AS (
    SELECT 
      s.menu_item_id,
      ROW_NUMBER() OVER (ORDER BY s.total_sold DESC, s.item_name ASC)::integer AS rank,
      CASE 
        WHEN s.total_sold >= 500 THEN '500+'
        WHEN s.total_sold >= 100 THEN '100+'
        WHEN s.total_sold >= 50  THEN '50+'
        WHEN s.total_sold >= 25  THEN '25+'
        WHEN s.total_sold >= 10  THEN '10+'
        WHEN s.total_sold >= 5   THEN '5+'
        ELSE 'Popular'
      END AS units_sold,
      COUNT(*) OVER () AS full_count
    FROM sales s
  )
  SELECT 
    COALESCE(MAX(r.full_count), 0),
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', r.menu_item_id,
        'rank', r.rank,
        'units_sold', r.units_sold
      ) ORDER BY r.rank ASC
    )
  INTO v_qualifying_count, v_result
  FROM (
    SELECT * FROM ranked ORDER BY rank ASC LIMIT v_limit
  ) r;

  -- 5. Under-threshold Check (< 3 qualifying items returns empty array)
  IF v_qualifying_count < 3 OR v_result IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN v_result;
END;
$$;

-- =============================================================================
-- 3. PERMISSIONS & GRANTS
-- =============================================================================
REVOKE ALL ON FUNCTION public.get_best_sellers(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_best_sellers(uuid, integer, integer) TO authenticated, service_role;

-- =============================================================================
-- 4. RELOAD SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';
