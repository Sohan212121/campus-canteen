-- =============================================================================
-- Migration 0019: Order Pickup Reminders & Window Notifications
-- Target Database: PostgreSQL 15+ (Supabase)
-- Timezone Reference: Asia/Kolkata (IST)
--
-- Contents:
-- 1. Table Columns: orders.reminder_5_sent_at, orders.reminder_2_sent_at
-- 2. Performance Index: idx_orders_ready_reminders
-- 3. Canteen/Admin Sweep RPC: public.send_pickup_reminders(p_canteen_id uuid)
-- 4. Student Self-Sweep RPC: public.send_my_pickup_reminders()
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TABLE COLUMNS: orders.reminder_5_sent_at, orders.reminder_2_sent_at
-- =============================================================================
-- Tracks whether the 5-minute and 2-minute pickup window reminder notifications
-- have already been dispatched for this order, ensuring strict idempotency.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reminder_5_sent_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reminder_2_sent_at timestamptz DEFAULT NULL;

-- =============================================================================
-- 2. PERFORMANCE INDEX: idx_orders_ready_reminders
-- =============================================================================
-- Partial index optimized for periodic sweeps scanning active READY orders
-- to evaluate hold window deadlines and reminder dispatch timestamps.

CREATE INDEX IF NOT EXISTS idx_orders_ready_reminders
  ON public.orders (canteen_id, status, ready_at)
  WHERE status = 'READY';

-- =============================================================================
-- 3. SWEEP ROUTINE: public.send_pickup_reminders(p_canteen_id uuid)
-- =============================================================================
-- Callable by:
--   - Staff: for their assigned canteen only
--   - Admin: for any specific canteen or all canteens (p_canteen_id IS NULL)
--   - Service Role / Background Cron: for all canteens or specific canteen
--
-- Logic:
--   - Scans READY orders that have ready_at set and are NOT yet expired:
--     (ready_at + hold_minutes * interval '1 minute') > clock_timestamp()
--   - If time remaining <= 2 minutes and reminder_2_sent_at IS NULL:
--       Inserts "Final Call: 2 Minutes Left" notification
--       Sets reminder_2_sent_at = clock_timestamp() (and reminder_5_sent_at if null)
--   - Else if time remaining <= 5 minutes and reminder_5_sent_at IS NULL:
--       Inserts "Pickup Reminder: 5 Minutes Left" notification
--       Sets reminder_5_sent_at = clock_timestamp()
--   - Uses FOR UPDATE OF o SKIP LOCKED with batch cap 200 to prevent locking bottlenecks.

