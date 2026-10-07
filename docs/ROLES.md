# Role Management & Administrative SQL Reference

> [!CAUTION]
> **CRITICAL SECURITY WARNING**
> Role assignment, promotion, demotion, and account deactivation **MUST NEVER be exposed in the application UI, Server Actions, or API endpoints accessible by regular users**.
> 
> The database enforces this via the `prevent_profile_escalation` trigger, which blocks non-admin authenticated users from modifying `role`, `canteen_id`, or `is_active`. These administrative SQL operations are designed to be run **exclusively** by authorized administrators directly in the **Supabase Dashboard SQL Editor** (or via trusted server migrations with elevated privileges).

---

## 1. Quick Reference: Lookup Helper Queries

### List all users with current profiles
```sql
SELECT 
  u.id AS user_id,
  u.email,
  p.full_name,
  p.college_id,
  p.role,
  p.canteen_id,
  p.is_active,
  p.created_at
FROM auth.users u
JOIN public.profiles p ON u.id = p.id
ORDER BY p.created_at DESC;
```

### List available canteens and their IDs
```sql
SELECT 
  id AS canteen_id,
  name,
  location,
  kitchen_capacity,
  is_active
FROM public.canteens
ORDER BY name;
```

---

## 2. Operational SQL Commands

### A. Promote a User to Staff (with Assigned Canteen)
Promotes a user to the `'staff'` role and associates them with a specific canteen.

```sql
-- Replace 'user@campus.edu' with target user's email
-- Replace '00000000-0000-0000-0000-000000000001' with valid canteen UUID
UPDATE public.profiles
SET 
  role = 'staff'::public.user_role,
  canteen_id = '00000000-0000-0000-0000-000000000001'::uuid,
  is_active = true,
  updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@campus.edu'
);
```

### B. Promote a User to Admin
Promotes a user to the `'admin'` role with unrestricted platform administrative privileges.

```sql
-- Replace 'admin@campus.edu' with target user's email
UPDATE public.profiles
SET 
  role = 'admin'::public.user_role,
  canteen_id = NULL,
  is_active = true,
  updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@campus.edu'
);
```

### C. Demote a User to Student
Revokes administrative/staff privileges and sets the user's role back to `'student'`.

```sql
-- Replace 'user@campus.edu' with target user's email
UPDATE public.profiles
SET 
  role = 'student'::public.user_role,
  canteen_id = NULL,
  updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@campus.edu'
);
```

### D. Deactivate a User Account
Deactivates a user's account (`is_active = false`). When a deactivated user signs in or loads a protected page, the application automatically signs them out and redirects them to `/login?error=account_deactivated`.

```sql
-- Replace 'user@campus.edu' with target user's email
UPDATE public.profiles
SET 
  is_active = false,
  updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@campus.edu'
);
```

### E. Reactivate a User Account
Restores access for a previously deactivated user.

```sql
-- Replace 'user@campus.edu' with target user's email
UPDATE public.profiles
SET 
  is_active = true,
  updated_at = now()
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'user@campus.edu'
);
```
