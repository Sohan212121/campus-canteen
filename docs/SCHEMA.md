# Database Schema Reference

**Project**: Campus Canteen Pre-Order & Smart Pickup Platform  
**Target Database**: PostgreSQL 15+ (Supabase)  
**Schema**: `public`  
**Timezone Reference**: All operational hours, schedule validations, and timestamps are evaluated in **Asia/Kolkata (IST)**.

---

## 1. Custom Types & Enums

### `user_role`
Role-based access levels across the application:
- `student`: Standard campus customer. Can browse menus, place pre-orders, view own orders, update own profile info.
- `staff`: Canteen operational personnel. Can view canteen orders, process prep stages, toggle item availability and stock.
- `admin`: Campus / canteen administrator. Full access to menu, canteens, categories, operational settings, and analytics.

### `order_status`
Explicit lifecycle transitions for every order:
- `PLACED`: Order successfully submitted by student; awaiting kitchen acknowledgment.
- `ACCEPTED`: Canteen has acknowledged the incoming order.
- `PREPARING`: Food is currently being prepared in the kitchen.
- `READY`: Items are prepared and waiting at the collection counter.
- `COLLECTED`: Student showed pickup token/QR and received items.
- `CANCELLED`: Order cancelled within the eligible window.
- `REJECTED`: Order rejected due to unexpected stock-out or canteen closure.

### `payment_method`
- `PAY_AT_PICKUP`: Student pays cash / UPI directly at counter during collection.
- `ONLINE`: Paid via gateway during pre-order placement.
- `WALLET`: Campus prepaid meal wallet balance deduction.

### `payment_status`
- `PENDING`: Payment awaiting verification.
- `PAID`: Payment confirmed.
- `FAILED`: Transaction aborted or failed.
- `REFUNDED`: Reimbursed back to student.

---

## 2. Global Sequences

- **`order_code_seq`**: Starts at `10001`. Used to generate human-readable, student-friendly order references: `'CN' || nextval('order_code_seq')` (e.g. `CN10247`).

---

## 3. Table Definitions

### 3.1 `public.canteens`
Represents physical campus dining locations with operational workload configuration.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique canteen identifier |
| `name` | `text` | NOT NULL, UNIQUE | Canteen name (e.g., "Main Campus Canteen") |
| `location` | `text` | NULL | Physical building/floor location |
| `kitchen_capacity` | `integer` | NOT NULL, `DEFAULT 3`, `CHECK (kitchen_capacity > 0)` | Number of concurrent preparation units / kitchen throughput factor |
| `min_lead_minutes` | `integer` | NOT NULL, `DEFAULT 5`, `CHECK (min_lead_minutes >= 0)` | Minimum buffer time before preparation begins |
| `hold_minutes` | `integer` | NOT NULL, `DEFAULT 15`, `CHECK (hold_minutes >= 0)` | Window duration food is kept warm after readiness before expiration |
| `opens_at` | `time` | NOT NULL, `DEFAULT '08:00:00'` | Daily canteen opening time (IST) |
| `closes_at` | `time` | NOT NULL, `DEFAULT '17:00:00'` | Daily canteen closing time (IST) |
| `last_order_time` | `time` | NOT NULL, `DEFAULT '16:30:00'` | Daily cutoff time for accepting pre-orders (IST) |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Availability flag |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Record creation timestamp |

*Constraints*: `CHECK (closes_at > opens_at)`, `CHECK (last_order_time <= closes_at AND last_order_time >= opens_at)`

---

### 3.2 `public.profiles`
Extended user attributes linked 1:1 with Supabase `auth.users`.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, REFERENCES `auth.users(id)` ON DELETE CASCADE | Maps directly to authenticated user |
| `full_name` | `text` | NULL | Student or staff full name |
| `college_id` | `text` | NULL | Student roll/registration number or staff employee ID |
| `role` | `user_role` | NOT NULL, `DEFAULT 'student'` | Role assigned to user |
| `canteen_id` | `uuid` | NULL, REFERENCES `canteens(id)` ON DELETE SET NULL | Canteen association for staff members |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Account active status |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Last update timestamp |

---

### 3.3 `public.categories`
Menu categories for fast browsing.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique category identifier |
| `canteen_id` | `uuid` | NOT NULL, REFERENCES `canteens(id)` ON DELETE CASCADE | Associated canteen |
| `name` | `text` | NOT NULL | Category title (e.g. "Breakfast", "Beverages") |
| `display_order` | `integer` | NOT NULL, `DEFAULT 0` | UI sort order |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Active flag |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |

*Constraints*: `UNIQUE (canteen_id, name)`

---

### 3.4 `public.menu_items`
Food and beverage offerings. Monetary values are strictly stored in integer paise.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique menu item identifier |
| `canteen_id` | `uuid` | NOT NULL, REFERENCES `canteens(id)` ON DELETE CASCADE | Owning canteen |
| `category_id` | `uuid` | NULL, REFERENCES `categories(id)` ON DELETE SET NULL | Category classification |
| `name` | `text` | NOT NULL | Item name |
| `description` | `text` | NULL | Item details & ingredients |
| `price_paise` | `integer` | NOT NULL, `CHECK (price_paise >= 0)` | Price in Indian paise (₹50.00 = 5000) |
| `image_url` | `text` | NULL | Asset path or CDN URL |
| `is_veg` | `boolean` | NOT NULL, `DEFAULT true` | Vegetarian indicator |
| `is_available` | `boolean` | NOT NULL, `DEFAULT true` | In-stock toggle for counter staff |
| `stock` | `integer` | NULL, `CHECK (stock IS NULL OR stock >= 0)` | Daily remaining quantity (NULL = unlimited) |
| `prep_minutes` | `integer` | NOT NULL, `DEFAULT 5`, `CHECK (prep_minutes >= 0)` | Base item preparation time in minutes |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Active in menu |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Last update timestamp |

