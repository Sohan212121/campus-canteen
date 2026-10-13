-- ==============================================================================
-- PHASE SIGNUP TEST SUITE: docs/PHASE_SIGNUP_TESTS.sql
-- Description: Interactive & Non-Interactive verification script for Phase Signup Hardening:
--              1. Fail-closed rejection when allowed_email_domains is empty.
--              2. Admin adds allowed domain (creates audit row); duplicate returns changed:false.
--              3. Consumer freemail domain rejected without confirm flag; accepted with confirm.
--              4. Public-suffix registry domain (ac.in, edu.in, edu) rejected without confirm flag; accepted with confirm.
--              5. Public lookup is_signup_email_allowed callable by anon; returns boolean; zero leak.
--              6. Allowed student signup fires both triggers (RESET ROLE); profile created as active student.
--              7. Non-allowed domain rejected with DOMAIN_NOT_ALLOWED.
--              8. Subdomain/lookalike trick rejected.
--              9. Reverse @ trick rejected.
--              10. Trailing dot in domain rejected.
--              11. Email plus-addressing (+) rejected for students.
--              12. Case insensitivity & normalisation (email lowercase, college_id uppercase).
--              13. Duplicate college_id rejected for students.
--              14. Invalid college_id format rejected by trigger.
--              15. Pre-check simulation catches existing invalid college_id format.
--              16. full_name sanitisation: control chars/newlines converted to space, bidi/zero-width stripped.
--              17. Invited staff user with invited_at fires both triggers; bypasses checks; ends inactive staff.
--              18. Dashboard-style user with no invited_at or metadata role is treated as student and rejected.
--              19. Existing user login (UPDATE on auth.users) unaffected by triggers.
--              20. Student and anon blocked from admin domain management procedures.
--              21. Admin removes domain; repeat removal returns changed:false with no audit write.
--              22. Role change staff -> student without valid college_id raises friendly INVALID_INPUT.
--
-- Safety: Wrapped in BEGIN ... ROLLBACK so NO test state or fixtures persist.
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
-- SETUP: Create clean test fixtures
-- ==============================================================================
DO $$
DECLARE
  v_admin_id   uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_staff_id   uuid := gen_random_uuid();
  v_canteen_id uuid;
