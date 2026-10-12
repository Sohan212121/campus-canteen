-- =============================================================================
-- Migration 0009: Verified-Purchase Reviews & Rating System
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Updated Menu Items Unauthorized Update Guard (Protect rating columns)
-- 2. Schema Expansion: rating_avg & rating_count on public.menu_items
-- 3. Table: public.item_reviews (RLS enabled, zero user policies)
-- 4. Trigger Function & Trigger: Synchronize menu_items ratings (Row-locked)
-- 5. Student Procedures: submit_review, delete_my_review, list_item_reviews, get_my_review_eligibility
-- 6. Admin Procedures: admin_list_reviews, admin_set_review_hidden (Audit-logged)
-- 7. Permissions, Grants & Optimized Indexes
-- 8. PostgREST Schema Cache Reload
-- =============================================================================

-- =============================================================================
-- 1. UPDATED MENU ITEMS UPDATE GUARD
-- =============================================================================
-- Replaces public.prevent_menu_item_unauthorized_update from 0002.
-- Key security enhancements:
-- 1. Rating columns (rating_avg, rating_count) are strictly protected against
--    ANY authenticated caller (student, staff, AND admin) before role bypasses.
--    Only internal SECURITY DEFINER routines (where current_user NOT IN ('authenticated', 'anon'))
--    can update rating columns.
-- 2. Permitted staff updates (is_available, stock for own canteen) remain functional.
-- 3. Students remain completely barred from updating menu items.

CREATE OR REPLACE FUNCTION public.prevent_menu_item_unauthorized_update()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_canteen uuid;
BEGIN
  -- Allow postgres / service_role / background processes / SECURITY DEFINER trigger functions
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- CRITICAL SECURITY INVARIANT:
  -- Block ANY authenticated caller (student, staff, or admin) from directly writing rating columns.
  -- rating_avg and rating_count are strictly maintained by public.handle_review_rating_sync.
  IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg OR
     NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'Direct modification of rating columns is prohibited';
  END IF;

  v_caller_role := public.current_user_role();

  -- Admin can update any other menu item column
  IF v_caller_role = 'admin'::public.user_role THEN
    RETURN NEW;
  END IF;

  -- Staff can ONLY update is_available and stock of their own canteen
  IF v_caller_role = 'staff'::public.user_role THEN
    v_caller_canteen := public.current_user_canteen();

    IF OLD.canteen_id IS DISTINCT FROM v_caller_canteen THEN
      RAISE EXCEPTION 'Staff cannot update menu items for another canteen';
    END IF;

    -- Block any modification to fields other than is_available and stock
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.canteen_id IS DISTINCT FROM OLD.canteen_id OR
       NEW.category_id IS DISTINCT FROM OLD.category_id OR
       NEW.name IS DISTINCT FROM OLD.name OR
       NEW.description IS DISTINCT FROM OLD.description OR
       NEW.price_paise IS DISTINCT FROM OLD.price_paise OR
       NEW.image_url IS DISTINCT FROM OLD.image_url OR
       NEW.is_veg IS DISTINCT FROM OLD.is_veg OR
       NEW.prep_minutes IS DISTINCT FROM OLD.prep_minutes OR
       NEW.is_active IS DISTINCT FROM OLD.is_active OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Staff are only permitted to update is_available and stock';
    END IF;

    RETURN NEW;
  END IF;

  -- Students or other roles cannot update menu items
  RAISE EXCEPTION 'Unauthorized to update menu items';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_menu_item_unauthorized_update() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 2. SCHEMA EXPANSION: MENU ITEM RATING COLUMNS
-- =============================================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

-- =============================================================================
-- 3. TABLE: public.item_reviews
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.item_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text NULL CHECK (comment IS NULL OR length(comment) <= 500),
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_item_reviews_user_item UNIQUE (user_id, menu_item_id)
);

ALTER TABLE public.item_reviews ENABLE ROW LEVEL SECURITY;

-- Defense in depth: zero policies, revoke all direct access from anon and authenticated.
REVOKE ALL ON TABLE public.item_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.item_reviews TO service_role;

-- =============================================================================
-- 4. RATING SYNCHRONIZATION TRIGGER
-- =============================================================================
-- Eliminates race conditions by locking the affected menu_items row FOR UPDATE
-- before calculating the aggregate and applying the rating update.

CREATE OR REPLACE FUNCTION public.handle_review_rating_sync()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_target_item_id uuid;
  v_old_item_id uuid;
  v_avg numeric(3,2);
  v_cnt integer;