*Constraints*: `UNIQUE (canteen_id, name)`

---

### 3.5 `public.orders`
Master order record implementing the dynamic pickup model (ASAP or Scheduled).

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique order ID |
| `order_code` | `text` | NOT NULL, UNIQUE, `DEFAULT ('CN' \|\| nextval('order_code_seq')::text)` | Display reference (e.g. `CN10247`) |
| `user_id` | `uuid` | NOT NULL, REFERENCES `profiles(id)` ON DELETE RESTRICT | Ordering customer |
| `canteen_id` | `uuid` | NOT NULL, REFERENCES `canteens(id)` ON DELETE RESTRICT | Fulfillment canteen |
| `status` | `order_status` | NOT NULL, `DEFAULT 'PLACED'` | Current lifecycle stage |
| `payment_method` | `payment_method` | NOT NULL, `DEFAULT 'PAY_AT_PICKUP'` | Chosen payment mode |
| `payment_status` | `payment_status` | NOT NULL, `DEFAULT 'PENDING'` | Payment settlement status |
| `total_paise` | `integer` | NOT NULL, `CHECK (total_paise >= 0)` | Total payable amount in paise |
| `pickup_token` | `text` | NOT NULL, UNIQUE | 4-6 digit numeric or QR code token |
| `idempotency_key` | `text` | NULL | Client-submitted deduplication token |
| `requested_pickup_at`| `timestamptz` | NULL | Desired ready/pickup time (NULL = ASAP mode) |
| `estimated_ready_at` | `timestamptz` | NOT NULL | Calculated timestamp when order will be ready |
| `pickup_window_end` | `timestamptz` | NOT NULL | `estimated_ready_at + hold_minutes` window expiration |
| `prep_minutes_total`| `integer` | NOT NULL, `CHECK (prep_minutes_total >= 0)` | Calculated total order prep duration |
| `placed_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Timestamp when placed |
| `accepted_at` | `timestamptz` | NULL | Acknowledged by kitchen |
| `preparing_at` | `timestamptz` | NULL | Preparation began |
| `ready_at` | `timestamptz` | NULL | Waiting at pickup counter |
| `collected_at` | `timestamptz` | NULL | Handed over to student |
| `cancelled_at` | `timestamptz` | NULL | Order cancelled |
| `rejected_at` | `timestamptz` | NULL | Order rejected by canteen |

*Constraints*: `UNIQUE (user_id, idempotency_key)`

---

### 3.6 `public.order_items`
Immutable line-item records snapshotting item names and prices at purchase time.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Line item ID |
| `order_id` | `uuid` | NOT NULL, REFERENCES `orders(id)` ON DELETE CASCADE | Associated parent order |
| `menu_item_id` | `uuid` | NOT NULL, REFERENCES `menu_items(id)` ON DELETE RESTRICT | Origin menu item |
| `name_snapshot`| `text` | NOT NULL | Item name at purchase time |
| `unit_price_paise`| `integer` | NOT NULL, `CHECK (unit_price_paise >= 0)` | Locked unit price in paise |
| `quantity` | `integer` | NOT NULL, `CHECK (quantity > 0)` | Number of units |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |

---

### 3.7 `public.notifications`
In-app order status and pickup alerts.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique notification ID |
| `user_id` | `uuid` | NOT NULL, REFERENCES `profiles(id)` ON DELETE CASCADE | Target recipient |
| `order_id` | `uuid` | NULL, REFERENCES `orders(id)` ON DELETE CASCADE | Related order reference |
| `title` | `text` | NOT NULL | Short notification header |
| `body` | `text` | NOT NULL | Message body (e.g. "Order #CN10247 is ready") |
| `is_read` | `boolean` | NOT NULL, `DEFAULT false` | Read indicator |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |

---

## 4. Dynamic Pickup Engine (`estimate_ready_time`)

### Function Signature
```sql
public.estimate_ready_time(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": int}
  p_requested_at timestamptz DEFAULT NULL
) RETURNS TABLE (
  estimated_ready_at timestamptz,
  pickup_window_end timestamptz,
  prep_minutes_total integer
)
```

### Calculation Algorithm
1. **Operating Hours Check**:
   - Evaluated in `Asia/Kolkata` (IST).
   - Rejects if current time is past `last_order_time` or before `opens_at`.
2. **Order Preparation Duration (`order_prep`)**:
   - Looks up active, available items in `menu_items` for `p_canteen_id`.
   - `order_prep = max(prep_minutes) + 1 minute per extra unit` (where extra units = `total_quantity - 1`).
   - `prep_minutes_total = order_prep`.
3. **Queued Load Estimation**:
   - `candidate_ready_initial = (now() + min_lead_minutes) + order_prep`.
   - `cutoff_time = CASE WHEN p_requested_at IS NOT NULL THEN p_requested_at ELSE candidate_ready_initial END`.
   - `queued_load = SUM(prep_minutes_total)` for active orders (`status IN ('PLACED', 'ACCEPTED', 'PREPARING')`) in this canteen whose `estimated_ready_at <= cutoff_time`.
   - Orders scheduled for later in the day do not delay earlier ASAP orders.
4. **Kitchen Throughput & Earliest Achievable Time**:
   - `wait = ceil(queued_load / kitchen_capacity)`.
   - `earliest = now() + min_lead_minutes + wait + order_prep`.
5. **Ordering Mode Semantics**:
   - **ASAP Mode** (`p_requested_at IS NULL`):
     - `ready = earliest`.
   - **Scheduled Mode** (`p_requested_at IS NOT NULL`):
     - `p_requested_at` represents the **desired ready/pickup time**, not the start of prep.
     - Must be on the same IST day as `now()` and within `opens_at..closes_at`.
     - If `p_requested_at >= earliest`, then `ready = p_requested_at`.
     - If `p_requested_at < earliest`, the function rejects with an exception and embeds the corrected earliest time in the SQL error `HINT`.
     - **Kitchen Prep Start Time** (for staff board display) = `ready - (prep_minutes_total * interval '1 minute')`.
6. **Closing Time & Window Calculation**:
   - If `ready` in IST is after `closes_at`, rejects the order.
   - `pickup_window_end = ready + (hold_minutes * interval '1 minute')`.

> [!IMPORTANT]
> **Concurrency & Phase 5 Integration**:
> In Phase 5, the `place_order()` Server Action / SQL function must execute:
> ```sql
> SELECT id FROM public.canteens WHERE id = p_canteen_id FOR UPDATE;
> ```
> before invoking `estimate_ready_time()`. Locking the canteen row serializes concurrent checkout requests, ensuring that active queue loads and estimated times are consistent and race-condition free.

---

## 5. Database Triggers & Defense-in-Depth

1. **`set_updated_at()`**: Automatically maintains `updated_at` timestamps on row updates (`profiles`, `menu_items`). `SET search_path = ''`.
2. **`handle_new_user()`**: Triggered on `AFTER INSERT ON auth.users`. Hardcodes `role = 'student'` and creates the user profile automatically without trusting client metadata for privilege assignment (`SECURITY DEFINER`, `search_path = ''`).
3. **`prevent_profile_escalation()`**: Triggered on `BEFORE UPDATE ON public.profiles` (`SECURITY INVOKER`, `search_path = ''`).
   - Bypasses when `current_user NOT IN ('authenticated', 'anon')` (allowing direct migrations, SQL Editor, service_role, and internal `SECURITY DEFINER` procedures).
   - Allows users with `role = 'admin'` to update all columns.
   - For authenticated non-admins, raises an exception if `role`, `canteen_id`, or `is_active` are altered.
4. **`prevent_menu_item_unauthorized_update()`**: Triggered on `BEFORE UPDATE ON public.menu_items` (`SECURITY INVOKER`, `search_path = ''`).
   - Bypasses when `current_user NOT IN ('authenticated', 'anon')`, ensuring server-side background stock decrements in Phase 5 are not blocked.
   - Allows admins full update capability.
   - Restricts staff to altering **only** `is_available` and `stock`, and only for items belonging to their assigned `canteen_id`.

---

## 6. Row Level Security (RLS) Policy Matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| **`canteens`** | Authenticated (`true`) | Admin only | Admin only | Admin only |
| **`profiles`** | Own profile (`id = auth.uid()`), Staff (customers with orders in their canteen), Admin (all) | Admin only (Trigger handles auth insert) | Own profile (`USING & WITH CHECK id = auth.uid()`), Admin (all) | Admin only |
| **`categories`** | Authenticated (`true`) | Admin only | Admin only | Admin only |
| **`menu_items`** | Authenticated (`true`) | Admin only | Staff (own canteen items; availability/stock only via trigger), Admin (all) | Admin only |
| **`orders`** | Own orders (`user_id = auth.uid()`), Staff (own canteen orders), Admin (all) | Blocked directly (Handled by Phase 5 server function) | Blocked directly (Handled by Phase 5 server function) | Admin only |
| **`order_items`** | Own order items, Staff (own canteen), Admin (all) | Blocked directly | Blocked directly | Admin only |
| **`notifications`**| Own notifications (`user_id = auth.uid()`), Admin (all) | Admin / service_role only | Own notifications (`is_read` column grant), Admin (all) | Admin only |

---

## 7. Grants & Privileges

- `anon`: Revoked of all access on all tables, routines, and sequences. `ALTER DEFAULT PRIVILEGES` ensures newly created objects are also inaccessible to `anon`.
- `authenticated`:
  - `SELECT` on `canteens`, `categories`, `menu_items`, `orders`, `order_items`, `notifications`.
  - `SELECT, UPDATE` on `profiles`.
  - `UPDATE (is_read)` on `notifications`.
  - `UPDATE` on `menu_items` (guarded by staff column trigger).
  - `INSERT, UPDATE, DELETE` on `categories`, `menu_items`, `canteens` (guarded by admin RLS).
  - `EXECUTE` on `current_user_role()`, `current_user_canteen()`, `is_admin()`, `is_staff_or_admin()`, and `estimate_ready_time()`.
- `service_role`: Unrestricted access across all tables, sequences, and routines.

---

## 8. Phase 5: Order Placement Procedure (`public.place_order`)

Added in migration `0003_place_order.sql`:

### 8.1 Function Signature
```sql
public.place_order(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": integer}
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_requested_at timestamptz DEFAULT NULL
) RETURNS jsonb
```
- **Security**: `SECURITY DEFINER`, `SET search_path = ''`.
- **Permissions**: Revoked from `PUBLIC`, `anon`; granted to `authenticated`, `service_role`.
- **Caller Context**: Strictly derives user from `auth.uid()`. Does not accept an explicit user ID parameter.

### 8.2 Execution Guarantees
1. **Idempotency**: Dual-check pattern (evaluated at start and re-checked immediately after acquiring the canteen row lock). Concurrent race conditions on `(user_id, idempotency_key)` are caught by a sub-block `unique_violation` handler that returns the committed order with `was_duplicate = true` while rolling back stock decrements.
2. **Active Order Limit**: Maximum 3 active orders per user (`PLACED`, `ACCEPTED`, `PREPARING`, `READY`).
3. **Deadlock Prevention**: Target `menu_items` rows locked `FOR UPDATE ORDER BY id ASC`.
4. **Price Integrity**: Prices calculated exclusively from locked database rows; client prices are completely untrusted.
5. **Token Generation**: Generates a 6-digit numeric token (`(100000 + floor(random() * 900000)::int)::text`) with bounded retries.
6. **Audit & Alerts**: Automatically creates a record in `public.notifications` upon successful placement.

### 8.3 Error Codes Taxonomy
| Error Code | Trigger Condition |
|---|---|
| `UNAUTHENTICATED` | `auth.uid()` is null |
| `USER_INACTIVE` | Profile deactivated or not found |
| `INVALID_PAYMENT_METHOD` | Payment method other than `PAY_AT_PICKUP` |
| `INVALID_IDEMPOTENCY_KEY` | Key is null, empty, or exceeds 64 characters |
| `INVALID_INPUT` | Empty items, > 20 distinct items, or item quantity not in 1..10 |
| `CANTEEN_NOT_FOUND` | Specified canteen ID does not exist |
| `CANTEEN_CLOSED` | Canteen is inactive or outside operating hours |
| `ORDERS_CLOSED` | Pre-order cutoff time reached for today |
| `TOO_MANY_ACTIVE_ORDERS` | User already has 3 active orders |
| `ITEM_UNAVAILABLE` | Item inactive, unavailable, or belongs to another canteen |
| `INSUFFICIENT_STOCK` | Requested quantity exceeds available daily stock |
| `INVALID_SCHEDULE` | Scheduled pickup time not today or outside operating hours |
| `SCHEDULE_TOO_EARLY` | Requested time is before earliest possible kitchen readiness (includes `HINT` with earliest IST timestamp) |

---

## 9. Phase 6: Order Tracking & Cancellation

Added in migration `0004_order_tracking.sql`:

### 9.1 Cancellation Procedure (`public.cancel_order`)
- **Signature**: `public.cancel_order(p_order_id uuid) RETURNS jsonb`
- **Security**: `SECURITY DEFINER`, `search_path = ''`.
- **Allowed Statuses**: Strictly `PLACED`.
- **Behavior**: Acquires `FOR UPDATE` lock, validates caller ownership (`auth.uid() = user_id`), restores stock (`menu_items FOR UPDATE ORDER BY id ASC`), inserts `Order Cancelled` notification, and excludes the order from active queue load automatically. Idempotent return if already `CANCELLED`.
- **Status Change Trigger**: `trg_order_status_notification` triggers on `AFTER UPDATE OF status ON public.orders` for `ACCEPTED`, `PREPARING`, `READY`, `REJECTED` per PRD Section 13 copy.

---

## 10. Phase 7: Staff Kitchen Operations & Counter Pickup

Added in migration `0005_staff_operations.sql`:

### 10.1 Order Lifecycle Transition (`public.transition_order`)
- **Signature**: `public.transition_order(p_order_id uuid, p_to_status public.order_status) RETURNS jsonb`
- **Security**: `SECURITY DEFINER`, `search_path = ''`. Restricted to `authenticated` and `service_role`.
- **Caller Context**: Strictly `auth.uid()`. Role must be `staff` or `admin`.
- **Canteen Isolation**: Staff members are strictly validated against `order.canteen_id` using `IS DISTINCT FROM` (staff with NULL `canteen_id` receive `FORBIDDEN`). Admins can operate on any canteen.
- **Allowed Lifecycle Transitions**:
  - `PLACED` $\rightarrow$ `ACCEPTED` or `REJECTED`
  - `ACCEPTED` $\rightarrow$ `PREPARING`
  - `PREPARING` $\rightarrow$ `READY`
  - `READY` $\rightarrow$ `COLLECTED`
  - *Important Constraint*: **`ACCEPTED` orders cannot be rejected yet**; rejection is permitted only while an order is in `PLACED` stage.
- **Idempotency**: Same-status requests return `{ "order_id": ..., "status": ..., "was_noop": true }` to absorb network retries and double-taps safely.
- **Settlement & Side Effects**:
  - Updates matching timestamp (`accepted_at`, `preparing_at`, `ready_at`, `collected_at`, `rejected_at`).
  - On `COLLECTED`: If `payment_method = 'PAY_AT_PICKUP'`, automatically sets `payment_status = 'PAID'`.
  - On `REJECTED`: Restores reserved stock via deadlock-free row locks on `menu_items`.

### 10.2 Pickup Token Verification (`public.verify_pickup`)
- **Signature**: `public.verify_pickup(p_canteen_id uuid, p_token text) RETURNS jsonb`
- **Security**: `SECURITY DEFINER`, `search_path = ''`.
- **Behavior**:
  - Matches orders currently in status `READY` with matching `pickup_token`.
  - On miss: logs failed attempt in `public.pickup_verify_attempts` and returns `{ "found": false }` (does not raise, ensuring failed attempt persists).
  - Rate limiting: $\ge 10$ failed attempts in 5 minutes raises `RATE_LIMITED`.
  - Returns order details, student name, total, and line items without changing status (status transition to `COLLECTED` is executed separately).

### 10.3 Pickup Verify Attempts Ledger (`public.pickup_verify_attempts`)
- Stores failed attempts for brute-force rate-limiting.
- Protected by Row Level Security (RLS) with zero policies: accessible exclusively by service_role and `SECURITY DEFINER` routines.

### 10.4 Staff RLS & Token Visibility Invariant
- **Important Invariant**: Under database RLS (`0002_rls.sql`), canteen staff can SELECT `orders` belonging to their assigned canteen. Because `pickup_token` exists on `orders`, PostgreSQL allows staff to read it. **However, staff application code and queries must NEVER select `pickup_token`**. Counter collection verification must always occur through the student presenting the token or QR code to `public.verify_pickup`.

---

## 11. Phase 8: Administrative Operations & Platform Analytics

Added in migration `0006_admin_operations.sql`:

### 11.1 Admin Audit Log (`public.admin_audit_log`)
- Columns: `id`, `actor_id` (references `profiles(id)` ON DELETE SET NULL), `action`, `target_type`, `target_id`, `details` (jsonb), `created_at`.
- Protected by RLS with zero user policies; access revoked from `PUBLIC`, `anon`, and `authenticated`.
- Nullable `actor_id` with `ON DELETE SET NULL` ensures audit trail entries survive account deletions.

### 11.2 Role & User Management Procedures
- **`public.admin_set_user_role(p_user_id, p_role, p_canteen_id)`**:
  - `SECURITY DEFINER`, caller must be active admin.
  - Cannot modify own role (`CANNOT_MODIFY_SELF`).
  - Last-admin protection: locks active admin rows `FOR UPDATE` before evaluating count; rejects demoting the last active admin (`LAST_ADMIN`).
  - Staff role requires an existing `canteen_id`; student and admin roles automatically clear `canteen_id` to `NULL`.
  - Trigger `prevent_profile_escalation` does not block this procedure because `current_user` inside `SECURITY DEFINER` routines is the routine owner, not `authenticated` or `anon`.
- **`public.admin_set_user_active(p_user_id, p_active)`**:
  - Cannot deactivate own account (`CANNOT_MODIFY_SELF`).
  - Cannot deactivate the last remaining active admin (`LAST_ADMIN`).

### 11.3 Canteen Operational Settings
- **`public.admin_update_canteen_settings(p_canteen_id, p_opens_at, p_closes_at, p_last_order_time, p_kitchen_capacity, p_min_lead_minutes, p_hold_minutes)`**:
  - Validates capacity (1..50), lead buffer (0..120 min), hold window (0..120 min), `closes_at > opens_at`, and `last_order_time` within operating hours. Returns clean `INVALID_INPUT` messages.

### 11.4 Dashboard Analytics & Listings
- **`public.admin_dashboard_stats(p_from, p_to)`**:
  - Date range capped at 92 days.
  - Status counts and top items computed using `placed_at`.
  - Revenue computed using `collected_at` strictly for `COLLECTED` orders.
  - Returns orders by hour across all 24 hours (0..23) in `Asia/Kolkata` timezone with zero fill.
- **`public.admin_list_orders(...)`**:
  - Clamps limit to 1..100, offset to $\ge 0$.
  - Escapes `\`, `%`, and `_` with explicit `ESCAPE '\'`.
  - **Security Invariant**: Strictly never selects or exposes `pickup_token`.