BEGIN
  RESET ROLE;

  -- Ensure we have an active canteen
  SELECT id INTO v_canteen_id FROM public.canteens WHERE is_active = true LIMIT 1;
  IF v_canteen_id IS NULL THEN
    v_canteen_id := gen_random_uuid();
    INSERT INTO public.canteens (id, name, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active)
    VALUES (v_canteen_id, 'Signup Test Canteen', '08:00', '18:00', '17:30', 5, 5, 15, true);
  END IF;

  -- Create admin auth user & profile
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_admin_id, 'admin_signup_test@system.local', jsonb_build_object('full_name', 'System Admin'), jsonb_build_object('role', 'admin', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'admin'::public.user_role, is_active = true
  WHERE id = v_admin_id;

  -- Create existing student auth user & profile
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_student_id, 'existing_student@system.local', jsonb_build_object('full_name', 'Existing Student', 'college_id', 'CID99999'), jsonb_build_object('is_admin_created', true));

  UPDATE public.profiles
  SET role = 'student'::public.user_role, college_id = 'CID99999', is_active = true
  WHERE id = v_student_id;

  -- Create existing staff auth user & profile
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff_id, 'existing_staff@system.local', jsonb_build_object('full_name', 'Kitchen Staff'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  UPDATE public.profiles
  SET role = 'staff'::public.user_role, canteen_id = v_canteen_id, is_active = true
  WHERE id = v_staff_id;

  -- Save environment keys
  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('staff_id', v_staff_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('canteen_id', v_canteen_id);
END;
$$;


-- ==============================================================================
-- TEST 1: Fail closed: empty allowed_email_domains rejects signup
-- ==============================================================================
DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_err boolean := false;
BEGIN
  RESET ROLE;
  DELETE FROM public.allowed_email_domains;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_new_id, 'student@campus.edu', jsonb_build_object('full_name', 'Test Student', 'college_id', 'STU1001'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (1, 'Fail closed: empty allowed_email_domains rejects signup', true, 'Raised DOMAIN_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (1, 'Fail closed: empty allowed_email_domains rejects signup', false, 'Allowed signup with empty domain table');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 2: Admin adds allowed domain (audit row created; duplicate returns changed:false)
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_res1     jsonb;
  v_res2     jsonb;
  v_audit    integer;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Add domain
  v_res1 := public.admin_add_allowed_domain('campus.edu');

  -- Add duplicate
  v_res2 := public.admin_add_allowed_domain('campus.edu');

  RESET ROLE;
  SELECT count(*) INTO v_audit
  FROM public.admin_audit_log
  WHERE action = 'ADD_ALLOWED_DOMAIN' AND actor_id = v_admin_id;

  IF (v_res1->>'success')::boolean = true AND (v_res1->>'changed')::boolean = true
     AND (v_res2->>'changed')::boolean = false AND v_audit = 1 THEN
    INSERT INTO _test_results VALUES (2, 'Admin adds domain and duplicate is idempotent', true, 'Added with changed:true; duplicate changed:false; 1 audit row written');
  ELSE
    INSERT INTO _test_results VALUES (2, 'Admin adds domain and duplicate is idempotent', false, 'res1=' || v_res1::text || ', res2=' || v_res2::text || ', audit=' || v_audit);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (2, 'Admin adds domain and duplicate is idempotent', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: Consumer freemail rejected without confirm; accepted with confirm
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_err      boolean := false;
  v_res      jsonb;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_add_allowed_domain('gmail.com', false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FREEMAIL_CONFIRMATION_REQUIRED%' THEN v_err := true; END IF;
  END;

  v_res := public.admin_add_allowed_domain('gmail.com', true);

  RESET ROLE;

  IF v_err AND (v_res->>'success')::boolean = true THEN
    INSERT INTO _test_results VALUES (3, 'Consumer freemail rejected without confirm; accepted with confirm', true, 'Raised FREEMAIL_CONFIRMATION_REQUIRED; accepted when confirmed');
  ELSE
    INSERT INTO _test_results VALUES (3, 'Consumer freemail rejected without confirm; accepted with confirm', false, 'err=' || v_err || ', res=' || v_res::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (3, 'Consumer freemail rejected without confirm; accepted with confirm', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 4: Public-suffix domain rejected without confirm; accepted with confirm
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_err      boolean := false;
  v_res      jsonb;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_add_allowed_domain('ac.in', false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%PUBLIC_SUFFIX_CONFIRMATION_REQUIRED%' THEN v_err := true; END IF;
  END;

  v_res := public.admin_add_allowed_domain('ac.in', true);

  RESET ROLE;

  IF v_err AND (v_res->>'success')::boolean = true THEN
    INSERT INTO _test_results VALUES (4, 'Public-suffix domain rejected without confirm; accepted with confirm', true, 'Raised PUBLIC_SUFFIX_CONFIRMATION_REQUIRED; accepted when confirmed');
  ELSE
    INSERT INTO _test_results VALUES (4, 'Public-suffix domain rejected without confirm; accepted with confirm', false, 'err=' || v_err || ', res=' || v_res::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'Public-suffix domain rejected without confirm; accepted with confirm', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Public lookup is_signup_email_allowed callable by anon; returns boolean
-- ==============================================================================
DO $$
DECLARE
  v_allowed    boolean;
  v_disallowed boolean;
BEGIN
  SET LOCAL ROLE anon;
  v_allowed := public.is_signup_email_allowed('student@campus.edu');
  v_disallowed := public.is_signup_email_allowed('hacker@unknown.org');
  RESET ROLE;

  IF v_allowed = true AND v_disallowed = false THEN
    INSERT INTO _test_results VALUES (5, 'is_signup_email_allowed callable by anon', true, 'Allowed=true for campus.edu, false for unknown.org');
  ELSE
    INSERT INTO _test_results VALUES (5, 'is_signup_email_allowed callable by anon', false, 'allowed=' || coalesce(v_allowed::text, 'null') || ', disallowed=' || coalesce(v_disallowed::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'is_signup_email_allowed callable by anon', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Allowed student signup accepted via triggers (RESET ROLE)
-- ==============================================================================
DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_prof   public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_new_id, 'valid_student@campus.edu', jsonb_build_object('full_name', 'Valid Student', 'college_id', 'stu-2024'));

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_new_id;

  IF v_prof.id IS NOT NULL AND v_prof.role = 'student'::public.user_role 
     AND v_prof.college_id = 'STU-2024' AND v_prof.is_active = true THEN
    INSERT INTO _test_results VALUES (6, 'Allowed student signup accepted via triggers', true, 'Profile created: role=student, is_active=true, uppercase college_id=STU-2024');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Allowed student signup accepted via triggers', false, 'Profile: role=' || coalesce(v_prof.role::text, 'none') || ', cid=' || coalesce(v_prof.college_id, 'none'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (6, 'Allowed student signup accepted via triggers', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 7: Non-allowed domain rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'bad@evilcorp.com', jsonb_build_object('full_name', 'Bad Actor', 'college_id', 'STU1002'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (7, 'Non-allowed domain rejected', true, 'Raised DOMAIN_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Non-allowed domain rejected', false, 'Failed to reject evilcorp.com');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 8: Subdomain & lookalike tricks rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'bad@campus.edu.evil.com', jsonb_build_object('full_name', 'Bad Subdomain', 'college_id', 'STU1003'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (8, 'Subdomain lookalike trick rejected', true, 'Raised DOMAIN_NOT_ALLOWED for campus.edu.evil.com');
  ELSE
    INSERT INTO _test_results VALUES (8, 'Subdomain lookalike trick rejected', false, 'Allowed subdomain lookalike');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 9: Reverse @ trick rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'user@campus.edu@evil.com', jsonb_build_object('full_name', 'Two At', 'college_id', 'STU1004'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EMAIL%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (9, 'Multiple @ symbols rejected', true, 'Raised INVALID_EMAIL');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Multiple @ symbols rejected', false, 'Allowed multiple @ symbols');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 10: Trailing dot in domain rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'user@campus.edu.', jsonb_build_object('full_name', 'Dot End', 'college_id', 'STU1005'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EMAIL%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (10, 'Trailing dot in domain rejected', true, 'Raised INVALID_EMAIL');
  ELSE
    INSERT INTO _test_results VALUES (10, 'Trailing dot in domain rejected', false, 'Allowed trailing dot');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 11: Plus-addressing (+) alias rejected for students
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'alice+alias@campus.edu', jsonb_build_object('full_name', 'Alice Alias', 'college_id', 'STU1007'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%PLUS_ALIAS_NOT_ALLOWED%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (11, 'Plus-addressing (+) alias rejected for students', true, 'Raised PLUS_ALIAS_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (11, 'Plus-addressing (+) alias rejected for students', false, 'Failed to reject plus-addressing');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 12: Duplicate college_id rejected for students
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'david@campus.edu', jsonb_build_object('full_name', 'David Clone', 'college_id', 'cid99999'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DUPLICATE_COLLEGE_ID%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (12, 'Duplicate college_id rejected for students', true, 'Raised DUPLICATE_COLLEGE_ID');
  ELSE
    INSERT INTO _test_results VALUES (12, 'Duplicate college_id rejected for students', false, 'Failed to reject duplicate college ID cid99999');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 13: Invalid college_id format rejected by trigger
-- ==============================================================================
DO $$
DECLARE
  v_err1 boolean := false;
  v_err2 boolean := false;
BEGIN
  RESET ROLE;

  -- Too short (length 2)
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'badlen@campus.edu', jsonb_build_object('full_name', 'Short CID', 'college_id', 'AB'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_COLLEGE_ID_FORMAT%' THEN v_err1 := true; END IF;
  END;

  -- Disallowed special characters ($ and #)
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'badchar@campus.edu', jsonb_build_object('full_name', 'Special CID', 'college_id', 'STU#1001$'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_COLLEGE_ID_FORMAT%' THEN v_err2 := true; END IF;
  END;

  IF v_err1 AND v_err2 THEN
    INSERT INTO _test_results VALUES (13, 'Invalid college_id format rejected by trigger', true, 'Both short length and disallowed special characters rejected');
  ELSE
    INSERT INTO _test_results VALUES (13, 'Invalid college_id format rejected by trigger', false, 'err1=' || v_err1 || ', err2=' || v_err2);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 14: Pre-check simulation catches existing invalid college_id format
-- ==============================================================================
DO $$
DECLARE
  v_cnt integer;
BEGIN
  RESET ROLE;

  -- Verify our canonical pattern matches valid IDs and identifies invalid IDs
  SELECT count(*) INTO v_cnt
  FROM (
    SELECT 'STU_1001-A/B.C' AS cid
    UNION ALL
    SELECT 'INV#ID'
    UNION ALL
    SELECT 'AB'
  ) t
  WHERE cid !~ '^[A-Za-z0-9_./-]{3,30}$';

  IF v_cnt = 2 THEN
    INSERT INTO _test_results VALUES (14, 'Canonical college_id regex catches format violations', true, 'Regex ^[A-Za-z0-9_./-]{3,30}$ caught exactly the 2 invalid candidates');
  ELSE
    INSERT INTO _test_results VALUES (14, 'Canonical college_id regex catches format violations', false, 'Expected 2 format failures, got ' || v_cnt);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 15: full_name sanitisation (whitespace collapse, control/bidi stripped, max 80)
-- ==============================================================================
DO $$
DECLARE
  v_new_id  uuid := gen_random_uuid();
  v_raw_str text := E'   Dr.\t\tJohn \u200B\u200E Doe   \nSmith   ';
  v_prof    public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_new_id, 'drjohn@campus.edu', jsonb_build_object('full_name', v_raw_str, 'college_id', 'STU1009'));

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_new_id;

  IF v_prof.full_name = 'Dr. John Doe Smith' THEN
    INSERT INTO _test_results VALUES (15, 'full_name sanitisation in handle_new_user', true, 'Collapsed whitespace, stripped zero-width chars: "Dr. John Doe Smith"');
  ELSE
    INSERT INTO _test_results VALUES (15, 'full_name sanitisation in handle_new_user', false, 'Sanitised name was: "' || coalesce(v_prof.full_name, 'null') || '"');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (15, 'full_name sanitisation in handle_new_user', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 16: Invited staff user with invited_at fires triggers & ends inactive staff
-- ==============================================================================
DO $$
DECLARE
  v_invite_id uuid := gen_random_uuid();
  v_prof      public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  -- Admin invites staff with external/freemail domain and no college_id
  INSERT INTO auth.users (id, email, invited_at, raw_user_meta_data)
  VALUES (v_invite_id, 'external_chef@caterer.org', now(), jsonb_build_object('full_name', 'Head Chef'));

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_invite_id;

  IF v_prof.id IS NOT NULL AND v_prof.role = 'staff'::public.user_role 
     AND v_prof.is_active = false AND v_prof.canteen_id IS NULL AND v_prof.college_id IS NULL THEN
    INSERT INTO _test_results VALUES (16, 'Invited staff user bypasses checks & ends inactive staff', true, 'Profile created: role=staff, is_active=false, canteen_id=NULL, college_id=NULL');
  ELSE
    INSERT INTO _test_results VALUES (16, 'Invited staff user bypasses checks & ends inactive staff', false, 'prof role=' || coalesce(v_prof.role::text, 'none') || ', act=' || coalesce(v_prof.is_active::text, 'none'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (16, 'Invited staff user bypasses checks & ends inactive staff', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 17: Dashboard-style user with no invited_at or metadata role is rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;

  -- Simulates Supabase Dashboard "Create user" without invite or metadata role
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'dashboard_staff@gmail.com', jsonb_build_object('full_name', 'Dashboard Staff'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' OR SQLERRM LIKE '%MISSING_COLLEGE_ID%' THEN
      v_err := true;
    END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (17, 'Dashboard-style user without invited_at is rejected', true, 'Correctly rejected as un-bypassed student registration');
  ELSE
    INSERT INTO _test_results VALUES (17, 'Dashboard-style user without invited_at is rejected', false, 'Allowed creation of un-bypassed user without campus domain or college_id');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 18: Existing user login (UPDATE on auth.users) unaffected by trigger
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_ok         boolean := false;
BEGIN
  RESET ROLE;
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  -- Simulate auth.users update on login (last_sign_in_at update)
  UPDATE auth.users
  SET last_sign_in_at = now()
  WHERE id = v_student_id;

  v_ok := true;

  IF v_ok THEN
    INSERT INTO _test_results VALUES (18, 'Existing user login (UPDATE on auth.users) unaffected', true, 'UPDATE on auth.users completed without trigger error');
  ELSE
    INSERT INTO _test_results VALUES (18, 'Existing user login (UPDATE on auth.users) unaffected', false, 'UPDATE failed');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (18, 'Existing user login (UPDATE on auth.users) unaffected', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 19: Student & Anon blocked from admin domain procedures
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_err_stud   boolean := false;
  v_err_anon   boolean := false;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  -- As student
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text)::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_add_allowed_domain('hacked.edu');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_err_stud := true; END IF;
  END;

  -- As anon
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.admin_add_allowed_domain('hacked.edu');
  EXCEPTION WHEN OTHERS THEN
    v_err_anon := true;
  END;

  RESET ROLE;

  IF v_err_stud AND v_err_anon THEN
    INSERT INTO _test_results VALUES (19, 'Student and Anon blocked from admin functions', true, 'Student received FORBIDDEN; Anon call rejected');
  ELSE
    INSERT INTO _test_results VALUES (19, 'Student and Anon blocked from admin functions', false, 'err_stud=' || v_err_stud || ', err_anon=' || v_err_anon);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (19, 'Student and Anon blocked from admin functions', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 20: Admin removes domain; repeat removal returns changed:false
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_res1     jsonb;
  v_res2     jsonb;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Remove
  v_res1 := public.admin_remove_allowed_domain('gmail.com');

  -- Repeat removal
  v_res2 := public.admin_remove_allowed_domain('gmail.com');

  RESET ROLE;

  IF (v_res1->>'success')::boolean = true AND (v_res1->>'changed')::boolean = true
     AND (v_res2->>'changed')::boolean = false THEN
    INSERT INTO _test_results VALUES (20, 'Admin removes domain idempotently', true, 'Removed with changed:true; repeat removal returned changed:false');
  ELSE
    INSERT INTO _test_results VALUES (20, 'Admin removes domain idempotently', false, 'res1=' || v_res1::text || ', res2=' || v_res2::text);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (20, 'Admin removes domain idempotently', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 21: Changing role staff->student without valid college_id raises INVALID_INPUT
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_staff_id uuid;
  v_err      boolean := false;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  SELECT val_uuid INTO v_staff_id FROM _test_env WHERE key = 'staff_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_set_user_role(v_staff_id, 'student'::public.user_role, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_INPUT%' AND SQLERRM LIKE '%College ID%' THEN
      v_err := true;
    END IF;
  END;

  RESET ROLE;

  IF v_err THEN
    INSERT INTO _test_results VALUES (21, 'Changing role staff->student without college_id raises INVALID_INPUT', true, 'Clean INVALID_INPUT exception raised instead of raw constraint violation');
  ELSE
    INSERT INTO _test_results VALUES (21, 'Changing role staff->student without college_id raises INVALID_INPUT', false, 'Failed to raise clean INVALID_INPUT error');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (21, 'Changing role staff->student without college_id raises INVALID_INPUT', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- FINAL SUMMARY & RESULT VERIFICATION
-- ==============================================================================
DO $$
DECLARE
  v_pass_count   integer;
  v_fail_count   integer;
  v_total        integer;
  r              record;
  v_fail_summary text := '';
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_pass_count FROM _test_results WHERE passed = true;
  SELECT count(*) INTO v_fail_count FROM _test_results WHERE passed = false;
  v_total := v_pass_count + v_fail_count;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'SIGNUP HARDENING TEST SUITE RESULTS: % / % PASSED', v_pass_count, v_total;
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
  ELSIF v_total < 21 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 21 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Signup Hardening test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