BEGIN
  -- Determine affected item ID(s)
  IF TG_OP = 'DELETE' THEN
    v_target_item_id := OLD.menu_item_id;
  ELSE
    v_target_item_id := NEW.menu_item_id;
    IF TG_OP = 'UPDATE' AND OLD.menu_item_id IS DISTINCT FROM NEW.menu_item_id THEN
      v_old_item_id := OLD.menu_item_id;
    END IF;
  END IF;

  -- 1. Sync primary target menu_item
  IF v_target_item_id IS NOT NULL THEN
    -- Lock row to eliminate race conditions
    PERFORM 1 FROM public.menu_items WHERE id = v_target_item_id FOR UPDATE;

    SELECT
      ROUND(AVG(rating)::numeric, 2),
      COUNT(*)::integer
    INTO v_avg, v_cnt
    FROM public.item_reviews
    WHERE menu_item_id = v_target_item_id
      AND is_hidden = false;

    UPDATE public.menu_items
    SET rating_avg = v_avg,
        rating_count = COALESCE(v_cnt, 0)
    WHERE id = v_target_item_id;
  END IF;

  -- 2. If item changed on UPDATE, sync old menu_item as well
  IF v_old_item_id IS NOT NULL THEN
    PERFORM 1 FROM public.menu_items WHERE id = v_old_item_id FOR UPDATE;

    SELECT
      ROUND(AVG(rating)::numeric, 2),
      COUNT(*)::integer
    INTO v_avg, v_cnt
    FROM public.item_reviews
    WHERE menu_item_id = v_old_item_id
      AND is_hidden = false;

    UPDATE public.menu_items
    SET rating_avg = v_avg,
        rating_count = COALESCE(v_cnt, 0)
    WHERE id = v_old_item_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_review_rating_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_menu_item_ratings ON public.item_reviews;
CREATE TRIGGER trg_sync_menu_item_ratings
  AFTER INSERT OR DELETE OR UPDATE OF rating, is_hidden, menu_item_id
  ON public.item_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_review_rating_sync();

-- =============================================================================
-- 5. STUDENT PROCEDURES
-- =============================================================================