- **`public.admin_list_users(...)`**:
  - Joins `profiles` with `auth.users` to return only the user's `email` along with profile metadata.

### 11.5 Storage Bucket & Object Security
- Public bucket `menu-images` configured with 2 MB limit and allowed MIME types (`image/jpeg`, `image/png`, `image/webp`).
- Read allowed publicly; write/update/delete restricted to active admins via `public.is_admin()`.

### 11.6 Price Immutability & Menu Item Archiving
- **Price Changes Do Not Affect Past Orders**: `order_items` stores historical snapshots (`name_snapshot`, `unit_price_paise`) captured at checkout time. Updating `menu_items.price_paise` has zero impact on previous orders.
- **Archival vs Deletion**: `order_items.menu_item_id` enforces `ON DELETE RESTRICT`. Menu items that have ever been ordered cannot be hard deleted and must be archived via `is_active = false`. Archived items and categories are automatically hidden from student menus.

---

## 12. Best Sellers Real-Time Aggregation & Indexing

Added in migration `0008_best_sellers.sql`:

### 12.1 Procedure: `public.get_best_sellers`
- **Signature**: `public.get_best_sellers(p_canteen_id uuid, p_days int DEFAULT 30, p_limit int DEFAULT 8) RETURNS jsonb`
- **Security & Scope**: `SECURITY DEFINER`, `SET search_path = ''`.
- **Permissions**: Revoked from `PUBLIC` and `anon`; granted to `authenticated` and `service_role`.
- **Role Isolation**: Strictly restricted to active users with `role = 'student'` (following the 0007 pattern). Unauthenticated or inactive users receive exceptions; non-student roles receive `FORBIDDEN`.
- **Parameter Clamping**:
  - `p_days` clamped to `1..90` (defaults to 30) evaluated via `make_interval(days => v_days)`.
  - `p_limit` clamped to `1..20` (defaults to 8).
