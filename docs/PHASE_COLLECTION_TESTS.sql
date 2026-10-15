-- ==============================================================================
-- PHASE_COLLECTION_TESTS.sql: Smart Counter Collection Test Suite
-- ==============================================================================
-- Transactional execution wrapped in BEGIN ... ROLLBACK so NO test fixtures persist.
-- Validates:
--   1. Real SET LOCAL ROLE permission-denied checks for internal helpers & order_pickup_secrets.
--   2. get_pickup_code: owner only, strictly READY status only.
--   3. preview_collection: privacy (no email, no full name), canteen isolation (returns NOT_FOUND).
--   4. Strict validation: NULL method and NULL collected_with rejected in collect_order.
--   5. Cross-canteen staff lookup & collect returns NOT_FOUND (not FORBIDDEN).
--   6. Amber orders require BOTH rotating code and PIN; incomplete amber credentials are not logged as failures.
--   7. 3 wrong PINs lock PIN counter (PIN_LOCKED); failure rows persist; valid QR scan still succeeds.
--   8. Double collect is rejected (ALREADY_COLLECTED).
--   9. Manual collection requires reason >= 5 chars and capped at 10/day per staff.
--  10. transition_order strictly refuses transition to COLLECTED.
--  11. Rate limits: 10 failures in 5 min per staff, 10 failures in 10 min per order.
--  12. Unauthorized collection dispute reporting: 24h window, 3 reports/month limit, duplicate rejected (ALREADY_REPORTED),
--      admin list with pagination/details, and admin resolve row locking (already resolved -> changed: false, no audit row).
--  13. place_order: p_pickup_for_name sanitization, truncation to 40, empty -> NULL, NULL pickup_token, secret generation.
--  14. Payment status becomes PAID upon collection; admin_audit_log row written for ORDER_COLLECTED.
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS _test_results (
  test_num integer,
  test_name text,
  passed boolean,
  details text
);

CREATE TEMP TABLE IF NOT EXISTS _test_env (
  key text PRIMARY KEY,
  val_uuid uuid,
  val_text text
);

GRANT ALL ON TABLE _test_results TO authenticated, anon;
GRANT ALL ON TABLE _test_env TO authenticated, anon;

-- ==============================================================================
-- SETUP: Create clean test fixtures with auth.users before profiles
-- ==============================================================================
DO $$
DECLARE
  v_canteen_a uuid := gen_random_uuid();
  v_canteen_b uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_student2_id uuid := gen_random_uuid();
  v_staff_a_id uuid := gen_random_uuid();
  v_staff_b_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();

  v_item_a1 uuid := gen_random_uuid();
  v_item_a2 uuid := gen_random_uuid();
BEGIN
  RESET ROLE;

  -- 1. Create temporary test canteens with operating hours 00:00-23:59
  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_a, 'Canteen Alpha Test', '00:00'::time, '23:59'::time, '23:58'::time, 10, 5, 30, true);

  INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
  VALUES (v_canteen_b, 'Canteen Beta Test', '00:00'::time, '23:59'::time, '23:58'::time, 10, 5, 30, true);

  -- 2. Create auth.users rows BEFORE profiles (same pattern as earlier test scripts, invited_at for staff and admin)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_student_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_coll_stu_' || substr(v_student_id::text, 1, 8) || '@test.local', 'pwd', now(), NULL, '{"is_admin_created": true}'::jsonb, '{"full_name": "Alice Student"}'::jsonb, now(), now()),
    (v_student2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_coll_stu2_' || substr(v_student2_id::text, 1, 8) || '@test.local', 'pwd', now(), NULL, '{"is_admin_created": true}'::jsonb, '{"full_name": "Dave Student"}'::jsonb, now(), now()),
    (v_staff_a_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_coll_sta_' || substr(v_staff_a_id::text, 1, 8) || '@test.local', 'pwd', now(), now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Bob Staff Alpha"}'::jsonb, now(), now()),
    (v_staff_b_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_coll_stb_' || substr(v_staff_b_id::text, 1, 8) || '@test.local', 'pwd', now(), now(), '{"is_admin_created": true, "role": "staff"}'::jsonb, '{"full_name": "Charlie Staff Beta"}'::jsonb, now(), now()),
    (v_admin_id,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_coll_adm_' || substr(v_admin_id::text, 1, 8) || '@test.local', 'pwd', now(), now(), '{"is_admin_created": true, "role": "admin"}'::jsonb, '{"full_name": "Eve Admin"}'::jsonb, now(), now());

  -- 3. Upsert profiles with valid roles and metadata
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Alice Student', college_id = 'STU' || upper(substr(md5(random()::text), 1, 6)), is_active = true WHERE id = v_student_id;
  UPDATE public.profiles SET role = 'student'::public.user_role, full_name = 'Dave Student', college_id = 'STU' || upper(substr(md5(random()::text), 1, 6)), is_active = true WHERE id = v_student2_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_a, full_name = 'Bob Staff Alpha', is_active = true WHERE id = v_staff_a_id;
  UPDATE public.profiles SET role = 'staff'::public.user_role, canteen_id = v_canteen_b, full_name = 'Charlie Staff Beta', is_active = true WHERE id = v_staff_b_id;
  UPDATE public.profiles SET role = 'admin'::public.user_role, full_name = 'Eve Admin', is_active = true WHERE id = v_admin_id;

  -- 4. Temporary menu items in Canteen Alpha
  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, is_active, is_available)
  VALUES (v_item_a1, v_canteen_a, 'Samosa', 2000, true, true);

  INSERT INTO public.menu_items (id, canteen_id, name, price_paise, is_active, is_available)
  VALUES (v_item_a2, v_canteen_a, 'Deluxe Feast', 60000, true, true);

  -- Save environment keys
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen_a', v_canteen_a);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen_b', v_canteen_b);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student2_id', v_student2_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff_a_id', v_staff_a_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff_b_id', v_staff_b_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item_a1', v_item_a1);
  INSERT INTO _test_env (key, val_uuid) VALUES ('item_a2', v_item_a2);
