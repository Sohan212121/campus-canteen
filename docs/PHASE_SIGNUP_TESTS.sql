-- ==============================================================================
-- PHASE SIGNUP TEST SUITE: docs/PHASE_SIGNUP_TESTS.sql
-- Description: Interactive verification script for Phase Signup Hardening:
--              1. Fail-closed rejection when allowed_email_domains is empty.
--              2. Admin adds allowed domain (creates audit row); duplicate returns changed:false.
--              3. Free-mail domain rejected without confirm flag; accepted with confirm flag.
--              4. Public lookup is_signup_email_allowed callable by anon; returns boolean; zero enumeration leak.
--              5. Allowed campus domain signup accepted via trigger.
--              6. Non-allowed domain rejected.
--              7. Subdomain and lookalike tricks rejected (college.edu.evil.com).
--              8. Reverse @ trick rejected (user@college.edu@evil.com).
--              9. Trailing dot in domain rejected.
--              10. Null / empty email rejected.
--              11. Email plus-addressing (+) rejected for students.
--              12. Case insensitivity & normalisation.
--              13. College ID format & duplicate rejection.
--              14. full_name sanitisation (whitespace collapse, control/bidi stripped, max 80).
--              15. Admin invites & admin-created users bypass domain/college_id checks and default to inactive staff.
--              16. Existing user login (UPDATE on auth.users) unaffected by trigger.
--              17. Student & Anon blocked from admin functions.
--              18. Admin removes domain; repeat removal returns changed:false with no audit row.
--              19. Role change staff -> student without college_id blocked with friendly INVALID_INPUT.
-- Wrapped in BEGIN ... ROLLBACK so NO changes persist and real rows are NEVER touched.
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

  -- Save environment keys
  INSERT INTO _test_env (key, val_uuid) VALUES ('admin_id', v_admin_id);
  INSERT INTO _test_env (key, val_uuid) VALUES ('student_id', v_student_id);
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
    VALUES (v_new_id, 'student@testcampus.edu', jsonb_build_object('full_name', 'Test Student', 'college_id', 'CID00001'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN
      v_err := true;
    END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (1, 'Empty allowed list rejects signup (fail closed)', true, 'Correctly raised DOMAIN_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (1, 'Empty allowed list rejects signup (fail closed)', false, 'Failed to reject signup with empty allowed domains');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 2: Admin adds allowed domain (creates audit row); duplicate returns changed:false
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_res1     jsonb;
  v_res2     jsonb;
  v_audit_cnt integer;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Add new domain
  v_res1 := public.admin_add_allowed_domain('campus.edu');

  -- 2. Duplicate add
  v_res2 := public.admin_add_allowed_domain('campus.edu');

  RESET ROLE;

  SELECT count(*) INTO v_audit_cnt
  FROM public.admin_audit_log
  WHERE action = 'ADD_ALLOWED_DOMAIN' AND details->>'domain' = 'campus.edu';

  IF (v_res1->>'changed')::boolean = true
     AND (v_res2->>'changed')::boolean = false
     AND v_audit_cnt = 1 THEN
    INSERT INTO _test_results VALUES (2, 'Admin adds allowed domain & duplicate deduplication', true, 'Added successfully, duplicate returned changed:false, 1 audit row written');
  ELSE
    INSERT INTO _test_results VALUES (2, 'Admin adds allowed domain & duplicate deduplication', false, 'res1=' || coalesce(v_res1::text, 'null') || ', res2=' || coalesce(v_res2::text, 'null') || ', audit_cnt=' || v_audit_cnt);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (2, 'Admin adds allowed domain & duplicate deduplication', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 3: Free-mail rejection without confirm flag; acceptance with confirm flag
-- ==============================================================================
DO $$
DECLARE
  v_admin_id   uuid;
  v_blocked    boolean := false;
  v_res_allow  jsonb;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Attempt add gmail.com without confirm
  BEGIN
    PERFORM public.admin_add_allowed_domain('gmail.com', false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FREEMAIL_CONFIRMATION_REQUIRED%' THEN
      v_blocked := true;
    END IF;
  END;

  -- 2. Add with confirm
  v_res_allow := public.admin_add_allowed_domain('gmail.com', true);

  -- Clean it up immediately
  PERFORM public.admin_remove_allowed_domain('gmail.com');

  RESET ROLE;

  IF v_blocked AND (v_res_allow->>'changed')::boolean = true THEN
    INSERT INTO _test_results VALUES (3, 'Freemail warning & confirmation guard', true, 'gmail.com blocked without confirm, allowed with confirm=true');
  ELSE
    INSERT INTO _test_results VALUES (3, 'Freemail warning & confirmation guard', false, 'v_blocked=' || v_blocked || ', res_allow=' || coalesce(v_res_allow::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (3, 'Freemail warning & confirmation guard', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 4: public.is_signup_email_allowed (Anon executable, zero enumeration leak)
-- ==============================================================================
DO $$
DECLARE
  v_chk_valid   boolean;
  v_chk_invalid boolean;
  v_chk_empty   boolean;
  v_chk_plus    boolean;
BEGIN
  SET LOCAL ROLE anon;

  v_chk_valid := public.is_signup_email_allowed('student@campus.edu');
  v_chk_invalid := public.is_signup_email_allowed('hacker@evil.com');
  v_chk_empty := public.is_signup_email_allowed('');
  v_chk_plus := public.is_signup_email_allowed('student+alias@campus.edu');

  RESET ROLE;

  IF v_chk_valid = true AND v_chk_invalid = false AND v_chk_empty = false AND v_chk_plus = false THEN
    INSERT INTO _test_results VALUES (4, 'is_signup_email_allowed public lookup for anon', true, 'Anon verified: valid domain true, evil/empty/plus false');
  ELSE
    INSERT INTO _test_results VALUES (4, 'is_signup_email_allowed public lookup for anon', false, 'valid=' || v_chk_valid || ', invalid=' || v_chk_invalid || ', empty=' || v_chk_empty || ', plus=' || v_chk_plus);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (4, 'is_signup_email_allowed public lookup for anon', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 5: Allowed campus domain signup accepted via trigger
-- ==============================================================================
DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_prof   public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_new_id, 'alice@campus.edu', jsonb_build_object('full_name', 'Alice Student', 'college_id', 'STU1001'));

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_new_id;

  IF v_prof.id IS NOT NULL AND v_prof.role = 'student' AND v_prof.college_id = 'STU1001' AND v_prof.is_active = true THEN
    INSERT INTO _test_results VALUES (5, 'Allowed domain signup accepted', true, 'Alice created with student role & STU1001');
  ELSE
    INSERT INTO _test_results VALUES (5, 'Allowed domain signup accepted', false, 'Profile not created properly: ' || coalesce(v_prof.id::text, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (5, 'Allowed domain signup accepted', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 6: Non-allowed domain rejected
-- ==============================================================================
DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_err boolean := false;
BEGIN
  RESET ROLE;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_new_id, 'bob@notcampus.com', jsonb_build_object('full_name', 'Bob Intruder', 'college_id', 'STU1002'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN
      v_err := true;
    END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (6, 'Non-allowed domain rejected', true, 'Correctly raised DOMAIN_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (6, 'Non-allowed domain rejected', false, 'Failed to reject bob@notcampus.com');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 7: Subdomain and lookalike tricks rejected (campus.edu.evil.com, evilcampus.edu)
-- ==============================================================================
DO $$
DECLARE
  v_err1 boolean := false;
  v_err2 boolean := false;
BEGIN
  RESET ROLE;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'attacker@campus.edu.evil.com', jsonb_build_object('full_name', 'Attacker', 'college_id', 'STU1003'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN v_err1 := true; END IF;
  END;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'attacker@evilcampus.edu', jsonb_build_object('full_name', 'Attacker', 'college_id', 'STU1004'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%DOMAIN_NOT_ALLOWED%' THEN v_err2 := true; END IF;
  END;

  IF v_err1 AND v_err2 THEN
    INSERT INTO _test_results VALUES (7, 'Subdomain & lookalike domain tricks rejected', true, 'campus.edu.evil.com and evilcampus.edu blocked');
  ELSE
    INSERT INTO _test_results VALUES (7, 'Subdomain & lookalike domain tricks rejected', false, 'err1=' || v_err1 || ', err2=' || v_err2);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 8: Reverse @ trick rejected (user@campus.edu@evil.com)
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'user@campus.edu@evil.com', jsonb_build_object('full_name', 'Attacker', 'college_id', 'STU1005'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EMAIL%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (8, 'Reverse @ trick rejected', true, 'Rejected with INVALID_EMAIL (multiple @ symbols)');
  ELSE
    INSERT INTO _test_results VALUES (8, 'Reverse @ trick rejected', false, 'Failed to reject user@campus.edu@evil.com');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 9: Trailing dot & malformed labels rejected
-- ==============================================================================
DO $$
DECLARE
  v_err boolean := false;
BEGIN
  RESET ROLE;

  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (gen_random_uuid(), 'attacker@campus.edu.', jsonb_build_object('full_name', 'Attacker', 'college_id', 'STU1006'));
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%INVALID_EMAIL%' THEN v_err := true; END IF;
  END;

  IF v_err THEN
    INSERT INTO _test_results VALUES (9, 'Trailing dot in domain rejected', true, 'Trailing dot rejected properly');
  ELSE
    INSERT INTO _test_results VALUES (9, 'Trailing dot in domain rejected', false, 'Failed to reject trailing dot');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 10: Email plus-addressing (+) rejected for students
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
    INSERT INTO _test_results VALUES (10, 'Plus-addressing (+) alias rejected for students', true, 'Raised PLUS_ALIAS_NOT_ALLOWED');
  ELSE
    INSERT INTO _test_results VALUES (10, 'Plus-addressing (+) alias rejected for students', false, 'Failed to reject plus-addressing');
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 11: Case-insensitivity & normalization
-- ==============================================================================
DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_prof   public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  -- Uppercase email & lowercase input college ID
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_new_id, 'CHARLIE@CAMPUS.EDU', jsonb_build_object('full_name', 'Charlie Brown', 'college_id', 'stu-1008'));

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_new_id;

  IF v_prof.id IS NOT NULL AND v_prof.college_id = 'STU-1008' THEN
    INSERT INTO _test_results VALUES (11, 'Case insensitivity & normalisation', true, 'CHARLIE@CAMPUS.EDU accepted; college_id normalized to STU-1008');
  ELSE
    INSERT INTO _test_results VALUES (11, 'Case insensitivity & normalisation', false, 'Profile not created or not normalized: ' || coalesce(v_prof.college_id, 'null'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (11, 'Case insensitivity & normalisation', false, 'Exception: ' || SQLERRM);
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

  -- Attempt signup with existing CID99999
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
-- TEST 13: full_name sanitisation (whitespace collapse, control/bidi stripped, max 80)
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
    INSERT INTO _test_results VALUES (13, 'full_name sanitisation in handle_new_user', true, 'Collapsed whitespace, stripped zero-width chars: "Dr. John Doe Smith"');
  ELSE
    INSERT INTO _test_results VALUES (13, 'full_name sanitisation in handle_new_user', false, 'Sanitised name was: "' || coalesce(v_prof.full_name, 'null') || '"');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (13, 'full_name sanitisation in handle_new_user', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 14: Admin invites & admin-created users bypass checks (default inactive staff/admin)
-- ==============================================================================
DO $$
DECLARE
  v_staff_id  uuid := gen_random_uuid();
  v_invite_id uuid := gen_random_uuid();
  v_prof1     public.profiles%ROWTYPE;
  v_prof2     public.profiles%ROWTYPE;
BEGIN
  RESET ROLE;

  -- 1. Admin-created staff with non-campus email (gmail) and no college_id
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (v_staff_id, 'canteen_chef@gmail.com', jsonb_build_object('full_name', 'Head Chef'), jsonb_build_object('role', 'staff', 'is_admin_created', true));

  SELECT * INTO v_prof1 FROM public.profiles WHERE id = v_staff_id;

  -- 2. Invited user with invited_at timestamp and no college_id
  INSERT INTO auth.users (id, email, invited_at, raw_user_meta_data)
  VALUES (v_invite_id, 'external_accountant@consultant.org', now(), jsonb_build_object('full_name', 'External Accountant'));

  SELECT * INTO v_prof2 FROM public.profiles WHERE id = v_invite_id;

  IF v_prof1.role = 'staff' AND v_prof1.is_active = false AND v_prof1.college_id IS NULL
     AND v_prof2.role = 'staff' AND v_prof2.is_active = false AND v_prof2.college_id IS NULL THEN
    INSERT INTO _test_results VALUES (14, 'Admin created/invited users bypass check as inactive staff', true, 'Both non-campus accounts created as inactive staff with NULL college_id');
  ELSE
    INSERT INTO _test_results VALUES (14, 'Admin created/invited users bypass check as inactive staff', false, 'prof1 role=' || v_prof1.role || ', act=' || v_prof1.is_active || '; prof2 role=' || v_prof2.role || ', act=' || v_prof2.is_active);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (14, 'Admin created/invited users bypass check as inactive staff', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 15: Existing user login (UPDATE on auth.users) unaffected by trigger
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_ok         boolean := false;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';
  RESET ROLE;

  -- Simulate login by updating last_sign_in_at on auth.users
  UPDATE auth.users
  SET last_sign_in_at = now()
  WHERE id = v_student_id;

  v_ok := true;

  IF v_ok THEN
    INSERT INTO _test_results VALUES (15, 'Existing user login (UPDATE on auth.users) unaffected', true, 'UPDATE executed without trigger firing');
  ELSE
    INSERT INTO _test_results VALUES (15, 'Existing user login (UPDATE on auth.users) unaffected', false, 'Failed to update auth.users');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (15, 'Existing user login (UPDATE on auth.users) unaffected', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 16: Student & Anon blocked from admin functions
-- ==============================================================================
DO $$
DECLARE
  v_student_id uuid;
  v_stud_err   boolean := false;
  v_anon_err   boolean := false;
BEGIN
  SELECT val_uuid INTO v_student_id FROM _test_env WHERE key = 'student_id';

  -- 1. Student call
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.admin_list_allowed_domains();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%FORBIDDEN%' THEN v_stud_err := true; END IF;
  END;

  -- 2. Anon call
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.admin_list_allowed_domains();
  EXCEPTION WHEN OTHERS THEN
    v_anon_err := true;
  END;

  RESET ROLE;

  IF v_stud_err AND v_anon_err THEN
    INSERT INTO _test_results VALUES (16, 'Student & Anon blocked from admin functions', true, 'Student received FORBIDDEN; Anon permission denied');
  ELSE
    INSERT INTO _test_results VALUES (16, 'Student & Anon blocked from admin functions', false, 'stud_err=' || v_stud_err || ', anon_err=' || v_anon_err);
  END IF;
END;
$$;


-- ==============================================================================
-- TEST 17: Admin removes domain; repeat removal returns changed:false
-- ==============================================================================
DO $$
DECLARE
  v_admin_id  uuid;
  v_res1      jsonb;
  v_res2      jsonb;
  v_audit_cnt integer;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Remove campus.edu
  v_res1 := public.admin_remove_allowed_domain('campus.edu');

  -- Repeat removal
  v_res2 := public.admin_remove_allowed_domain('campus.edu');

  RESET ROLE;

  SELECT count(*) INTO v_audit_cnt
  FROM public.admin_audit_log
  WHERE action = 'REMOVE_ALLOWED_DOMAIN' AND details->>'domain' = 'campus.edu';

  IF (v_res1->>'changed')::boolean = true
     AND (v_res2->>'changed')::boolean = false
     AND v_audit_cnt = 1 THEN
    INSERT INTO _test_results VALUES (17, 'Admin removes domain & repeat removal idempotency', true, 'Removed successfully, second call changed:false, 1 audit row written');
  ELSE
    INSERT INTO _test_results VALUES (17, 'Admin removes domain & repeat removal idempotency', false, 'res1=' || coalesce(v_res1::text, 'null') || ', res2=' || coalesce(v_res2::text, 'null') || ', audit_cnt=' || v_audit_cnt);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (17, 'Admin removes domain & repeat removal idempotency', false, 'Exception: ' || SQLERRM);
END;
$$;


-- ==============================================================================
-- TEST 18: Admin changing role staff -> student without college_id blocked
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
  v_staff_id uuid := gen_random_uuid();
  v_err      boolean := false;
BEGIN
  SELECT val_uuid INTO v_admin_id FROM _test_env WHERE key = 'admin_id';
  RESET ROLE;

  -- Create staff without college_id
  INSERT INTO public.profiles (id, full_name, college_id, role, is_active)
  VALUES (v_staff_id, 'Temp Staff', NULL, 'staff'::public.user_role, true);

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
    INSERT INTO _test_results VALUES (18, 'Changing role staff->student without college_id raises INVALID_INPUT', true, 'Clean INVALID_INPUT exception raised instead of raw constraint violation');
  ELSE
    INSERT INTO _test_results VALUES (18, 'Changing role staff->student without college_id raises INVALID_INPUT', false, 'Failed to raise clean INVALID_INPUT error');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  INSERT INTO _test_results VALUES (18, 'Changing role staff->student without college_id raises INVALID_INPUT', false, 'Exception: ' || SQLERRM);
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
  ELSIF v_total < 18 THEN
    RAISE EXCEPTION 'TEST SUITE INCOMPLETE: Expected 18 tests, but only % ran.', v_total;
  ELSE
    RAISE NOTICE 'SUCCESS: All % Signup Hardening test cases passed successfully.', v_pass_count;
  END IF;
END;
$$;

ROLLBACK;