- **Ranking Logic**:
  - Aggregates `SUM(quantity)` from `order_items` joined to `orders` where `status = 'COLLECTED'` and `collected_at >= now() - make_interval(days => v_days)`.
  - Filtered by `menu_items.canteen_id = p_canteen_id`, `is_active = true`, and `is_available = true`.
  - Tied units broken alphabetically by item name (`ORDER BY total_sold DESC, mi.name ASC`).
  - Rank assigned with `ROW_NUMBER() OVER (ORDER BY total_sold DESC, mi.name ASC)`.
- **Threshold Rule**:
  - The 3-item threshold is evaluated across the full qualifying set (after item availability filtering, BEFORE applying `p_limit`).
  - If fewer than 3 items qualify across the canteen, returns `'[]'::jsonb` so the UI hides the section.
- **Units Sold Bucketing & Privacy Invariant**:
  - Units sold are bucketed into labels (`'500+'`, `'100+'`, `'50+'`, `'25+'`, `'10+'`, `'5+'`, `'Popular'`).
  - Returns strictly `menu_item_id`, `rank`, and `units_sold`.
  - Never leaks revenue, order IDs, user IDs, or exact low-volume quantities.

### 12.2 Indexing Strategy
- **Partial Composite Index**:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_orders_best_sellers_collected
  ON public.orders(canteen_id, collected_at DESC)
  WHERE status = 'COLLECTED';
  ```
  - Targets only `status = 'COLLECTED'` rows sorted by `collected_at DESC`, enabling an index range scan directly on the time window for the given canteen.
- **Join Index**:
  - `idx_order_items_order_id` on `public.order_items(order_id)` already covers the join between `orders` and `order_items`. No additional `order_items` index is needed.

---

## 13. Verified-Purchase Reviews & Rating System

Added in migration `0009_reviews.sql`:

### 13.1 Schema & Columns
- **Table `public.item_reviews`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE`
  - `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
  - `order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL` (qualifying collected order)
  - `rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5)`
  - `comment text CHECK (comment IS NULL OR (length(comment) <= 500 AND length(comment) > 0))`
  - `is_hidden boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - **Constraint**: `UNIQUE (user_id, menu_item_id)` — exactly one review per user per menu item.
  - **RLS & Access**: RLS enabled with 0 policies. Permissions revoked from `PUBLIC` and `anon`. All access mediated strictly through `SECURITY DEFINER` functions.