-- 5.1 submit_review
CREATE OR REPLACE FUNCTION public.submit_review(
  p_menu_item_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller_active boolean;
  v_caller_role public.user_role;
  v_clean_comment text;
  v_qualifying_order_id uuid;
  v_recent_distinct_reviews integer;
  v_result record;
BEGIN
  -- 1. Authentication Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active, role INTO v_caller_active, v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller_active = false THEN
    RAISE EXCEPTION 'FORBIDDEN: User account is inactive or not found';
  END IF;

  IF v_caller_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can submit reviews';
  END IF;

  -- 2. NULL Safety & Input Validation
  IF p_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Menu item ID is required';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Rating must be an integer between 1 and 5';
  END IF;

  -- 3. Sanitization
  IF p_comment IS NOT NULL THEN
    -- Turn \r, \n, \t into single space
    v_clean_comment := regexp_replace(p_comment, '[\r\n\t]+', ' ', 'g');
    -- Strip remaining control characters, zero-width, and bidi override characters
    v_clean_comment := regexp_replace(v_clean_comment, '[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2066-\u2069]', '', 'g');
    v_clean_comment := trim(v_clean_comment);

    IF length(v_clean_comment) > 500 THEN
      RAISE EXCEPTION 'INVALID_INPUT: Comment cannot exceed 500 characters';
    END IF;

    IF length(v_clean_comment) = 0 THEN
      v_clean_comment := NULL;
    END IF;
  ELSE
    v_clean_comment := NULL;
  END IF;

  -- 4. Verified Purchase Check (Must have a COLLECTED order containing this item)
  SELECT o.id INTO v_qualifying_order_id
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.user_id = v_caller_id
    AND o.status = 'COLLECTED'::public.order_status
    AND oi.menu_item_id = p_menu_item_id
  ORDER BY o.collected_at DESC
  LIMIT 1;

  IF v_qualifying_order_id IS NULL THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: Verified purchase required to review this item';
  END IF;

  -- 5. Rate Limiting: Max 10 distinct reviews created or edited in rolling 24 hours.
  -- RATIONALE: Counting rows with updated_at in the last 24h limits the number of DISTINCT
  -- menu items authored or updated by this user within 24 hours, preventing automated spam bursts.
  SELECT COUNT(*)::integer INTO v_recent_distinct_reviews
  FROM public.item_reviews
  WHERE user_id = v_caller_id
    AND updated_at >= (now() - interval '24 hours');

  -- If user already has a review for this item that was modified in 24h, editing it does not exceed limit
  IF v_recent_distinct_reviews >= 10 AND NOT EXISTS (
    SELECT 1 FROM public.item_reviews
    WHERE user_id = v_caller_id
      AND menu_item_id = p_menu_item_id
      AND updated_at >= (now() - interval '24 hours')
  ) THEN
    RAISE EXCEPTION 'RATE_LIMITED: Maximum 10 reviews may be submitted or modified per 24 hours';
  END IF;

  -- 6. Upsert on (user_id, menu_item_id)
  -- CRITICAL: is_hidden is intentionally OMITTED from DO UPDATE so existing moderation state persists!
  INSERT INTO public.item_reviews (
    menu_item_id,
    user_id,
    order_id,
    rating,
    comment,
    is_hidden,
    created_at,
    updated_at
  ) VALUES (
    p_menu_item_id,
    v_caller_id,
    v_qualifying_order_id,
    p_rating,
    v_clean_comment,
    false,
    now(),
    now()
  )
  ON CONFLICT (user_id, menu_item_id) DO UPDATE SET
    rating = EXCLUDED.rating,
    comment = EXCLUDED.comment,
    order_id = EXCLUDED.order_id,
    updated_at = now()
  RETURNING id, menu_item_id, rating, comment, is_hidden, created_at, updated_at
  INTO v_result;

  RETURN jsonb_build_object(
    'id', v_result.id,
    'menu_item_id', v_result.menu_item_id,
    'rating', v_result.rating,
    'comment', v_result.comment,
    'is_hidden', v_result.is_hidden,
    'created_at', v_result.created_at,
    'updated_at', v_result.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text) TO authenticated, service_role;

-- 5.2 delete_my_review
CREATE OR REPLACE FUNCTION public.delete_my_review(
  p_menu_item_id uuid
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller_active boolean;
  v_caller_role public.user_role;
  v_deleted boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active, role INTO v_caller_active, v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller_active = false THEN
    RAISE EXCEPTION 'FORBIDDEN: User account is inactive or not found';
  END IF;

  IF v_caller_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can delete reviews';
  END IF;

  IF p_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Menu item ID is required';
  END IF;

  DELETE FROM public.item_reviews
  WHERE user_id = v_caller_id
    AND menu_item_id = p_menu_item_id;

  v_deleted := FOUND;

  IF NOT v_deleted THEN
    RAISE EXCEPTION 'NOT_FOUND: Review not found';
  END IF;

  RETURN jsonb_build_object('success', true, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_review(uuid) TO authenticated, service_role;

-- 5.3 list_item_reviews
CREATE OR REPLACE FUNCTION public.list_item_reviews(
  p_menu_item_id uuid,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller_active boolean;
  v_limit integer;
  v_offset integer;
  v_item record;
  v_histogram jsonb;
  v_reviews jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active INTO v_caller_active
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller_active = false THEN
    RAISE EXCEPTION 'FORBIDDEN: User account is inactive or not found';
  END IF;

  IF p_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Menu item ID is required';
  END IF;

  -- Verify menu item exists
  SELECT id, rating_avg, rating_count INTO v_item
  FROM public.menu_items
  WHERE id = p_menu_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Menu item does not exist';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- 1. Compute 1..5 star histogram strictly from non-hidden reviews
  SELECT jsonb_build_object(
    '5', COUNT(*) FILTER (WHERE rating = 5),
    '4', COUNT(*) FILTER (WHERE rating = 4),
    '3', COUNT(*) FILTER (WHERE rating = 3),
    '2', COUNT(*) FILTER (WHERE rating = 2),
    '1', COUNT(*) FILTER (WHERE rating = 1)
  ) INTO v_histogram
  FROM public.item_reviews
  WHERE menu_item_id = p_menu_item_id
    AND is_hidden = false;

  -- 2. Select reviews: non-hidden reviews OR caller's own review
  -- Privacy invariant: return only rating, comment, created_at, is_mine, is_hidden, display_name.
  -- Zero email, college_id, user_id, or review id leaked.
  SELECT COALESCE(jsonb_agg(r_row), '[]'::jsonb)
  INTO v_reviews
  FROM (
    SELECT jsonb_build_object(
      'rating', r.rating,
      'comment', r.comment,
      'created_at', r.created_at,
      'is_mine', (r.user_id = v_caller_id),
      'is_hidden', r.is_hidden,
      'display_name',
        CASE
          WHEN p.full_name IS NULL OR length(trim(p.full_name)) = 0 OR p.full_name LIKE '%@%' THEN 'Student'
          ELSE
            (
              WITH cleaned AS (
                SELECT regexp_replace(trim(p.full_name), '\s+', ' ', 'g') AS s
              )
              SELECT
                CASE
                  WHEN position(' ' in s) > 0 THEN
                    substr(split_part(s, ' ', 1), 1, 20) || ' ' || upper(substr(split_part(s, ' ', 2), 1, 1)) || '.'
                  ELSE
                    substr(s, 1, 20)
                END
              FROM cleaned
            )
        END
    ) AS r_row
    FROM public.item_reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.menu_item_id = p_menu_item_id
      AND (r.is_hidden = false OR r.user_id = v_caller_id)
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object(
    'menu_item_id', p_menu_item_id,
    'rating_avg', v_item.rating_avg,
    'rating_count', v_item.rating_count,
    'histogram', v_histogram,
    'reviews', v_reviews
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_item_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_item_reviews(uuid, integer, integer) TO authenticated, service_role;

-- 5.4 get_my_review_eligibility
CREATE OR REPLACE FUNCTION public.get_my_review_eligibility(
  p_menu_item_ids uuid[]
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller_active boolean;
  v_caller_role public.user_role;
  v_results jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active, role INTO v_caller_active, v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller_active = false THEN
    RAISE EXCEPTION 'FORBIDDEN: User account is inactive or not found';
  END IF;

  IF v_caller_role <> 'student'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only student accounts can check review eligibility';
  END IF;

  IF p_menu_item_ids IS NULL OR cardinality(p_menu_item_ids) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  IF cardinality(p_menu_item_ids) > 50 THEN
    RAISE EXCEPTION 'INVALID_INPUT: Maximum 50 items can be checked for eligibility';
  END IF;

  WITH distinct_ids AS (
    SELECT DISTINCT unnest(p_menu_item_ids) AS item_id
  ),
  eligible AS (
    SELECT DISTINCT oi.menu_item_id
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.user_id = v_caller_id
      AND o.status = 'COLLECTED'::public.order_status
      AND oi.menu_item_id IN (SELECT item_id FROM distinct_ids)
  ),
  existing_reviews AS (
    SELECT
      r.menu_item_id,
      r.rating,
      r.comment,
      r.is_hidden,
      r.updated_at
    FROM public.item_reviews r
    WHERE r.user_id = v_caller_id
      AND r.menu_item_id IN (SELECT item_id FROM distinct_ids)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'menu_item_id', d.item_id,
      'can_review', (e.menu_item_id IS NOT NULL),
      'has_reviewed', (xr.menu_item_id IS NOT NULL),
      'my_rating', xr.rating,
      'my_comment', xr.comment,
      'my_is_hidden', xr.is_hidden,
      'my_updated_at', xr.updated_at
    )
  ), '[]'::jsonb)
  INTO v_results
  FROM distinct_ids d
  LEFT JOIN eligible e ON e.menu_item_id = d.item_id
  LEFT JOIN existing_reviews xr ON xr.menu_item_id = d.item_id;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_review_eligibility(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_review_eligibility(uuid[]) TO authenticated, service_role;

-- =============================================================================
-- 6. ADMIN PROCEDURES
-- =============================================================================

-- 6.1 admin_list_reviews
CREATE OR REPLACE FUNCTION public.admin_list_reviews(
  p_status text DEFAULT 'all',
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller record;
  v_limit integer;
  v_offset integer;
  v_escaped_search text;
  v_total_count integer;
  v_reviews jsonb;
BEGIN
  -- 1. Active Admin Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active, role INTO v_caller
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
  END IF;

  IF v_caller.role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators can access review moderation';
  END IF;

  -- 2. Clamping
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- 3. Search escaping
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_escaped_search := '%' || replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- 4. Count total
  SELECT COUNT(*)::integer INTO v_total_count
  FROM public.item_reviews r
  JOIN public.menu_items mi ON mi.id = r.menu_item_id
  JOIN public.canteens c ON c.id = mi.canteen_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  LEFT JOIN auth.users u ON u.id = r.user_id
  WHERE (
    p_status = 'all'
    OR (p_status = 'hidden' AND r.is_hidden = true)
    OR (p_status = 'visible' AND r.is_hidden = false)
  )
  AND (
    v_escaped_search IS NULL
    OR mi.name ILIKE v_escaped_search ESCAPE '\'
    OR p.full_name ILIKE v_escaped_search ESCAPE '\'
    OR u.email ILIKE v_escaped_search ESCAPE '\'
    OR r.comment ILIKE v_escaped_search ESCAPE '\'
  );

  -- 5. Select reviews page
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO v_reviews
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'menu_item_id', r.menu_item_id,
      'item_name', mi.name,
      'canteen_name', c.name,
      'user_id', r.user_id,
      'reviewer_name', p.full_name,
      'reviewer_email', u.email,
      'rating', r.rating,
      'comment', r.comment,
      'is_hidden', r.is_hidden,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ) AS row_data
    FROM public.item_reviews r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id
    JOIN public.canteens c ON c.id = mi.canteen_id
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN auth.users u ON u.id = r.user_id
    WHERE (
      p_status = 'all'
      OR (p_status = 'hidden' AND r.is_hidden = true)
      OR (p_status = 'visible' AND r.is_hidden = false)
    )
    AND (
      v_escaped_search IS NULL
      OR mi.name ILIKE v_escaped_search ESCAPE '\'
      OR p.full_name ILIKE v_escaped_search ESCAPE '\'
      OR u.email ILIKE v_escaped_search ESCAPE '\'
      OR r.comment ILIKE v_escaped_search ESCAPE '\'
    )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN jsonb_build_object(
    'reviews', v_reviews,
    'total_count', v_total_count,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_reviews(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reviews(text, text, integer, integer) TO authenticated, service_role;

-- 6.2 admin_set_review_hidden
CREATE OR REPLACE FUNCTION public.admin_set_review_hidden(
  p_review_id uuid,
  p_hidden boolean
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_caller_id uuid;
  v_caller record;
  v_current_hidden boolean;
BEGIN
  -- 1. Active Admin Check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  SELECT is_active, role INTO v_caller
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Caller profile not found or inactive';
  END IF;

  IF v_caller.role != 'admin'::public.user_role THEN
    RAISE EXCEPTION 'FORBIDDEN: Only administrators can moderate reviews';
  END IF;

  IF p_review_id IS NULL OR p_hidden IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: Review ID and hidden state are required';
  END IF;

  -- 2. Fetch current status
  SELECT is_hidden INTO v_current_hidden
  FROM public.item_reviews
  WHERE id = p_review_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Review not found';
  END IF;

  -- 3. If already in requested state, return changed: false without writing audit log
  IF v_current_hidden = p_hidden THEN
    RETURN jsonb_build_object(
      'success', true,
      'changed', false,
      'review_id', p_review_id,
      'is_hidden', p_hidden
    );
  END IF;

  -- 4. Update status (trigger automatically recalculates menu_items ratings)
  UPDATE public.item_reviews
  SET is_hidden = p_hidden,
      updated_at = now()
  WHERE id = p_review_id;

  -- 5. Write audit log
  INSERT INTO public.admin_audit_log (
    actor_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    v_caller_id,
    CASE WHEN p_hidden THEN 'HIDE_REVIEW' ELSE 'UNHIDE_REVIEW' END,
    'item_review',
    p_review_id::text,
    jsonb_build_object('is_hidden', p_hidden)
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'review_id', p_review_id,
    'is_hidden', p_hidden
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_review_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_review_hidden(uuid, boolean) TO authenticated, service_role;

-- =============================================================================
-- 7. INDEXES
-- =============================================================================
-- 1. Optimized index for non-hidden reviews per item: speeds up list_item_reviews,
--    histogram computation, and trigger aggregate calculation.
CREATE INDEX IF NOT EXISTS idx_item_reviews_item_visible_created
  ON public.item_reviews(menu_item_id, created_at DESC)
  WHERE is_hidden = false;

-- 2. Index on user_id + updated_at: optimizes user review eligibility lookups
--    and the 24-hour sliding rate-limit calculation.
CREATE INDEX IF NOT EXISTS idx_item_reviews_user_updated
  ON public.item_reviews(user_id, updated_at DESC);

-- =============================================================================
-- 8. RELOAD SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';