CREATE OR REPLACE FUNCTION public.send_pickup_reminders(p_canteen_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role public.user_role;
  v_caller_active boolean;
  v_caller_canteen uuid;
  v_rec record;
  v_count integer := 0;
  v_hold_minutes integer;
  v_deadline timestamptz;
  v_remaining interval;
BEGIN
  v_caller_id := auth.uid();

  -- Authorisation check matching mark_no_shows pattern:
  IF v_caller_id IS NULL THEN
    IF session_user NOT IN ('postgres', 'service_role', 'supabase_admin')
       AND coalesce(auth.role(), '') != 'service_role' THEN
      RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
    END IF;
  ELSE
    SELECT role, is_active, canteen_id INTO v_caller_role, v_caller_active, v_caller_canteen
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller_active THEN
      RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
    END IF;

    IF v_caller_role = 'staff'::public.user_role THEN
      IF v_caller_canteen IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff has no assigned canteen';
      END IF;
      IF p_canteen_id IS NOT NULL AND p_canteen_id IS DISTINCT FROM v_caller_canteen THEN
        RAISE EXCEPTION 'FORBIDDEN: Staff can only process reminders for their assigned canteen';
      END IF;
      p_canteen_id := v_caller_canteen;
    ELSIF v_caller_role = 'admin'::public.user_role THEN
      -- Admin may pass a specific canteen or NULL (all canteens)
      NULL;
    ELSE
      RAISE EXCEPTION 'FORBIDDEN: Only staff and admin may execute send_pickup_reminders';
    END IF;
  END IF;

  -- Lock candidate READY orders eligible for 5-minute or 2-minute reminders
  FOR v_rec IN
    SELECT
      o.id,
      o.order_code,
      o.user_id,
      o.canteen_id,
      o.ready_at,
      o.reminder_5_sent_at,
      o.reminder_2_sent_at,
      coalesce(c.hold_minutes, 15) AS hold_minutes
    FROM public.orders o
    JOIN public.canteens c ON c.id = o.canteen_id
    WHERE o.status = 'READY'::public.order_status
      AND (p_canteen_id IS NULL OR o.canteen_id = p_canteen_id)
      AND o.ready_at IS NOT NULL
      AND (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) > clock_timestamp()
      AND (
        -- Eligible for 2-minute reminder
        (
          (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) <= (clock_timestamp() + interval '2 minutes')
          AND o.reminder_2_sent_at IS NULL
        )
        OR
        -- Eligible for 5-minute reminder
        (
          (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) <= (clock_timestamp() + interval '5 minutes')
          AND o.reminder_5_sent_at IS NULL
        )
      )
    ORDER BY o.ready_at ASC
    LIMIT 200
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_deadline := v_rec.ready_at + (v_rec.hold_minutes * interval '1 minute');
    v_remaining := v_deadline - clock_timestamp();

    -- Check 2-minute threshold first
    IF v_remaining <= interval '2 minutes' AND v_rec.reminder_2_sent_at IS NULL THEN
      -- Insert 2-minute urgent notification
      INSERT INTO public.notifications (
        user_id,
        order_id,
        title,
        body
      ) VALUES (
        v_rec.user_id,
        v_rec.id,
        'Final Call: 2 Minutes Left',
        'Order #' || v_rec.order_code || ' will expire in 2 minutes. Please collect it from the counter now!'
      );

      -- Update both reminder timestamps to prevent later duplicate 5m reminders
      UPDATE public.orders
      SET reminder_2_sent_at = clock_timestamp(),
          reminder_5_sent_at = coalesce(reminder_5_sent_at, clock_timestamp())
      WHERE id = v_rec.id;

      v_count := v_count + 1;

    -- Check 5-minute threshold
    ELSIF v_remaining <= interval '5 minutes' AND v_rec.reminder_5_sent_at IS NULL THEN
      -- Insert 5-minute warning notification
      INSERT INTO public.notifications (
        user_id,
        order_id,
        title,
        body
      ) VALUES (
        v_rec.user_id,
        v_rec.id,
        'Pickup Reminder: 5 Minutes Left',
        'Your order #' || v_rec.order_code || ' is ready at the counter. Please collect it within the next 5 minutes.'
      );

      UPDATE public.orders
      SET reminder_5_sent_at = clock_timestamp()
      WHERE id = v_rec.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sent_count', v_count,
    'canteen_id', p_canteen_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_pickup_reminders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_pickup_reminders(uuid) TO authenticated, service_role;

-- =============================================================================
-- 4. STUDENT SELF-SWEEP ROUTINE: public.send_my_pickup_reminders()
-- =============================================================================
-- Allows a student's active order detail page to opportunistically evaluate
-- their own READY orders and dispatch in-app notifications if due.
-- Guarantees caller isolation: can ONLY touch orders belonging to auth.uid().

CREATE OR REPLACE FUNCTION public.send_my_pickup_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_profile record;
  v_rec record;
  v_count integer := 0;
  v_deadline timestamptz;
  v_remaining interval;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required';
  END IF;

  SELECT role, is_active INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR NOT v_profile.is_active THEN
    RAISE EXCEPTION 'USER_INACTIVE: Account is inactive or does not exist';
  END IF;

  FOR v_rec IN
    SELECT
      o.id,
      o.order_code,
      o.ready_at,
      o.reminder_5_sent_at,
      o.reminder_2_sent_at,
      coalesce(c.hold_minutes, 15) AS hold_minutes
    FROM public.orders o
    JOIN public.canteens c ON c.id = o.canteen_id
    WHERE o.user_id = v_user_id
      AND o.status = 'READY'::public.order_status
      AND o.ready_at IS NOT NULL
      AND (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) > clock_timestamp()
      AND (
        (
          (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) <= (clock_timestamp() + interval '2 minutes')
          AND o.reminder_2_sent_at IS NULL
        )
        OR
        (
          (o.ready_at + (coalesce(c.hold_minutes, 15) * interval '1 minute')) <= (clock_timestamp() + interval '5 minutes')
          AND o.reminder_5_sent_at IS NULL
        )
      )
    ORDER BY o.ready_at ASC
    LIMIT 20
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_deadline := v_rec.ready_at + (v_rec.hold_minutes * interval '1 minute');
    v_remaining := v_deadline - clock_timestamp();

    IF v_remaining <= interval '2 minutes' AND v_rec.reminder_2_sent_at IS NULL THEN
      INSERT INTO public.notifications (
        user_id,
        order_id,
        title,
        body
      ) VALUES (
        v_user_id,
        v_rec.id,
        'Final Call: 2 Minutes Left',
        'Order #' || v_rec.order_code || ' will expire in 2 minutes. Please collect it from the counter now!'
      );

      UPDATE public.orders
      SET reminder_2_sent_at = clock_timestamp(),
          reminder_5_sent_at = coalesce(reminder_5_sent_at, clock_timestamp())
      WHERE id = v_rec.id;

      v_count := v_count + 1;

    ELSIF v_remaining <= interval '5 minutes' AND v_rec.reminder_5_sent_at IS NULL THEN
      INSERT INTO public.notifications (
        user_id,
        order_id,
        title,
        body
      ) VALUES (
        v_user_id,
        v_rec.id,
        'Pickup Reminder: 5 Minutes Left',
        'Your order #' || v_rec.order_code || ' is ready at the counter. Please collect it within the next 5 minutes.'
      );

      UPDATE public.orders
      SET reminder_5_sent_at = clock_timestamp()
      WHERE id = v_rec.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sent_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_my_pickup_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_my_pickup_reminders() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