- **Table `public.menu_items` columns added**:
  - `rating_avg numeric(3,2) DEFAULT NULL CHECK (rating_avg IS NULL OR (rating_avg >= 1.00 AND rating_avg <= 5.00))`
  - `rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0)`
- **Column Protection Invariant**:
  - Trigger function `prevent_menu_item_unauthorized_update()` updated to block direct modification of `rating_avg` and `rating_count` by any authenticated role (`student`, `staff`, or `admin`). Only the internal database trigger or service role can update these fields.

### 13.2 Rating Synchronization Trigger
- **Function**: `public.handle_review_rating_sync()`
- **Trigger**: `trg_sync_menu_item_ratings AFTER INSERT OR DELETE OR UPDATE OF rating, is_hidden, menu_item_id ON public.item_reviews`
- **Race Condition Prevention & Locking**:
  - Executes explicit row locking first: `PERFORM 1 FROM public.menu_items WHERE id = <item_id> FOR UPDATE;`
  - Aggregates non-hidden reviews (`is_hidden = false`): `count = count(*)` and `avg = round(avg(rating)::numeric, 2)`.
  - Sets `rating_avg = NULL` and `rating_count = 0` when count is 0.
  - Handles `menu_item_id` change by resyncing both OLD and NEW menu items.

### 13.3 Procedures & Security Model
All procedures are `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified, revoked from `PUBLIC` and `anon`, and reloaded via `NOTIFY pgrst, 'reload schema'`.

- **`public.submit_review(p_menu_item_id uuid, p_rating smallint, p_comment text DEFAULT NULL) RETURNS jsonb`**:
  - Enforces active student role (`role = 'student'` and `is_active = true`).
  - Checks verified purchase: requires at least one order with `status = 'COLLECTED'` belonging to caller containing `p_menu_item_id`.
  - Rate limits: maximum 10 distinct reviews touched/created in the last 24 hours (`updated_at >= now() - interval '24 hours'`).
  - Strict input sanitization: turns whitespace (`\r`, `\n`, `\t`) into single spaces, removes control characters and unicode bidi/zero-width formatting overrides, trims, enforces $\le 500$ characters, and converts empty strings to `NULL`.
  - Upsert preserves moderation state: `DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()` (never resets `is_hidden`).
- **`public.delete_my_review(p_menu_item_id uuid) RETURNS jsonb`**:
  - Allows an active student to delete their own review. Deletion automatically triggers rating recalculation.
- **`public.list_item_reviews(p_menu_item_id uuid, p_limit int DEFAULT 20, p_offset int DEFAULT 0) RETURNS jsonb`**:
  - Verifies menu item existence (`NOT_FOUND` if absent).
  - Returns sanitized student reviews: only `rating`, `comment`, `created_at`, `display_name`, `is_mine`, `is_hidden`.
  - Strips review `id` and reviewer `user_id` from output for privacy.
  - Generates display names in SQL: First name + last initial (e.g., "John D."), single word preserved, blanks/emails masked to "Student", first name truncated to 20 chars.
  - Hidden reviews are excluded unless authored by caller (flagged with `is_hidden: true` and moderation note).
  - Returns rating breakdown histogram (`ratings_count: { "1": N, "2": N, "3": N, "4": N, "5": N }`).
- **`public.get_my_review_eligibility(p_menu_item_ids uuid[]) RETURNS jsonb`**:
  - Accepts up to 50 item IDs (deduped). Returns array of `{ menu_item_id, eligible, has_reviewed, existing_rating, existing_comment, is_hidden }`.
- **`public.admin_list_reviews(...)`**:
  - Active admin only. Provides paginated reviews with optional search and `status_filter` (`'all'`, `'active'`, `'hidden'`).
- **`public.admin_set_review_hidden(p_review_id uuid, p_hidden boolean, p_reason text DEFAULT NULL) RETURNS jsonb`**:
  - Active admin only. Moderates review visibility. If already in requested state, returns `changed: false` with zero audit log writes.
  - On status change, logs to `public.admin_audit_log` with `action = 'HIDE_REVIEW'` or `'UNHIDE_REVIEW'`, `actor_id = auth.uid()`.

### 13.4 Indexing Strategy
- `idx_item_reviews_item_active`: `(menu_item_id, created_at DESC)` WHERE `is_hidden = false` for high-throughput public review feeds.
- `idx_item_reviews_user_rate_limit`: `(user_id, updated_at DESC)` for the 24-hour review rate limiter.
- `idx_item_reviews_admin_feed`: `(created_at DESC)` for moderation queue sorting.

---

## 14. Campus Domain Restriction & Signup Hardening

Added in migration `0010_allowed_email_domains.sql`:

### 14.1 Schema & Columns
- **Table `public.allowed_email_domains`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `domain text NOT NULL UNIQUE`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL`
  - **Constraint**: `chk_allowed_domain_format` requires exact lowercase match, no `@`, no trailing dot, and standard label regex (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`).
  - **RLS & Access**: RLS enabled with 0 policies. Access revoked from `PUBLIC`, `anon`, and `authenticated`. Managed exclusively via `SECURITY DEFINER` routines.
- **Constraints & Indexes on `public.profiles`**:
  - `chk_profiles_student_college_id`: Enforces that any account with `role = 'student'` must have a non-null, non-empty `college_id` adhering to format `^[A-Za-z0-9_./-]{3,30}$`. Non-student accounts (`staff`, `admin`) are permitted to have `NULL` college IDs.
  - `idx_profiles_student_college_id_unique`: Unique index on `upper(trim(college_id))` for rows where `role = 'student'`.

### 14.2 Procedures & Trigger Pipeline
- **`public.is_signup_email_allowed(p_email text) RETURNS boolean`**:
  - `SECURITY DEFINER`, `SET search_path = ''`.
  - Permissions: Revoked from `PUBLIC`; granted to `anon`, `authenticated`, and `service_role`.
  - Normalizes email, enforces exactly one `@`, rejects plus-addressing (`+`), validates domain syntax, and checks exact presence in `public.allowed_email_domains`.
  - Discloses zero account-existence information; safe for public unauthenticated verification. Fails closed (returns `false` if `allowed_email_domains` is empty).
- **Trigger `trg_validate_student_signup` on `BEFORE INSERT ON auth.users`**:
  - Function: `public.validate_student_signup()`
  - Runs strictly on new user insertions into `auth.users` (new signups). Never fires on logins, magic links for existing users, or password resets.
  - Revoked from `PUBLIC`.
  - Bypasses domain and college ID checks if the account is an administrative invite (`NEW.invited_at IS NOT NULL`) or an admin-created user (`NEW.raw_app_meta_data->>'role' IN ('staff', 'admin')` or `is_admin_created = true`).
  - Enforces:
    - Exactly one `@` symbol; local part cannot be empty or contain `+` aliases.
    - Exact domain match against `public.allowed_email_domains` (fails closed).
    - College ID present in `NEW.raw_user_meta_data`, valid format (3-30 chars, alphanumeric + `_ . / -`), and uniqueness against existing student profiles.
- **Updated `public.handle_new_user()` on `AFTER INSERT ON auth.users`**:
  - Revoked from `PUBLIC`.
  - Normalizes `college_id` to uppercase.
  - Sanitizes `full_name`: control characters and newlines turned into spaces via `[[:cntrl:]]+`, bidi/zero-width formatting overrides stripped (`[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]`), multiple whitespaces collapsed to a single space, capped at 80 characters, and blank becomes `NULL`.
  - Preserves idempotent `ON CONFLICT (id) DO NOTHING`.
  - For admin-invited or admin-created users without student role, safely defaults role to `'staff'` (or specified admin role) with `is_active = false` until the administrator assigns a canteen.
- **Admin Procedures**:
  - `public.admin_list_allowed_domains() RETURNS jsonb`: Returns all configured domains with creation timestamps and administrator names.
  - `public.admin_add_allowed_domain(p_domain text, p_confirm_freemail boolean DEFAULT false) RETURNS jsonb`: Validates and normalizes domain. Blocks common consumer freemail domains (Gmail, Yahoo, Outlook, etc.) and public suffix/registry domains (ac.in, edu.in, edu, ac.uk, etc.) unless `p_confirm_freemail` is true. Idempotent: returns `changed: false` with zero audit writes if already present. Writes to `public.admin_audit_log` (`action = 'ADD_ALLOWED_DOMAIN'`).
  - `public.admin_remove_allowed_domain(p_domain text) RETURNS jsonb`: Deletes domain. Idempotent: returns `changed: false` with zero audit writes if already absent. Writes to `public.admin_audit_log` (`action = 'REMOVE_ALLOWED_DOMAIN'`).
  - `public.admin_set_user_role(...)`: Guard updated to raise clean `INVALID_INPUT` if an administrator attempts to change a user's role to `'student'` without a valid `college_id` matching `^[A-Za-z0-9_./-]{3,30}$`.

### 14.3 Known Limit
> [!NOTE]
> **Known Limitation (Self-Asserted College ID)**:
> Currently, `college_id` is self-asserted by the registrant during signup. Any user with a valid campus email address can claim any unused College ID. A centralized student roster allowlist (mapping student institutional emails directly to verified registrar College IDs) is the planned long-term solution and should be implemented prior to deploying penalty strikes for pickup no-shows.

### 14.4 Read-Only Audit & Migration Pre-Check Query
Before applying migration `0010_allowed_email_domains.sql`, run this query in the Supabase SQL Editor to verify that no existing rows violate the new constraints:
```sql
WITH student_duplicates AS (
  SELECT upper(trim(college_id)) AS dup_college_id, count(*) AS occurences
  FROM public.profiles
  WHERE role = 'student'
    AND college_id IS NOT NULL
    AND trim(college_id) != ''
  GROUP BY upper(trim(college_id))
  HAVING count(*) > 1
)
SELECT 
  p.id AS profile_id,
  p.full_name,
  p.college_id,
  p.role,
  p.created_at,
  CASE
    WHEN p.college_id IS NULL OR trim(p.college_id) = '' THEN 'MISSING_OR_BLANK_COLLEGE_ID'
    WHEN d.dup_college_id IS NOT NULL THEN 'DUPLICATE_COLLEGE_ID (' || d.occurences || ' times)'
    WHEN p.college_id !~ '^[A-Za-z0-9_./-]{3,30}$' THEN 'INVALID_COLLEGE_ID_FORMAT'
  END AS violation_type
FROM public.profiles p
LEFT JOIN student_duplicates d 
  ON upper(trim(p.college_id)) = d.dup_college_id
WHERE p.role = 'student'
  AND (
    p.college_id IS NULL 
    OR trim(p.college_id) = '' 
    OR d.dup_college_id IS NOT NULL
    OR p.college_id !~ '^[A-Za-z0-9_./-]{3,30}$'
  )
ORDER BY violation_type, p.created_at ASC;
```

Summary count check:
```sql
SELECT
  count(*) FILTER (WHERE college_id IS NULL OR trim(college_id) = '') AS missing_or_blank_count,
  count(*) FILTER (WHERE college_id IS NOT NULL AND trim(college_id) != '' AND college_id !~ '^[A-Za-z0-9_./-]{3,30}$') AS invalid_format_count
FROM public.profiles
WHERE role = 'student';
```

### 14.5 Provisioning Staff & Admin Accounts (Invite User, Not Create User)
> [!IMPORTANT]
> **Always use "Invite user", NEVER "Create user" for Staff/Admin accounts.**
> 
> 1. In Supabase Dashboard: Navigate to **Authentication > Users > Add user > Invite user** (or use the backend Admin API `inviteUserByEmail`).
> 2. **Why**: "Invite user" sets `invited_at = now()`. The `trg_validate_student_signup` trigger detects `invited_at IS NOT NULL` and bypasses student campus domain and College ID requirements.
> 3. **Warning**: Dashboard **"Create user"** (which sets email and password directly) leaves `invited_at = NULL` and empty `raw_app_meta_data`. It is treated as an untrusted student registration and will be **immediately aborted** with `MISSING_COLLEGE_ID` or `DOMAIN_NOT_ALLOWED`.
> 4. **Post-Invite Administrator Steps**:
>    - When invited, `handle_new_user()` creates the profile with `role = 'staff'`, `canteen_id = NULL`, and `is_active = false`.
>    - Step A: Assign the staff member to their designated canteen via procedure:
>      `SELECT public.admin_set_user_role('<user-uuid>', 'staff'::public.user_role, '<canteen-uuid>');`
>    - Step B: Activate the user account:
>      `SELECT public.admin_set_user_active('<user-uuid>', true);`

---

## 15. Exact Migration Apply Order

The database migrations must strictly be applied in sequential order:

1. `0001_schema.sql` — Core tables, enums, sequences, and initial trigger routines.
2. `0002_rls.sql` — Row Level Security policies and security-invoker escalation guards.
3. `0003_place_order.sql` — Atomic order placement engine with capacity checks.
4. `0004_order_tracking.sql` — Order tracking and pickup token generation.
5. `0005_staff_operations.sql` — Kitchen staff queue lifecycle and order transition procedures.
6. `0006_admin_operations.sql` — Administrator management procedures, audit logs, and analytics.
7. `0007_role_isolation.sql` — Strict role separation and student/staff context isolation.
8. `0008_best_sellers.sql` — Real-time popularity ranking and best seller views.
9. `0009_reviews.sql` — Verified-purchase ratings and item review moderation.
10. **Pre-check Audit Query** — Run read-only query (Section 14.4) to confirm zero student violations.
11. `0010_allowed_email_domains.sql` — Campus domain restriction and signup hardening.
12. `0011_cleanup_unconfirmed_users.sql` — Scheduled/admin cleanup routine for unconfirmed stale signups.





