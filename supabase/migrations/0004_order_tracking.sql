-- =============================================================================
-- Migration 0004: Order Tracking, Cancellation, Notifications & Realtime
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Realtime Publication configuration for public.orders and public.notifications
-- 2. Procedure: public.cancel_order(p_order_id uuid)
-- 3. Trigger Function & Trigger: public.handle_order_status_notification()
-- 4. Permissions & Grants
-- 5. PostgREST Schema Cache Reload
-- =============================================================================

-- =============================================================================
-- 1. REALTIME PUBLICATION CONFIGURATION
-- =============================================================================
-- REALTIME RLS SECURITY NOTE:
-- Supabase Realtime respects PostgreSQL Row Level Security (RLS) policies on
-- published tables. When a subscriber client connects with an authenticated JWT,
-- PostgreSQL evaluates the subscriber's auth.uid() against the SELECT RLS policies:
--
--  * public.orders:
--      Policy "orders_select_self" restricts rows to:
--      (user_id = auth.uid() OR staff/canteen matching OR is_admin())
--      Students ONLY receive realtime broadcast events for their own orders.
--
--  * public.notifications:
--      Policy "notifications_select_self" restricts rows to:
--      (user_id = auth.uid() OR is_admin())
--      Students ONLY receive realtime notifications targeted to their own user_id.
--
-- Guarded with IF NOT EXISTS checks on pg_publication_tables to support idempotent execution.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;


-- =============================================================================
-- 2. ORDER CANCELLATION PROCEDURE: public.cancel_order
-- =============================================================================
-- Cancels an eligible pre-order, restores deducted inventory stock, and logs
-- an audit notification. Strictly derives the caller from auth.uid().
--
-- Execution & Error Codes:
--   * UNAUTHENTICATED  : auth.uid() is null
--   * NOT_FOUND        : Order does not exist or does not belong to auth.uid()
--   * NOT_CANCELLABLE  : Order is in a lifecycle status other than PLACED
--   * Idempotent return: If order is already CANCELLED, returns was_already_cancelled = true
--
-- Queue Load Behavior:
--   public.estimate_ready_time calculates queued workload strictly using:
--     status IN ('PLACED', 'ACCEPTED', 'PREPARING')
--   Because this function sets status to 'CANCELLED', the order is immediately excluded
--   from future queued workload calculations without requiring manual queue deletion.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid
) RETURNS jsonb
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  -- Allowed cancellation statuses constant. Mirrored in TypeScript by CANCELLABLE_STATUSES = ['PLACED']
  c_cancellable_statuses CONSTANT public.order_status[] := ARRAY['PLACED'::public.order_status];

  v_user_id   uuid;
  v_order     public.orders%ROWTYPE;
BEGIN
  -- 1. Derive and verify authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User is not authenticated';
  END IF;

  -- 2. Lock target order row FOR UPDATE
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  -- 3. Verify existence and caller ownership (NOT_FOUND)
  IF NOT FOUND OR v_order.user_id != v_user_id THEN
    RAISE EXCEPTION 'NOT_FOUND: Order % not found or not owned by user', p_order_id;
  END IF;

  -- 4. Idempotency Check: Already CANCELLED
  IF v_order.status = 'CANCELLED'::public.order_status THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'was_already_cancelled', true
    );
  END IF;

  -- 5. Status Policy Rule Check (NOT_CANCELLABLE)
  IF NOT (v_order.status = ANY(c_cancellable_statuses)) THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE: Order cannot be cancelled in status %', v_order.status;
  END IF;

  -- 6. Transition Order Status to CANCELLED
  UPDATE public.orders
  SET 
    status = 'CANCELLED'::public.order_status,
    cancelled_at = now()
  WHERE id = v_order.id;

  -- 7. Restore Deducted Stock (Ordered locking avoids concurrent deadlocks)
  -- Step 7a: Lock related menu_items in canonical id order
  PERFORM id
  FROM public.menu_items
  WHERE id IN (
    SELECT menu_item_id
    FROM public.order_items
    WHERE order_id = v_order.id
  )
  ORDER BY id ASC
  FOR UPDATE;

  -- Step 7b: Increment inventory quantities where tracking is active (stock IS NOT NULL)
  UPDATE public.menu_items mi
  SET stock = mi.stock + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id
    AND oi.menu_item_id = mi.id
    AND mi.stock IS NOT NULL;

  -- 8. Insert In-App Notification (PRD Section 13 copy)
  INSERT INTO public.notifications (
    user_id,
    order_id,
    title,
    body
  ) VALUES (
    v_user_id,
    v_order.id,
    'Order Cancelled',
    'Your order has been cancelled.'
  );

  -- 9. Return Successful Cancellation Result
  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', 'CANCELLED',
    'was_already_cancelled', false
  );
END;
$$;


-- =============================================================================
-- 3. STATUS CHANGE NOTIFICATION TRIGGER
-- =============================================================================
-- Automatically dispatches notifications to users whenever an order's status
-- transitions into ACCEPTED, PREPARING, READY, or REJECTED.
-- Message copy adheres to PRD Section 13.
-- Does NOT generate CANCELLED notifications, as public.cancel_order writes its own.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_order_status_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  -- Only process status modifications
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map new status to PRD Section 13 notification copy
  CASE NEW.status
    WHEN 'ACCEPTED'::public.order_status THEN
      v_title := 'Order Accepted';
      v_body  := 'Your order has been accepted by the canteen.';

    WHEN 'PREPARING'::public.order_status THEN
      v_title := 'Order Preparing';
      v_body  := 'Your order is being prepared.';

    WHEN 'READY'::public.order_status THEN
      v_title := 'Order Ready';
      v_body  := 'Your order is ready for pickup.';

    WHEN 'REJECTED'::public.order_status THEN
      v_title := 'Order Rejected';
      v_body  := 'Your order was rejected by the canteen.';

    ELSE
      -- CANCELLED handled by cancel_order; COLLECTED requires no alert
      RETURN NEW;
  END CASE;

  -- Insert notification for the ordering student
  INSERT INTO public.notifications (
    user_id,
    order_id,
    title,
    body
  ) VALUES (
    NEW.user_id,
    NEW.id,
    v_title,
    v_body
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_notification ON public.orders;
CREATE TRIGGER trg_order_status_notification
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_notification();


-- =============================================================================
-- 4. PERMISSIONS & SECURITY HARDENING
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_order_status_notification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_order_status_notification() TO authenticated, service_role;


-- =============================================================================
-- 5. RELOAD SCHEMA CACHE
-- =============================================================================
NOTIFY pgrst, 'reload schema';