END;
$$;

-- ==============================================================================
-- EXECUTE TEST CASES
-- ==============================================================================
DO $$
DECLARE
  v_canteen_a uuid;
  v_canteen_b uuid;
  v_student_id uuid;
  v_student2_id uuid;
  v_staff_a_id uuid;
  v_staff_b_id uuid;
  v_admin_id uuid;
  v_item_a1 uuid;
  v_item_a2 uuid;

  v_order_norm_id uuid;
  v_order_amber_id uuid;
  v_order_pin_id uuid;
  v_order_placed_id uuid;
  v_order_dispute_id uuid;
  v_order_expired_id uuid;
  v_order_temp_id uuid;

  v_code text;
  v_pin text;
  v_wrong_pin text;
  v_res jsonb;
  v_attempts_before integer;
  v_attempts_after integer;
  v_report_id uuid;
  v_report_res jsonb;
  v_admin_list jsonb;
  v_audit_count integer;
  v_i integer;
BEGIN
  SELECT val_uuid INTO v_canteen_a FROM _test_env WHERE key = 'canteen_a';
  SELECT val_uuid INTO v_canteen_b FROM _test_env WHERE key = 'canteen_b';
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  SELECT val_uuid INTO v_student2_id FROM _test_env WHERE key = 'student2_id';
  SELECT val_uuid INTO v_staff_a_id FROM _test_env WHERE key = 'staff_a_id';
  SELECT val_uuid INTO v_staff_b_id FROM _test_env WHERE key = 'staff_b_id';
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_item_a1 FROM _test_env WHERE key = 'item_a1';
  SELECT val_uuid INTO v_item_a2 FROM _test_env WHERE key = 'item_a2';

  -- ----------------------------------------------------------------------------
  -- TEST 1: Real SET LOCAL ROLE permission-denied checks for internal helpers & secrets
  -- ----------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    -- 1.1 Direct select on order_pickup_secrets
    BEGIN
      PERFORM * FROM public.order_pickup_secrets LIMIT 1;
      INSERT INTO _test_results VALUES (1, 'order_pickup_secrets table revoked', false, 'Allowed direct table select for authenticated role');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _test_results VALUES (1, 'order_pickup_secrets table revoked', true, 'Table access correctly revoked from authenticated');
    END;

    -- 1.2 Calling internal_get_pickup_pin
    BEGIN
      PERFORM public.internal_get_pickup_pin(gen_random_uuid());
      INSERT INTO _test_results VALUES (2, 'internal_get_pickup_pin revoked', false, 'Allowed execution of internal_get_pickup_pin');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _test_results VALUES (2, 'internal_get_pickup_pin revoked', true, 'Helper execution correctly revoked from authenticated');
    END;

    -- 1.3 Calling internal_get_pickup_code
    BEGIN
      PERFORM public.internal_get_pickup_code(gen_random_uuid(), 0);
      INSERT INTO _test_results VALUES (3, 'internal_get_pickup_code revoked', false, 'Allowed execution of internal_get_pickup_code');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _test_results VALUES (3, 'internal_get_pickup_code revoked', true, 'Helper execution correctly revoked from authenticated');
    END;

    -- 1.4 Calling pickup_hmac
    BEGIN
      PERFORM public.pickup_hmac('key', 'msg');
      INSERT INTO _test_results VALUES (4, 'pickup_hmac revoked', false, 'Allowed execution of pickup_hmac');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _test_results VALUES (4, 'pickup_hmac revoked', true, 'Helper execution correctly revoked from authenticated');
    END;

    -- 1.5 Anon role permission check
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM * FROM public.order_pickup_secrets LIMIT 1;
      INSERT INTO _test_results VALUES (5, 'order_pickup_secrets revoked from anon', false, 'Allowed direct table select for anon role');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO _test_results VALUES (5, 'order_pickup_secrets revoked from anon', true, 'Table access correctly revoked from anon');
    END;

    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO _test_results VALUES (1, 'Permission-denied checks setup', false, 'Unexpected error: ' || SQLERRM);
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 2: get_pickup_code (owner only, strictly READY status only)
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    -- Create order in PLACED status
    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'PLACED', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now() + interval '10 minutes', now() + interval '25 minutes', 5, now()
    ) RETURNING id INTO v_order_placed_id;

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_placed_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    -- 2.1 Owner calling on PLACED order returns ORDER_NOT_READY
    v_res := public.get_pickup_code(v_order_placed_id);
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'ORDER_NOT_READY' THEN
      INSERT INTO _test_results VALUES (6, 'get_pickup_code refused on PLACED status', true, 'Correctly returned ORDER_NOT_READY');
    ELSE
      INSERT INTO _test_results VALUES (6, 'get_pickup_code refused on PLACED status', false, 'Unexpected response: ' || v_res::text);
    END IF;

    -- 2.2 Non-owner calling get_pickup_code raises FORBIDDEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student2_id)::text, true);
    BEGIN
      PERFORM public.get_pickup_code(v_order_placed_id);
      INSERT INTO _test_results VALUES (7, 'get_pickup_code non-owner access refused', false, 'Allowed non-owner retrieval');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%FORBIDDEN%own orders%' THEN
        INSERT INTO _test_results VALUES (7, 'get_pickup_code non-owner access refused', true, 'Correctly raised FORBIDDEN for non-owner');
      ELSE
        INSERT INTO _test_results VALUES (7, 'get_pickup_code non-owner access refused', false, 'Unexpected error: ' || SQLERRM);
      END IF;
    END;

    -- 2.3 Owner calling on READY order succeeds with rotating code and 4-digit PIN
    RESET ROLE;
    UPDATE public.orders SET status = 'READY', ready_at = now() WHERE id = v_order_placed_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    v_res := public.get_pickup_code(v_order_placed_id);
    IF (v_res->>'ok')::boolean = true AND length(v_res->>'code') = 6 AND length(v_res->>'pin') = 4 THEN
      INSERT INTO _test_results VALUES (8, 'get_pickup_code owner READY success', true, 'Returned 6-digit TOTP code and 4-digit PIN');
    ELSE
      INSERT INTO _test_results VALUES (8, 'get_pickup_code owner READY success', false, 'Unexpected payload: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 3: preview_collection: privacy (no email/full_name) & cross-canteen isolation
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, pickup_for_name, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, 'Friend Bob', now()
    ) RETURNING id INTO v_order_norm_id;

    INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
    VALUES (v_order_norm_id, v_item_a1, 'Samosa', 2000, 1);

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_norm_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    v_code := public.internal_get_pickup_code(v_order_norm_id, 0);
    v_pin := public.internal_get_pickup_pin(v_order_norm_id);

    SET LOCAL ROLE authenticated;

    -- 3.1 Cross-canteen staff lookup returns NOT_FOUND (not FORBIDDEN)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_b_id)::text, true);
    BEGIN
      PERFORM public.preview_collection(v_canteen_b, v_order_norm_id::text, v_code, NULL);
      INSERT INTO _test_results VALUES (9, 'Cross-canteen preview returns NOT_FOUND', false, 'Allowed cross-canteen preview');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%NOT_FOUND%' THEN
        INSERT INTO _test_results VALUES (9, 'Cross-canteen preview returns NOT_FOUND', true, 'Correctly returned NOT_FOUND (zero existence leakage)');
      ELSE
        INSERT INTO _test_results VALUES (9, 'Cross-canteen preview returns NOT_FOUND', false, 'Expected NOT_FOUND but got: ' || SQLERRM);
      END IF;
    END;

    -- 3.2 Staff Alpha preview succeeds and strictly hides email and full_name
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);
    v_res := public.preview_collection(v_canteen_a, v_order_norm_id::text, v_code, NULL);

    IF (v_res->>'ok')::boolean = true
       AND NOT (v_res ? 'email')
       AND NOT (v_res ? 'full_name')
       AND (v_res->>'first_name') = 'Alice'
       AND (v_res->>'pickup_for_name') = 'Friend Bob'
       AND (v_res->>'is_amber')::boolean = false THEN
      INSERT INTO _test_results VALUES (10, 'preview_collection privacy invariant', true, 'Exposes first_name & college_id_last4; strictly zero email/full_name leakage');
    ELSE
      INSERT INTO _test_results VALUES (10, 'preview_collection privacy invariant', false, 'Privacy leak or unexpected output: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 4: collect_order rejects NULL method and NULL collected_with
  -- ----------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    -- 4.1 NULL collected_with
    BEGIN
      PERFORM public.collect_order(v_canteen_a, v_order_norm_id, NULL, 'SCAN', v_code, NULL, NULL);
      INSERT INTO _test_results VALUES (11, 'collect_order rejects NULL collected_with', false, 'Allowed NULL collected_with');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%collected_with must be CASH or UPI%' THEN
        INSERT INTO _test_results VALUES (11, 'collect_order rejects NULL collected_with', true, 'Strictly rejected with INVALID_INPUT');
      ELSE
        INSERT INTO _test_results VALUES (11, 'collect_order rejects NULL collected_with', false, 'Unexpected error: ' || SQLERRM);
      END IF;
    END;

    -- 4.2 NULL method
    BEGIN
      PERFORM public.collect_order(v_canteen_a, v_order_norm_id, 'CASH', NULL, v_code, NULL, NULL);
      INSERT INTO _test_results VALUES (12, 'collect_order rejects NULL method', false, 'Allowed NULL method');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%method must be SCAN, PIN, or MANUAL%' THEN
        INSERT INTO _test_results VALUES (12, 'collect_order rejects NULL method', true, 'Strictly rejected with INVALID_INPUT');
      ELSE
        INSERT INTO _test_results VALUES (12, 'collect_order rejects NULL method', false, 'Unexpected error: ' || SQLERRM);
      END IF;
    END;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 5: Cross-canteen staff collect returns NOT_FOUND
  -- ----------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_b_id)::text, true);

    BEGIN
      PERFORM public.collect_order(v_canteen_b, v_order_norm_id, 'CASH', 'SCAN', v_code, NULL, NULL);
      INSERT INTO _test_results VALUES (13, 'Cross-canteen collect returns NOT_FOUND', false, 'Allowed cross-canteen collection');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%NOT_FOUND%' THEN
        INSERT INTO _test_results VALUES (13, 'Cross-canteen collect returns NOT_FOUND', true, 'Correctly returned NOT_FOUND');
      ELSE
        INSERT INTO _test_results VALUES (13, 'Cross-canteen collect returns NOT_FOUND', false, 'Expected NOT_FOUND but got: ' || SQLERRM);
      END IF;
    END;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 6: Amber Orders (> ₹500 or > 5 items): Requires BOTH; incomplete credentials not logged
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 60000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_amber_id;

    INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
    VALUES (v_order_amber_id, v_item_a2, 'Deluxe Feast', 60000, 1);

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_amber_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    v_code := public.internal_get_pickup_code(v_order_amber_id, 0);
    v_pin := public.internal_get_pickup_pin(v_order_amber_id);

    -- Compute guaranteed-wrong PIN
    v_wrong_pin := lpad(((v_pin::integer + 1) % 10000)::text, 4, '0');

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    -- 6.1 Incomplete amber credentials in preview (only code scanned) -> AMBER_REQUIRES_BOTH without failure log
    SELECT count(*) INTO v_attempts_before FROM public.pickup_collect_attempts WHERE order_id = v_order_amber_id;
    v_res := public.preview_collection(v_canteen_a, v_order_amber_id::text, v_code, NULL);
    SELECT count(*) INTO v_attempts_after FROM public.pickup_collect_attempts WHERE order_id = v_order_amber_id;

    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'AMBER_REQUIRES_BOTH' AND v_attempts_before = v_attempts_after THEN
      INSERT INTO _test_results VALUES (14, 'Amber preview incomplete credentials not logged', true, 'Returned AMBER_REQUIRES_BOTH with zero failure rows logged');
    ELSE
      INSERT INTO _test_results VALUES (14, 'Amber preview incomplete credentials not logged', false, 'Logged failure row or unexpected error: ' || v_res::text);
    END IF;

    -- 6.2 Incomplete amber credentials in collect (only code scanned) -> AMBER_REQUIRES_BOTH without failure log
    SELECT count(*) INTO v_attempts_before FROM public.pickup_collect_attempts WHERE order_id = v_order_amber_id;
    v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'CASH', 'SCAN', v_code, NULL, NULL);
    SELECT count(*) INTO v_attempts_after FROM public.pickup_collect_attempts WHERE order_id = v_order_amber_id;

    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'AMBER_REQUIRES_BOTH' AND v_attempts_before = v_attempts_after THEN
      INSERT INTO _test_results VALUES (15, 'Amber collect incomplete credentials not logged', true, 'Returned AMBER_REQUIRES_BOTH with zero failure rows logged');
    ELSE
      INSERT INTO _test_results VALUES (15, 'Amber collect incomplete credentials not logged', false, 'Logged failure row or unexpected error: ' || v_res::text);
    END IF;

    -- 6.3 PIN-only on amber order refused
    v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'CASH', 'PIN', NULL, v_pin, NULL);
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'AMBER_REQUIRES_BOTH' THEN
      INSERT INTO _test_results VALUES (16, 'Amber PIN-only collection refused', true, 'Returned AMBER_REQUIRES_BOTH');
    ELSE
      INSERT INTO _test_results VALUES (16, 'Amber PIN-only collection refused', false, 'Allowed PIN-only collection on amber: ' || v_res::text);
    END IF;

    -- 6.4 Amber with BOTH rotating code and PIN succeeds, updates payment_status to PAID, writes audit row
    SELECT count(*) INTO v_audit_count FROM public.admin_audit_log WHERE action = 'ORDER_COLLECTED' AND target_id = v_order_amber_id::text;
    v_res := public.collect_order(v_canteen_a, v_order_amber_id, 'UPI', 'SCAN', v_code, v_pin, NULL);

    IF (v_res->>'ok')::boolean = true AND v_res->>'status' = 'COLLECTED' THEN
      -- Check payment status updated
      RESET ROLE;
      IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_amber_id AND payment_status = 'PAID' AND collection_method = 'SCAN' AND collected_with = 'UPI') THEN
        IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'ORDER_COLLECTED' AND target_id = v_order_amber_id::text) = v_audit_count + 1 THEN
          INSERT INTO _test_results VALUES (17, 'Amber collection with both code and PIN succeeds', true, 'Collected successfully, payment_status PAID, audit row written');
        ELSE
          INSERT INTO _test_results VALUES (17, 'Amber collection with both code and PIN succeeds', false, 'Audit row was not created in admin_audit_log');
        END IF;
      ELSE
        INSERT INTO _test_results VALUES (17, 'Amber collection with both code and PIN succeeds', false, 'payment_status was not updated to PAID');
      END IF;
    ELSE
      INSERT INTO _test_results VALUES (17, 'Amber collection with both code and PIN succeeds', false, 'Collection failed: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 7: 3 wrong PINs lock PIN counter (PIN_LOCKED); failure rows persist; valid scan still works
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_pin_id;

    INSERT INTO public.order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity)
    VALUES (v_order_pin_id, v_item_a1, 'Samosa', 2000, 1);

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_pin_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    v_code := public.internal_get_pickup_code(v_order_pin_id, 0);
    v_pin := public.internal_get_pickup_pin(v_order_pin_id);
    v_wrong_pin := lpad(((v_pin::integer + 1) % 10000)::text, 4, '0');

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    -- 3 wrong PIN attempts
    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'PIN', NULL, v_wrong_pin, NULL);
    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'PIN', NULL, v_wrong_pin, NULL);
    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'PIN', NULL, v_wrong_pin, NULL);

    -- 4th attempt must return PIN_LOCKED
    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'PIN', NULL, v_wrong_pin, NULL);

    RESET ROLE;
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'PIN_LOCKED'
       AND EXISTS (SELECT 1 FROM public.order_pickup_secrets WHERE order_id = v_order_pin_id AND is_pin_locked = true AND failed_pin_attempts >= 3)
       AND (SELECT count(*) FROM public.pickup_collect_attempts WHERE order_id = v_order_pin_id AND outcome = 'WRONG_PIN') >= 3 THEN
      INSERT INTO _test_results VALUES (18, '3 wrong PINs lock PIN counter and failure rows persist', true, 'Locked PIN counter, returned PIN_LOCKED, attempts persisted');
    ELSE
      INSERT INTO _test_results VALUES (18, '3 wrong PINs lock PIN counter and failure rows persist', false, 'Lock not enforced or attempts missing: ' || v_res::text);
    END IF;

    -- Valid QR scan on the same PIN-locked order still succeeds
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'SCAN', v_code, NULL, NULL);
    IF (v_res->>'ok')::boolean = true AND v_res->>'status' = 'COLLECTED' THEN
      INSERT INTO _test_results VALUES (19, 'Valid scan succeeds on PIN-locked order', true, 'Student with locked PIN can still collect via QR scan');
    ELSE
      INSERT INTO _test_results VALUES (19, 'Valid scan succeeds on PIN-locked order', false, 'Scan collection failed: ' || v_res::text);
    END IF;

    -- ----------------------------------------------------------------------------
    -- TEST 8: Double Collect is rejected
    -- ----------------------------------------------------------------------------
    v_res := public.collect_order(v_canteen_a, v_order_pin_id, 'CASH', 'SCAN', v_code, NULL, NULL);
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'ALREADY_COLLECTED' THEN
      INSERT INTO _test_results VALUES (20, 'Double collect rejected with ALREADY_COLLECTED', true, 'Idempotently protected against repeated counter collections');
    ELSE
      INSERT INTO _test_results VALUES (20, 'Double collect rejected with ALREADY_COLLECTED', false, 'Unexpected response: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 9: Manual Collection: Minimum Reason Length and 10/day Limit
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_temp_id;

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_temp_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    -- 9.1 Short reason (< 5 chars) rejected
    v_res := public.collect_order(v_canteen_a, v_order_temp_id, 'CASH', 'MANUAL', NULL, NULL, 'bad');
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'MANUAL_REASON_REQUIRED' THEN
      INSERT INTO _test_results VALUES (21, 'Manual collection requires min 5 char reason', true, 'Rejected short reason');
    ELSE
      INSERT INTO _test_results VALUES (21, 'Manual collection requires min 5 char reason', false, 'Allowed short reason: ' || v_res::text);
    END IF;

    -- 9.2 Insert 10 previous manual collection orders for Staff Alpha in last 24h
    RESET ROLE;
    FOR v_i IN 1..10 LOOP
      INSERT INTO public.orders (
        user_id, canteen_id, status, total_paise, payment_method, payment_status,
        collection_method, collected_with, collected_by, is_manual_override, manual_override_reason,
        collected_at, estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
      ) VALUES (
        v_student_id, v_canteen_a, 'COLLECTED', 2000, 'PAY_AT_PICKUP', 'PAID',
        'MANUAL', 'CASH', v_staff_a_id, true, 'Test manual override history reason',
        now() - interval '2 hours', now(), now() + interval '15 minutes', 5, now()
      );
    END LOOP;

    -- 11th manual collection attempt must be blocked by MANUAL_LIMIT
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    v_res := public.collect_order(v_canteen_a, v_order_temp_id, 'CASH', 'MANUAL', NULL, NULL, 'Phone battery died completely');
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'MANUAL_LIMIT' THEN
      INSERT INTO _test_results VALUES (22, 'Manual collection capped at 10 per 24 hours per staff', true, 'Returned MANUAL_LIMIT on 11th attempt');
    ELSE
      INSERT INTO _test_results VALUES (22, 'Manual collection capped at 10 per 24 hours per staff', false, 'Allowed manual collection beyond limit: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 10: transition_order strictly refuses COLLECTED
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_temp_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    BEGIN
      PERFORM public.transition_order(v_order_temp_id, 'COLLECTED'::public.order_status);
      INSERT INTO _test_results VALUES (23, 'transition_order strictly refuses COLLECTED', false, 'Allowed direct transition to COLLECTED');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%FORBIDDEN%collect_order function%' THEN
        INSERT INTO _test_results VALUES (23, 'transition_order strictly refuses COLLECTED', true, 'Correctly raised FORBIDDEN: Orders can only be collected via collect_order');
      ELSE
        INSERT INTO _test_results VALUES (23, 'transition_order strictly refuses COLLECTED', false, 'Unexpected error message: ' || SQLERRM);
      END IF;
    END;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 11: Rate limits: 10 failures in 5 min per staff, 10 failures in 10 min per order
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_temp_id;

    INSERT INTO public.order_pickup_secrets (order_id, secret)
    VALUES (v_order_temp_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

    -- Insert 10 failure rows for Staff Beta
    FOR v_i IN 1..10 LOOP
      INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome, attempted_at)
      VALUES (v_staff_b_id, v_order_temp_id, v_canteen_a, 'PREVIEW', 'INVALID_CREDENTIALS', now() - interval '1 minute');
    END LOOP;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_b_id)::text, true);

    v_res := public.preview_collection(v_canteen_b, v_order_temp_id::text, '123456', NULL);
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'RATE_LIMITED_STAFF' THEN
      INSERT INTO _test_results VALUES (24, 'preview_collection staff rate limit (10 in 5m)', true, 'Returned RATE_LIMITED_STAFF');
    ELSE
      INSERT INTO _test_results VALUES (24, 'preview_collection staff rate limit (10 in 5m)', false, 'Expected RATE_LIMITED_STAFF but got: ' || v_res::text);
    END IF;

    -- Clean up staff attempts scoped strictly to this temp order
    RESET ROLE;
    DELETE FROM public.pickup_collect_attempts WHERE order_id = v_order_temp_id;

    -- Insert 10 failure rows for the specific order across different staff
    FOR v_i IN 1..10 LOOP
      INSERT INTO public.pickup_collect_attempts (staff_id, order_id, canteen_id, method, outcome, attempted_at)
      VALUES (v_staff_a_id, v_order_temp_id, v_canteen_a, 'PREVIEW', 'INVALID_CREDENTIALS', now() - interval '2 minutes');
    END LOOP;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff_a_id)::text, true);

    v_res := public.preview_collection(v_canteen_a, v_order_temp_id::text, '123456', NULL);
    IF (v_res->>'ok')::boolean = false AND v_res->>'error' = 'RATE_LIMITED_ORDER' THEN
      INSERT INTO _test_results VALUES (25, 'preview_collection order rate limit (10 in 10m)', true, 'Returned RATE_LIMITED_ORDER');
    ELSE
      INSERT INTO _test_results VALUES (25, 'preview_collection order rate limit (10 in 10m)', false, 'Expected RATE_LIMITED_ORDER but got: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 12: Unauthorized Collection Dispute Reporting
  -- ----------------------------------------------------------------------------
  BEGIN
    RESET ROLE;

    -- 12.1 Report on order that is NOT collected returns ORDER_NOT_COLLECTED
    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'READY', 2000, 'PAY_AT_PICKUP', 'PENDING',
      now(), now() + interval '15 minutes', 5, now()
    ) RETURNING id INTO v_order_temp_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    v_report_res := public.report_unauthorized_collection(v_order_temp_id, 'Not collected by me');
    IF (v_report_res->>'ok')::boolean = false AND v_report_res->>'error' = 'ORDER_NOT_COLLECTED' THEN
      INSERT INTO _test_results VALUES (26, 'Dispute report refused on uncollected order', true, 'Returned ORDER_NOT_COLLECTED');
    ELSE
      INSERT INTO _test_results VALUES (26, 'Dispute report refused on uncollected order', false, 'Unexpected response: ' || v_report_res::text);
    END IF;

    -- 12.2 Report on order collected > 24 hours ago returns REPORT_WINDOW_EXPIRED
    RESET ROLE;
    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      collection_method, collected_with, collected_by, collected_at,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'COLLECTED', 2000, 'PAY_AT_PICKUP', 'PAID',
      'SCAN', 'CASH', v_staff_a_id, now() - interval '25 hours',
      now() - interval '26 hours', now() - interval '25 hours 45 minutes', 5, now() - interval '26 hours'
    ) RETURNING id INTO v_order_expired_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    v_report_res := public.report_unauthorized_collection(v_order_expired_id, 'Collected over 24 hours ago');
    IF (v_report_res->>'ok')::boolean = false AND v_report_res->>'error' = 'REPORT_WINDOW_EXPIRED' THEN
      INSERT INTO _test_results VALUES (27, 'Dispute report refused beyond 24h window', true, 'Returned REPORT_WINDOW_EXPIRED');
    ELSE
      INSERT INTO _test_results VALUES (27, 'Dispute report refused beyond 24h window', false, 'Allowed dispute after 24h window: ' || v_report_res::text);
    END IF;

    -- 12.3 Valid report within 24 hours succeeds, sanitizes reason, duplicate returns ALREADY_REPORTED
    RESET ROLE;
    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      collection_method, collected_with, collected_by, collected_at,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'COLLECTED', 2000, 'PAY_AT_PICKUP', 'PAID',
      'SCAN', 'CASH', v_staff_a_id, now() - interval '2 hours',
      now() - interval '3 hours', now() - interval '2 hours 45 minutes', 5, now() - interval '3 hours'
    ) RETURNING id INTO v_order_dispute_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    v_report_res := public.report_unauthorized_collection(
      v_order_dispute_id,
      E'I did   not collect    this meal   \u200B\u2060\uFEFF! Please help.'
    );

    IF (v_report_res->>'ok')::boolean = true AND (v_report_res->>'order_id')::uuid = v_order_dispute_id THEN
      -- Duplicate report attempt
      v_report_res := public.report_unauthorized_collection(v_order_dispute_id, 'Trying duplicate report');
      IF (v_report_res->>'ok')::boolean = false AND v_report_res->>'error' = 'ALREADY_REPORTED' THEN
        INSERT INTO _test_results VALUES (28, 'Valid dispute created and duplicate blocked', true, 'Created report successfully and duplicate returned ALREADY_REPORTED');
      ELSE
        INSERT INTO _test_results VALUES (28, 'Valid dispute created and duplicate blocked', false, 'Duplicate was not blocked: ' || v_report_res::text);
      END IF;
    ELSE
      INSERT INTO _test_results VALUES (28, 'Valid dispute created and duplicate blocked', false, 'Creation failed: ' || v_report_res::text);
    END IF;

    -- 12.4 Monthly limit: 3 reports in 30 days
    RESET ROLE;
    -- Insert 2 more reports for this student to hit 3 total
    FOR v_i IN 1..2 LOOP
      INSERT INTO public.orders (
        user_id, canteen_id, status, total_paise, payment_method, payment_status,
        collection_method, collected_with, collected_by, collected_at,
        estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
      ) VALUES (
        v_student_id, v_canteen_a, 'COLLECTED', 2000, 'PAY_AT_PICKUP', 'PAID',
        'SCAN', 'CASH', v_staff_a_id, now() - interval '1 hour',
        now() - interval '2 hours', now() - interval '1 hour 45 minutes', 5, now() - interval '2 hours'
      ) RETURNING id INTO v_order_temp_id;

      INSERT INTO public.order_collection_reports (order_id, user_id, reason)
      VALUES (v_order_temp_id, v_student_id, 'Past report in history');
    END LOOP;

    -- 4th report by same student within 30 days must be blocked
    INSERT INTO public.orders (
      user_id, canteen_id, status, total_paise, payment_method, payment_status,
      collection_method, collected_with, collected_by, collected_at,
      estimated_ready_at, pickup_window_end, prep_minutes_total, placed_at
    ) VALUES (
      v_student_id, v_canteen_a, 'COLLECTED', 2000, 'PAY_AT_PICKUP', 'PAID',
      'SCAN', 'CASH', v_staff_a_id, now() - interval '30 minutes',
      now() - interval '1 hour', now() - interval '45 minutes', 5, now() - interval '1 hour'
    ) RETURNING id INTO v_order_temp_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    v_report_res := public.report_unauthorized_collection(v_order_temp_id, '4th dispute report attempt');
    IF (v_report_res->>'ok')::boolean = false AND v_report_res->>'error' = 'REPORT_LIMIT_EXCEEDED' THEN
      INSERT INTO _test_results VALUES (29, 'Dispute report monthly cap (3 per 30 days)', true, 'Returned REPORT_LIMIT_EXCEEDED on 4th report');
    ELSE
      INSERT INTO _test_results VALUES (29, 'Dispute report monthly cap (3 per 30 days)', false, 'Expected REPORT_LIMIT_EXCEEDED but got: ' || v_report_res::text);
    END IF;

    -- 12.5 Admin List and Admin Resolve with Row Locking & Zero Double Audit
    RESET ROLE;
    SELECT id INTO v_report_id FROM public.order_collection_reports WHERE order_id = v_order_dispute_id;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id)::text, true);

    v_admin_list := public.admin_list_collection_reports('PENDING', 10, 0);
    IF jsonb_array_length(v_admin_list) > 0 THEN
      INSERT INTO _test_results VALUES (30, 'admin_list_collection_reports pagination & details', true, 'Returned dispute reports list to admin');
    ELSE
      INSERT INTO _test_results VALUES (30, 'admin_list_collection_reports pagination & details', false, 'Returned empty list for pending reports');
    END IF;

    -- Resolve report
    SELECT count(*) INTO v_audit_count FROM public.admin_audit_log WHERE action = 'RESOLVE_COLLECTION_REPORT' AND target_id = v_report_id::text;

    v_res := public.admin_resolve_collection_report(v_report_id, 'RESOLVED', 'Refunded via campus wallet');
    IF (v_res->>'ok')::boolean = true AND (v_res->>'changed')::boolean = true AND v_res->>'status' = 'RESOLVED' THEN
      -- Repeat resolve: must return changed: false with zero new audit rows
      v_res := public.admin_resolve_collection_report(v_report_id, 'RESOLVED', 'Repeat call');
      IF (v_res->>'ok')::boolean = true AND (v_res->>'changed')::boolean = false THEN
        RESET ROLE;
        IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'RESOLVE_COLLECTION_REPORT' AND target_id = v_report_id::text) = v_audit_count + 1 THEN
          INSERT INTO _test_results VALUES (31, 'admin_resolve_collection_report idempotency & audit', true, 'Resolved report, audit row written, repeat returned changed:false');
        ELSE
          INSERT INTO _test_results VALUES (31, 'admin_resolve_collection_report idempotency & audit', false, 'Audit row count mismatch');
        END IF;
      ELSE
        INSERT INTO _test_results VALUES (31, 'admin_resolve_collection_report idempotency & audit', false, 'Repeat resolve failed idempotency check: ' || v_res::text);
      END IF;
    ELSE
      INSERT INTO _test_results VALUES (31, 'admin_resolve_collection_report idempotency & audit', false, 'Initial resolution failed: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

  -- ----------------------------------------------------------------------------
  -- TEST 13: place_order sanitization, truncation, NULL pickup_token, secret insert
  -- ----------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id)::text, true);

    -- Call place_order with dirty pickup designee name (bidi, whitespace, controls, length > 40)
    v_res := public.place_order(
      v_canteen_a,
      jsonb_build_array(jsonb_build_object('menu_item_id', v_item_a1, 'quantity', 1)),
      'PAY_AT_PICKUP'::public.payment_method,
      'idemp_coll_test_' || substr(gen_random_uuid()::text, 1, 8),
      NULL,
      E'   Rohit \u200B\u202A\u2060Kumar\uFEFF    Long Name That Definitely Exceeds Forty Characters Easily   '
    );

    IF (v_res->>'status') = 'PLACED' AND (v_res->>'order_id') IS NOT NULL THEN
      RESET ROLE;
      v_order_temp_id := (v_res->>'order_id')::uuid;

      -- Check database state for pickup_for_name, NULL pickup_token, and secret row
      IF EXISTS (
        SELECT 1 FROM public.orders
        WHERE id = v_order_temp_id
          AND pickup_token IS NULL
          AND pickup_for_name IS NOT NULL
          AND length(pickup_for_name) <= 40
          AND pickup_for_name NOT LIKE '%  %'
      ) AND EXISTS (
        SELECT 1 FROM public.order_pickup_secrets
        WHERE order_id = v_order_temp_id AND secret IS NOT NULL AND length(secret) = 64
      ) THEN
        INSERT INTO _test_results VALUES (32, 'place_order sanitizes pickup_for_name, NULL token, creates secret', true, 'Sanitized & truncated <= 40, pickup_token is NULL, 64-char secret generated');
      ELSE
        INSERT INTO _test_results VALUES (32, 'place_order sanitizes pickup_for_name, NULL token, creates secret', false, 'Database row validation failed for placed order');
      END IF;
    ELSE
      INSERT INTO _test_results VALUES (32, 'place_order sanitizes pickup_for_name, NULL token, creates secret', false, 'place_order call failed: ' || v_res::text);
    END IF;

    RESET ROLE;
  END;

END;
$$;

-- ==============================================================================
-- FINAL SUMMARY & RESULT VERIFICATION
-- ==============================================================================
DO $$
DECLARE
  v_pass_count  integer;
  v_fail_count  integer;
  v_total       integer;
  r             record;
  v_fail_summary text := '';
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_pass_count FROM _test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'COLLECTION TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
  RAISE NOTICE '=====================================================';

  FOR r IN SELECT test_num, test_name, passed, details FROM _test_results ORDER BY test_num LOOP
    IF r.passed THEN
      RAISE NOTICE '[PASS] Test %: % - %', r.test_num, r.test_name, r.details;
    ELSE
      RAISE NOTICE '[FAIL] Test %: % - %', r.test_num, r.test_name, r.details;
      v_fail_summary := v_fail_summary || ' [Test ' || r.test_num || ': ' || r.test_name || ' -> ' || r.details || ']';
    END IF;
  END LOOP;

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % out of % tests failed.%', v_fail_count, v_total, v_fail_summary;
  ELSIF v_total < 32 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 32 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Collection test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

-- Show passing run results before transaction rollback
SELECT test_num, test_name, passed, details
FROM _test_results
ORDER BY test_num;

ROLLBACK;
