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
| `pickup_token` | `text` | NULL (0014) | DEPRECATED: Always NULL since 0014 cutover; to be dropped in a later migration. |
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
| `collection_method`| `collection_method_enum` | NULL (0013) | Handover method: `SCAN`, `PIN`, or `MANUAL` |
| `collected_with` | `collected_with_enum` | NULL (0013) | Settlement mode: `CASH` or `UPI` |
| `pickup_for_name` | `text` | NULL (0013) | Sanitized delegate name if ordered for a peer |
| `is_manual_override`| `boolean` | NOT NULL, `DEFAULT false` (0013) | Flag indicating manual staff bypass |
| `manual_override_reason` | `text` | NULL (0013) | Mandatory staff reason for manual collection |
| `collected_by` | `uuid` | NULL, REFERENCES `profiles(id)` (0013) | Staff member who fulfilled the order |

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

## 8. Order Placement Procedure (`public.place_order`)

Originally added in migration `0003_place_order.sql`, updated with student role isolation in `0007_role_isolation.sql`, and cut over to smart pickup in `0014_collection_cutover.sql`:

### 8.1 Function Signature
```sql
public.place_order(
  p_canteen_id uuid,
  p_items jsonb, -- array of {"menu_item_id": uuid, "quantity": integer}
  p_payment_method public.payment_method,
  p_idempotency_key text,
  p_requested_at timestamptz DEFAULT NULL,
  p_pickup_for_name text DEFAULT NULL
) RETURNS jsonb
```
- **Security**: `SECURITY DEFINER`, `SET search_path = ''`.
- **Permissions**: Revoked from `PUBLIC`, `anon`; granted to `authenticated`, `service_role`.
- **Caller Context**: Strictly derives user from `auth.uid()`. Role must be `student` and active.
- **5-Arg Signature Dropped**: Exact 5-argument signature `(uuid, jsonb, public.payment_method, text, timestamptz)` dropped in `0014_collection_cutover.sql` with post-apply assertion verifying exactly one overload exists.

### 8.2 Execution Guarantees
1. **Idempotency**: Dual-check pattern (evaluated at start and re-checked immediately after acquiring the canteen row lock). Concurrent race conditions on `(user_id, idempotency_key)` are caught by a sub-block `unique_violation` handler that returns the committed order with `was_duplicate = true` while rolling back stock decrements.
2. **Canteen Lock**: Acquires `FOR UPDATE` on `public.canteens` before executing `estimate_ready_time` to prevent race conditions during operating hours transitions.
3. **Active Order Limit**: Maximum 3 active orders per user (`PLACED`, `ACCEPTED`, `PREPARING`, `READY`).
4. **Deadlock Prevention & Stock Guard**: Target `menu_items` rows locked `FOR UPDATE ORDER BY id ASC`. Null quantity guard (`v_qty IS NULL OR v_qty < 1 OR v_qty > MAX_ITEM_QTY`) strictly prevents invalid inputs.
5. **Price Integrity**: Prices calculated exclusively from locked database rows; client prices are completely untrusted.
6. **Pickup Designee Name Sanitization**:
   - Order: Strip invisible/bidi characters (`U+200B-200F`, `U+202A-202E`, `U+2060`, `U+2066-2069`, `U+FEFF`), collapse `\s+ -> ' '`, strip leftover control characters (`[\x00-\x1F\x7F]`), `btrim`, truncate to 40 characters, `btrim` again, and map empty string to `NULL`.
   - Never raises an exception on name length.
7. **Zero Static Token**: Order inserted with `pickup_token = NULL`.
8. **Cryptographic Secret Row**: Atomically inserts a 64-character hex secret into `public.order_pickup_secrets` for dynamic TOTP and PIN generation.
9. **Audit & Alerts**: Automatically creates a record in `public.notifications` upon successful placement.

### 8.3 Error Codes Taxonomy
| Error Code | Trigger Condition |
|---|---|
| `UNAUTHENTICATED` | `auth.uid()` is null |
| `USER_INACTIVE` | Profile deactivated or not found |
| `FORBIDDEN` | Caller is not a student |
| `INVALID_PAYMENT_METHOD` | Payment method other than `PAY_AT_PICKUP` |
| `INVALID_IDEMPOTENCY_KEY` | Key is null, empty, or exceeds 64 characters |
| `INVALID_INPUT` | Empty items, > 20 distinct items, or item quantity not in 1..10 |
| `CANTEEN_NOT_FOUND` | Specified canteen ID does not exist |
| `CANTEEN_CLOSED` | Canteen is inactive or outside operating hours |
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

## 10. Phase 7: Staff Kitchen Operations & Order Lifecycle

Added in migration `0005_staff_operations.sql` and updated in `0014_collection_cutover.sql`:

### 10.1 Order Lifecycle Transition (`public.transition_order`)
- **Signature**: `public.transition_order(p_order_id uuid, p_to_status public.order_status) RETURNS jsonb`
- **Security**: `SECURITY DEFINER`, `search_path = ''`. Restricted to `authenticated` and `service_role`.
- **Caller Context**: Strictly `auth.uid()`. Role must be `staff` or `admin`.
- **Canteen Isolation**: Staff members are strictly validated against `order.canteen_id` using `IS DISTINCT FROM` (staff with NULL `canteen_id` receive `FORBIDDEN`). Admins can operate on any canteen.
- **Allowed Lifecycle Transitions**:
  - `PLACED` $\rightarrow$ `ACCEPTED` or `REJECTED`
  - `ACCEPTED` $\rightarrow$ `PREPARING`
  - `PREPARING` $\rightarrow$ `READY`
  - *Collection Cutover Constraint*: **Direct transition to `COLLECTED` is strictly forbidden** (`FORBIDDEN: Orders can only be collected via the collect_order function`). Counter collections must occur exclusively via `public.collect_order`.
  - Rejection is permitted only while an order is in `PLACED` stage.
- **Idempotency**: Same-status requests return `{ "order_id": ..., "status": ..., "was_noop": true }` to absorb network retries and double-taps safely.
- **Settlement & Side Effects**:
  - Updates matching timestamp (`accepted_at`, `preparing_at`, `ready_at`, `rejected_at`).
  - On `REJECTED`: Restores reserved stock via deadlock-free row locks on `menu_items`.

### 10.2 Counter Pickup Verification & Cutover
- **Legacy `public.verify_pickup` Dropped**: The static token verification procedure is dropped in `0014_collection_cutover.sql`.
- **Static `pickup_token` Deprecation**: `public.orders.pickup_token` is made nullable and cleared to `NULL` for all existing orders. New orders no longer generate static tokens.
- **Smart Counter Collection**: All counter pickup operations transitioned to `public.preview_collection` and `public.collect_order` (Section 16).

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

Added in migration `0009_reviews.sql` and updated in `0012_review_fixes.sql`:

### 13.1 Schema & Columns
- **Table `public.item_reviews`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE`
  - `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
  - `order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL` (qualifying collected order)
  - `rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5)`
  - `comment text NULL CHECK (comment IS NULL OR length(comment) <= 500)`
  - `is_hidden boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - **Constraint**: `CONSTRAINT uq_item_reviews_user_item UNIQUE (user_id, menu_item_id)` — exactly one review per user per menu item.
  - **RLS & Access**: RLS enabled with 0 policies. Permissions revoked from `PUBLIC`, `anon`, and `authenticated`. Granted exclusively to `service_role`. All user access mediated strictly through `SECURITY DEFINER` functions.
- **Table `public.menu_items` columns added**:
  - `rating_avg numeric(3,2) DEFAULT NULL`
  - `rating_count integer NOT NULL DEFAULT 0`
- **Column Protection Invariant**:
  - Trigger function `prevent_menu_item_unauthorized_update()` updated to block direct modification of `rating_avg` and `rating_count` by any authenticated caller (`student`, `staff`, or `admin`). Only internal `SECURITY DEFINER` trigger routines or service role can modify these columns.

### 13.2 Rating Synchronization Trigger
- **Function**: `public.handle_review_rating_sync()`
- **Trigger**: `trg_sync_menu_item_ratings AFTER INSERT OR DELETE OR UPDATE OF rating, is_hidden, menu_item_id ON public.item_reviews FOR EACH ROW EXECUTE FUNCTION public.handle_review_rating_sync()`
- **Race Condition Prevention & Locking (Updated in 0012)**:
  - Executes row locking: `PERFORM 1 FROM public.menu_items WHERE id = <item_id> FOR NO KEY UPDATE;`
  - **Why `FOR NO KEY UPDATE`**: In PostgreSQL, foreign key checks on child tables (like `order_items` or `item_reviews` referencing `menu_items(id)`) acquire `FOR KEY SHARE` locks on the referenced `menu_items` row. `FOR UPDATE` is an exclusive tuple lock that directly conflicts with `KEY SHARE`, causing transaction deadlocks under high concurrency. `FOR NO KEY UPDATE` locks the row against concurrent data modifications without conflicting with foreign key `KEY SHARE` checks.
  - Aggregates non-hidden reviews (`is_hidden = false`): `count = count(*)` and `avg = round(avg(rating)::numeric, 2)`.
  - Sets `rating_avg = v_avg` and `rating_count = COALESCE(v_cnt, 0)` (when count is 0, `rating_avg` becomes `NULL` and `rating_count` becomes 0).
  - Handles `menu_item_id` change on update by resyncing both OLD and NEW menu items.

### 13.3 Procedures & Security Model
All procedures are `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified, revoked from `PUBLIC` and `anon`, granted to `authenticated` and `service_role`, and reloaded via `NOTIFY pgrst, 'reload schema'`.

- **`public.submit_review(p_menu_item_id uuid, p_rating integer, p_comment text DEFAULT NULL) RETURNS jsonb`**:
  - Enforces active student role (`role = 'student'` and `is_active = true`).
  - Checks verified purchase: requires at least one order with `status = 'COLLECTED'` belonging to caller containing `p_menu_item_id`.
  - Rate limits: maximum 10 distinct reviews touched/created in rolling 24 hours (`updated_at >= now() - interval '24 hours'`).
  - Input sanitization (Updated in 0012): converts whitespace (`\r`, `\n`, `\t`) into single spaces, strips control characters, zero-width spaces (`\u200B-\u200F`), bidi overrides (`\u202A-\u202E`, `\u2066-\u2069`), word-joiner (`\u2060`), and byte-order mark (`\uFEFF`) via `[\x00-\x1F\x7F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]`. Trims, enforces $\le 500$ characters, and empty/whitespace becomes `NULL`.
  - Upsert preserves moderation state: `ON CONFLICT (user_id, menu_item_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, order_id = EXCLUDED.order_id, updated_at = now()` (omits `is_hidden` so existing moderation state persists).
  - Returns `{ id, menu_item_id, rating, comment, is_hidden, created_at, updated_at }`.
- **`public.delete_my_review(p_menu_item_id uuid) RETURNS jsonb`**:
  - Allows an active student to delete their own review. Raises `NOT_FOUND` if caller has no review for the item.
  - Deletion automatically triggers rating recalculation via `handle_review_rating_sync()`.
  - Returns `{ success: true, deleted: true }`.
- **`public.list_item_reviews(p_menu_item_id uuid, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0) RETURNS jsonb`**:
  - Enforces active student role (Updated in 0012: `role = 'student'` and `is_active = true`, `FORBIDDEN` otherwise).
  - Verifies menu item existence (`NOT_FOUND` if absent).
  - Clamps `p_limit` to `[1, 50]` (default 10) and `p_offset` to `[0, inf)` (default 0).
  - Computes 1..5 star histogram strictly from non-hidden reviews under key `'histogram'`: `{ "1": N, "2": N, "3": N, "4": N, "5": N }`.
  - Returns sanitized student reviews: only `rating`, `comment`, `created_at`, `display_name`, `is_mine`, `is_hidden`.
  - Strips review `id` and reviewer `user_id` from output for privacy.
  - Generates display names in SQL: First name + last initial (e.g., "Ravi K."), single word preserved ("Ravi"), blanks/emails masked to "Student", first name truncated to 20 chars.
  - Hidden reviews are excluded unless authored by caller (`is_hidden = false OR user_id = auth.uid()`).
  - Returns `{ menu_item_id, rating_avg, rating_count, histogram, reviews }`.
- **`public.get_my_review_eligibility(p_menu_item_ids uuid[]) RETURNS jsonb`**:
  - Enforces active student role (`role = 'student'` and `is_active = true`).
  - Accepts up to 50 item IDs (deduped). Returns array of `{ menu_item_id, can_review, has_reviewed, my_rating, my_comment, my_is_hidden, my_updated_at }`.
  - Returns `'[]'::jsonb` when input is empty or NULL.
- **`public.admin_list_reviews(p_status text DEFAULT 'all', p_search text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb`**:
  - Active admin only (`role = 'admin'` and `is_active = true`).
  - Status filtering: `'all'`, `'visible'`, `'hidden'`.
  - Input search capped at 100 characters before escaping (Updated in 0012). Searches item name, canteen name, reviewer name, reviewer email, and review comment.
  - Clamps `p_limit` to `[1, 100]` (default 20) and `p_offset` to `[0, inf)` (default 0).
  - Returns `{ reviews, total_count, limit, offset }`.
- **`public.admin_set_review_hidden(p_review_id uuid, p_hidden boolean) RETURNS jsonb`**:
  - Active admin only (`role = 'admin'` and `is_active = true`). Signature takes 2 arguments: `p_review_id`, `p_hidden`.
  - If already in requested state, returns `{ success: true, changed: false, review_id, is_hidden }` with zero audit log writes.
  - On status change, sets `is_hidden = p_hidden` WITHOUT updating `updated_at` (Updated in 0012; preserves the author's review timestamp).
  - Logs to `public.admin_audit_log` with `action = 'HIDE_REVIEW'` or `'UNHIDE_REVIEW'`, `target_type = 'item_review'`, `actor_id = auth.uid()`.
  - Returns `{ success: true, changed: true, review_id, is_hidden }`.

### 13.4 Indexing Strategy
- `idx_item_reviews_item_visible_created`: `ON public.item_reviews(menu_item_id, created_at DESC) WHERE is_hidden = false` for high-throughput public review feeds, histogram computation, and trigger aggregates.
- `idx_item_reviews_user_updated`: `ON public.item_reviews(user_id, updated_at DESC)` for user review eligibility lookups and the 24-hour rate limiter.

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
>    - **Important**: The procedures `admin_set_user_role` and `admin_set_user_active` require `auth.uid()`. In the Supabase SQL Editor, `auth.uid()` is `NULL`, so calling them directly there will raise `UNAUTHENTICATED: Must be logged in`.
>    - **Recommended Method (Web Application UI)**:
>      Log into the application as an active administrator and navigate to the **Admin Users page** at `/admin/users` (rendered by [`UsersView`](file:///src/components/admin/users-view.tsx)):
>      - **Role & Canteen**: Click **"Edit Role"** on the user row, select `Staff` (and choose the assigned Canteen from the dropdown) or `Admin`, then save. This calls `adminSetUserRoleAction(activeUser.id, newRole, canteenId)` with the authenticated admin's session and records an audit log row.
>      - **Activation**: Click the **"Activate"** toggle button. This calls `adminSetUserActiveAction(user.id, true)` with the authenticated admin's session and records an audit log row.
>    - **SQL Editor Fallback (Direct Postgres Update)**:
>      If bootstrapping or configuring directly in the Supabase SQL Editor (running as superuser `postgres`), update `public.profiles` directly:
>      ```sql
>      -- Assign staff member to a canteen and activate account
>      UPDATE public.profiles
>      SET 
>        role = 'staff'::public.user_role,
>        canteen_id = '<canteen-uuid>',
>        is_active = true
>      WHERE id = '<user-uuid>';
>
>      -- Or to configure an administrator account:
>      UPDATE public.profiles
>      SET 
>        role = 'admin'::public.user_role,
>        canteen_id = NULL,
>        is_active = true
>      WHERE id = '<user-uuid>';
>      ```
>      *Note: Directly updating `public.profiles` in the SQL Editor bypasses the `admin_set_user_role` and `admin_set_user_active` RPCs, so no audit row is written to `public.admin_audit_log`.*

### 14.6 Authentication Configuration (Site URL & Redirect URLs)

> [!IMPORTANT]
> **Site URL is a project-wide setting:**
> Supabase Auth uses a single project-wide **Site URL** (`{{ .SiteURL }}`) as the base address for all transactional email templates (Staff Invites, Password Resets, and Signup Confirmations).
> - Setting Site URL to `http://localhost:3000` is strictly for **solo local development testing**.
> - It **must be reverted to `https://<YOUR-PRODUCTION-DOMAIN>` before anyone else registers or signs up**, otherwise links sent to users will point to localhost and fail.
> - Where to find `<YOUR-PRODUCTION-DOMAIN>`: In your hosting provider dashboard (e.g. Vercel Project Overview > Domains, or your custom domain).

#### Required Dashboard Redirect URLs
In **Supabase Dashboard > Authentication > URL Configuration > Redirect URLs**, configure:
```
http://localhost:3000/auth/confirm
http://localhost:3000/auth/callback
https://<YOUR-PRODUCTION-DOMAIN>/auth/confirm
https://<YOUR-PRODUCTION-DOMAIN>/auth/callback
```

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
10. `0012_review_fixes.sql` — Reviews concurrency hardening (FOR NO KEY UPDATE), student role requirement on review listing, updated_at preservation on moderation, extended unicode stripping (\u2060, \uFEFF), and admin search capping.
11. **Pre-check Audit Query** — Run read-only query (Section 14.4) to confirm zero student violations.
12. `0010_allowed_email_domains.sql` — Campus domain restriction and signup hardening.
13. `0011_cleanup_unconfirmed_users.sql` — Scheduled/admin cleanup routine for unconfirmed stale signups with dry-run support, staff/invited exclusion, and 200 batch deletion limit.
14. `0013_collection_core.sql` — Collection Core v2 (Additive): New orders columns, `pickup_collect_attempts`, `order_pickup_secrets` (RLS on, 0 policies, revoked from PUBLIC, anon, authenticated, service_role), `pickup_hmac` wrapper (`extensions.hmac` with empty search_path, revoked from service_role too), internal TOTP/PIN helpers (revoked from service_role too), `get_pickup_code`, `preview_collection`, `collect_order`, dispute reporting (`order_collection_reports`, `report_unauthorized_collection`), and in-flight secrets backfill.
15. `0014_collection_cutover.sql` — Collection Cutover v2: Replaces `transition_order` (strictly refuses `COLLECTED`), replaces `place_order` based on 0007 definition (exact 5-arg DROP, adds `p_pickup_for_name`, generates secret row, inserts NULL token), drops `verify_pickup`, nullifies existing `pickup_token`s, updates `handle_order_status_notification` trigger function (revoked from PUBLIC, anon, authenticated), and appends idempotent secrets backfill to the end.
16. `0015_pickup_code_grace.sql` — Pickup Code 10s Grace Window: Enforces NULL-safe offset validation (`IF p_window_offset IS NULL OR p_window_offset NOT IN (0, -1) THEN RETURN NULL`), computes `v_epoch` once from `clock_timestamp()` to derive both window number and second-in-window, restricts previous-window code (`offset -1`) to a 10-second grace window (`second_in_window < 10`), and revokes execution from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
17. Deploy updated web application.

---

## 16. Collection Core & Smart Counter Pickup

Added in migrations `0013_collection_core.sql` (additive), `0014_collection_cutover.sql` (cutover), and `0015_pickup_code_grace.sql`:

### 16.1 Architecture & Token Invariant Resolution
- **Deprecation of Static `pickup_token`**:
  - Previously, `pickup_token` was a static 6-digit number on `public.orders`, viewable across the canteen by staff under table-level SELECT RLS.
  - In `0014_collection_cutover.sql`, `pickup_token` is made nullable and set to `NULL` for all orders. New orders no longer generate static tokens.
  - `pickup_token` is completely deprecated (always `NULL` since 0014 cutover) and will be formally dropped from `public.orders` in a later migration.
- **Separate Secrets Table (`public.order_pickup_secrets`)**:
  - `order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE`
  - `secret text NOT NULL`: 64-character cryptographic hex string derived from `replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')` (zero external extension dependencies).
  - `failed_pin_attempts integer NOT NULL DEFAULT 0`
  - `is_pin_locked boolean NOT NULL DEFAULT false`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - **RLS & Security**: RLS enabled with 0 policies. All privileges revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Accessible strictly via `SECURITY DEFINER` routines. Neither students nor staff can ever select rows from this table.
- **Secret Lifecycle Invariant**:
  - The pickup secret is created when the order is **`PLACED`** (`place_order` inserts the secret row into `public.order_pickup_secrets` upon initial placement) and was backfilled for in-flight orders (`PLACED`, `ACCEPTED`, `PREPARING`, `READY`) in migrations `0013_collection_core.sql` and `0014_collection_cutover.sql`.
  - The pickup secret is **not** created at `READY`.

### 16.2 Internal Cryptographic Wrapper (`public.pickup_hmac`) & Helpers
- `public.pickup_hmac(p_key text, p_msg text) RETURNS bytea`:
  - `SECURITY DEFINER`, `SET search_path = ''`.
  - The **only** procedure in the database referencing `pgcrypto`. Checks `extensions.hmac` with dynamic fallback to `public.hmac`.
  - Revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- `public.internal_get_pickup_pin(p_order_id uuid) RETURNS text` & `public.internal_get_pickup_code(p_order_id uuid, p_window_offset integer) RETURNS text`:
  - `SECURITY DEFINER`, `SET search_path = ''`.
  - Enforces NULL-safe offset validation (`IF p_window_offset IS NULL OR p_window_offset NOT IN (0, -1) THEN RETURN NULL`).
  - Evaluates `v_epoch` once from `clock_timestamp()` and derives both the window number (`v_epoch / 60`) and the second-in-window (`v_epoch % 60`) from that single reading.
  - Implements the 10-second grace window: offset `-1` returns `NULL` whenever `v_second_in_window > 10` (using top-level constant `c_grace_seconds = 10`).
  - Revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.

### 16.3 Dynamic QR Payload & Rotating TOTP Codes
- **QR Payload Format**: `'CC1:<order_id>:<code>'` (e.g. `CC1:123e4567-e89b-12d3-a456-426614174000:482910`).
- **60-Second Window**: Evaluated as `floor(extract(epoch from clock_timestamp()) / 60)::bigint`.
- **Tolerance & 10-Second Grace Rule**:
  - Staff preview and collection procedures accept the current window code (`window`) at all times throughout the 60-second window.
  - In addition, the immediately preceding window (`window - 1`) is accepted **strictly and exclusively** during the first 10 seconds of the new window (`epoch % 60 <= 10`) to absorb network transit delays and scan timing skew.
  - Once 10 seconds have elapsed in the current window (`epoch % 60 > 10`), the previous window code is strictly rejected (the internal helper returns `NULL`).
  - Codes from two or more windows ago (`window - 2` or earlier) or future windows are always rejected.
- **Preview-to-Collect 90-Second Binding Rule**:
  - When staff verifies an order at the counter via `preview_collection`, a marker row is inserted into `public.pickup_collect_attempts` with `method = 'PREVIEW'` and `outcome = 'SUCCESS'`.
  - Because `outcome = 'SUCCESS'`, this marker row is strictly excluded from staff failure (`outcome != 'SUCCESS'`) and order failure rate limit checks.
  - When staff subsequently confirms payment and triggers `collect_order` (method `SCAN`), the code is accepted if currently valid OR if the caller has a valid `PREVIEW`/`SUCCESS` marker for the same order within the last 90 seconds (`attempted_at >= now() - interval '90 seconds'`).
  - A marker from another staff member (`staff_id != auth.uid()`), for another order (`order_id != p_order_id`), or older than 90 seconds cannot be used.
  - Amber orders still strictly require the student's 4-digit PIN even with a fresh preview marker.
- **PIN Derivation**: A 4-digit numeric fallback PIN is deterministically derived from `public.pickup_hmac(secret, 'pin:' || order_id)`. The PIN is never stored in plaintext or hashed format in the database and is stable across repeated calls.

### 16.4 Stored Procedures
- **`public.get_pickup_code(p_order_id uuid) RETURNS jsonb`**:
  - Accessible to authenticated student owning the order.
  - Allowed **strictly and exclusively** when `order.status = 'READY'`. Returns `{ ok: false, error: 'ORDER_NOT_READY' }` otherwise.
  - Returns `{ ok: false, error: 'PICKUP_UNAVAILABLE' }` if the order is in `READY` status but no cryptographic secret exists in `order_pickup_secrets`.
  - Returns `{ ok: true, order_id, order_code, code, seconds_remaining, pin, pickup_for_name }`. The PIN returned is stable and identical across repeated invocations for the same order. Never returns the secret.
- **`public.preview_collection(p_canteen_id, p_order_ref, p_code, p_pin) RETURNS jsonb`**:
  - Staff / Admin only. Does not alter database order state.
  - Locates order by UUID or `order_code` (e.g. `CN10001`). Enforces canteen isolation for staff: returns `NOT_FOUND` (not `FORBIDDEN`) on cross-canteen queries.
  - Rate limiting: $\ge 10$ failed attempts in 5 minutes per staff returns `RATE_LIMITED_STAFF`; $\ge 10$ failed attempts in 10 minutes per order returns `RATE_LIMITED_ORDER`.
  - Missing secret: Returns `{ ok: false, error: 'NO_PICKUP_SECRET' }` if secret row is absent.
  - **Amber Threshold**: Evaluated if total item quantity $> 5$ or `total_paise > 50000` (> ₹500). Amber orders require **both** the rotating code and the 4-digit PIN. PIN-only collection is refused. If PIN is locked, returns `PIN_LOCKED`.
  - **Incomplete Credentials Protection**: Scenarios where a valid rotating code was scanned but PIN has not yet been submitted are NOT logged as failures in `pickup_collect_attempts`.
  - Non-amber orders allow rotating code or PIN-only verification. If PIN is locked, valid rotating code SCAN still succeeds.
  - On verification success, writes `method = 'PREVIEW'`, `outcome = 'SUCCESS'` marker into `pickup_collect_attempts` to bind verification to collection for 90 seconds.
  - Returns scan card data: `{ ok: true, order_id, order_code, first_name, college_id_last4, pickup_for_name, total_paise, total_items, is_amber, items }`. Never returns email or full name.
- **`public.collect_order(p_canteen_id, p_order_id, p_collected_with, p_method, p_code, p_pin, p_reason) RETURNS jsonb`**:
  - Staff / Admin only. Locks order `FOR UPDATE`.
  - Rejects `NULL` `p_collected_with` and `p_method` strictly with `INVALID_INPUT`. Accepts `p_collected_with IN ('CASH', 'UPI')` and `p_method IN ('SCAN', 'PIN', 'MANUAL')`.
  - Cross-canteen lookups return `NOT_FOUND` (not `FORBIDDEN`).
  - Missing secret: Returns `{ ok: false, error: 'NO_PICKUP_SECRET' }` for SCAN or PIN verification if secret row is absent, without modifying order status or marking the order collected.
  - Re-verifies credentials and amber requirements atomically. In method SCAN, accepts if rotating code is valid or if a fresh (<= 90s) PREVIEW/SUCCESS marker exists from the same staff for this order. Incomplete amber credentials are not logged as failures.
  - 3 wrong PIN attempts lock the order PIN counter (`is_pin_locked = true`), returning `PIN_LOCKED`. A valid QR scan on a non-amber PIN-locked order continues to succeed.
  - **Manual Collection**: Allowed for students with depleted phone batteries or broken screens. Requires `p_reason` with length $\ge 5$ characters. Capped at 10 manual collections per staff member per rolling 24 hours (returns `{ ok: false, error: 'MANUAL_LIMIT' }`). Dispatches an alert notification to the student and logs to `public.admin_audit_log`.
  - Transitions order to `COLLECTED`, sets `payment_status = 'PAID'`, records `collected_at`, `collected_by`, `collected_with`, `collection_method`, and `manual_override_reason`.
  - Idempotent against double collection: second call returns `{ ok: false, error: 'ALREADY_COLLECTED' }`.
  - Logs `action = 'ORDER_COLLECTED'` in `public.admin_audit_log`.
- **`public.transition_order(p_order_id, p_to_status) RETURNS jsonb`**:
  - Redefined to **strictly refuse `COLLECTED`** with `FORBIDDEN: Orders can only be collected via the collect_order function`.
  - Retains all other transitions (`PLACED` $\rightarrow$ `ACCEPTED`/`REJECTED`, `ACCEPTED` $\rightarrow$ `PREPARING`, `PREPARING` $\rightarrow$ `READY`).
- **`public.report_unauthorized_collection(p_order_id uuid, p_reason text) RETURNS jsonb`**:
  - Student dispute mechanism ("Not me").
  - Allowed only for student's own order, strictly within 24 hours of `collected_at`.
  - Enforces 30-day rolling cap of 3 dispute reports per student.
  - Sanitization order: strip invisible/bidi characters (`[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]`), collapse `\s+ -> ' '`, strip leftover control characters (`[\x00-\x1F\x7F]`), `btrim`, truncate 500, `btrim`, empty -> `NULL`. Minimum length 5 characters.
  - Writes to `public.order_collection_reports`. Duplicate reports on same order return `ALREADY_REPORTED`.
- **`public.admin_list_collection_reports(...)` & `public.admin_resolve_collection_report(...)`**:
  - Administrator review and dispute resolution procedures.
  - Admin notes sanitized with standard sanitization order.
  - Resolving locks report row `FOR UPDATE`. If already resolved, returns `{ ok: true, changed: false }` with zero duplicate audit rows written. Writes `action = 'RESOLVE_COLLECTION_REPORT'` in `public.admin_audit_log`.
- **`public.handle_order_status_notification()`**:
  - Dispatches notifications on status changes including `COLLECTED` (distinguishing manual overrides).
  - Privileges revoked from `PUBLIC`, `anon`, and `authenticated`.

### 16.5 Quiet-Time Warning & Student UX Shift
> [!IMPORTANT]
> **Quiet-Time Notice for Deployment**:
> - Applying migration `0013_collection_core.sql` immediately switches pickup verification from static tokens to dynamic 60-second TOTP codes.
> - In-flight orders in `PLACED`, `ACCEPTED`, `PREPARING`, or `READY` status are automatically backfilled with a cryptographic secret during migration execution.
> - **Student Screen Change**: A student whose order is currently in `READY` status will immediately see the new Dynamic Smart Pickup screen upon refresh: an animated 60-second countdown ring, rotating QR code, rotating 6-digit code, and 4-digit counter fallback PIN.
> - Staff counter scanners running the updated application will scan `CC1:<order_id>:<code>`, render the green/amber preview card, and record cash or UPI collection with a single tap.

---

## 17. Order Expiry, No-Show Lifecycle, & Daily Reconciliation

Added in migrations `0016_order_status_no_show.sql` and `0017_no_show_enforcement.sql`.

### 17.1 Two-Stage Migration & Deployment Sequence
PostgreSQL requires enum type extensions to be committed before new values can be referenced in composite types, PL/pgSQL routines, or check constraints within transactional migration blocks.
1. **Migration 0016 (`0016_order_status_no_show.sql`)**:
   - Standalone `ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'NO_SHOW';`
   - Must execute outside any transaction block (`no BEGIN / COMMIT`).
   - Followed by `NOTIFY pgrst, 'reload schema';`.
2. **Migration 0017 (`0017_no_show_enforcement.sql`)**:
   - Executes inside a standard transaction block (`BEGIN ... COMMIT`).
   - Contains all table definitions, indexes, RPC replacements, and policy updates.

### 17.2 Database Objects
- **`public.student_strike_resets`**:
  Tracks administrative strike clears without modifying historical order records.
  | Column | Type | Constraints / Default | Description |
  |---|---|---|---|
  | `student_id` | `uuid` | PK, REFERENCES `profiles(id)` ON DELETE CASCADE | Student whose strikes were cleared |
  | `cleared_at` | `timestamptz` | NOT NULL, `DEFAULT clock_timestamp()` | Timestamp of clearing |
  | `cleared_by` | `uuid` | NOT NULL, REFERENCES `profiles(id)` | Admin who cleared strikes |
  | `reason` | `text` | NOT NULL | Mandatory administrative rationale |
- **Index `idx_orders_status_ready_at`**:
  `CREATE INDEX idx_orders_status_ready_at ON public.orders (status, ready_at) WHERE status = 'READY';`
  Enables instant index scans during periodic sweep routines without sequential table scans.

### 17.3 Hold Window Expiry & Concurrency Architecture
- **Expiry Base**: Calculated from actual `ready_at` (`ready_at + (canteen.hold_minutes * interval '1 minute')`). If `ready_at` is NULL (legacy), falls back to `pickup_window_end`.
- **Concurrency Locking**:
  - `preview_collection`, `get_pickup_code`, and `collect_order` lock the order row using `FOR UPDATE`.
  - The sweep routine `mark_no_shows` locks qualifying rows using `FOR UPDATE OF o SKIP LOCKED`.
  - All status updates are strictly guarded with `WHERE status = 'READY'` to guarantee that collection and expiry sweep cannot both win.
- **Lazy Expiry**:
  - `get_pickup_code`: Returns `{ ok: false, error: 'PICKUP_EXPIRED', status: 'NO_SHOW' }` and lazily marks the order `NO_SHOW`.
  - `preview_collection`: Returns `{ ok: false, error: 'PICKUP_EXPIRED', status: 'NO_SHOW' }` and lazily marks the order `NO_SHOW`.
  - `collect_order`: If expired, blocks method `SCAN` and `PIN`. If within 6 hours of expiry and method is `MANUAL`, permits a Late Handover with mandatory reason ($\ge 5$ characters) and transitions order to `COLLECTED`.
- **Stock Invariant**: Stock is never restored upon `NO_SHOW` (the kitchen has already prepared the food).

### 17.4 Sweep Routine (`public.mark_no_shows`)
- **Signature**: `public.mark_no_shows(p_canteen_id uuid DEFAULT NULL) RETURNS jsonb`
- **Security**: Accessible to staff (restricted to their assigned canteen), admin, and automated background workers (e.g. `pg_cron` / postgres superuser).
- **Batch Processing**: Capped at 200 orders per invocation using `FOR UPDATE OF o SKIP LOCKED`.
- **Audit & Notification**: Dispatches `'Order Expired'` notification to each student and records `action = 'ORDER_NO_SHOW'` in `public.admin_audit_log`.
- **Maintenance**: Automatically purges expired `pickup_collect_attempts` older than 7 days.
- **Scheduler**: Does not install hardcoded cron triggers. Can be scheduled via `pg_cron`:
  ```sql
  SELECT cron.schedule('sweep-canteen-no-shows', '* * * * *', $$SELECT public.mark_no_shows(NULL)$$);
  ```

### 17.5 Serial No-Show Enforcement & Strike Rules
- **Strike Calculation**:
  - An order counts as a strike if and only if:
    1. Its status is `NO_SHOW`.
    2. Its `ready_at` occurred within the rolling 30-day window (`ready_at >= clock_timestamp() - interval '30 days'`).
    3. Its `ready_at` is strictly after the student's latest `cleared_at` in `student_strike_resets` (`cleared_at IS NULL OR ready_at > cleared_at`).
    4. An `'Order Ready'` notification was successfully recorded for that order (confirming the student was notified).
- **Penalties for Serial No-Shows ($\ge 3$ active strikes)**:
  - Total order quantity capped at 2 items (`SUM(quantity) <= 2`).
  - Total order value capped at ₹200 (`total_paise <= 20000`).
  - Maximum concurrent active orders (`PLACED`, `ACCEPTED`, `PREPARING`, `READY`) capped at 2.
  - Non-compliant checkout attempts are rejected with `ACCOUNT_LIMITED`.
- **Student Status Function**:
  - `public.get_my_account_status() RETURNS jsonb`: Student-only read-only RPC returning `{ strikes, is_limited, active_orders_count, active_order_limit, can_order, max_items_allowed, max_order_paise }` so client apps can proactively warn students before checkout.

### 17.6 Daily Reconciliation & Operational Bounds
- **Canteen Hold Minutes Bounds**: Validated as $5 \le hold\_minutes \le 120$ in `admin_update_canteen_settings`.
- **Reconciliation Function (`public.get_daily_reconciliation`)**:
  - Admin only.
  - Aggregates orders strictly within IST day boundaries (`date_trunc('day', timezone('Asia/Kolkata', collected_at))`).
  - Categorizes revenue by `collected_with` (`CASH` vs `UPI`).
  - Distinguishes manual late handovers from on-time collections.
  - Reports count of `NO_SHOW` and `CANCELLED` orders.

---

## 18. Menu Item Nutrition & Ingredients Architecture

Added in migration `0018_menu_item_nutrition_ingredients.sql`.

### 18.1 Overview & Design Goals
Empowers students to make informed dietary decisions by providing calorie estimations and full ingredient breakdowns directly in the item detail sheet. All data is authored and curated exclusively by canteen administrators, with strict validation guarantees enforced at both the PostgreSQL schema layer and Next.js server action boundary.

### 18.2 Schema Modifications & Column Specifications
The following columns are added to `public.menu_items`:

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `calories_kcal` | `integer` | `NULL`, `CHECK (calories_kcal IS NULL OR (calories_kcal >= 0 AND calories_kcal <= 5000))` | Estimated per-serving energy value in kilocalories. |
| `ingredients` | `text[]` | `NOT NULL DEFAULT '{}'::text[]`, `CHECK (public.validate_menu_item_ingredients(ingredients))` | Ordered list of ingredients (max 30 items, 1–60 characters each). |

### 18.3 Ingredients Validation Helper (`public.validate_menu_item_ingredients`)
To avoid repetitive inline logic and ensure deterministic check constraint evaluation across all queries and bulk inserts, validation is encapsulated in a pure SQL function:

```sql
CREATE OR REPLACE FUNCTION public.validate_menu_item_ingredients(p_ingredients text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT
    p_ingredients IS NOT NULL
    AND cardinality(p_ingredients) <= 30
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_ingredients) AS item
      WHERE item IS NULL
         OR length(btrim(item)) < 1
         OR length(item) > 60
    );
$$;

REVOKE ALL ON FUNCTION public.validate_menu_item_ingredients(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_menu_item_ingredients(text[]) TO authenticated, service_role;
```

#### Constraint Invariants
1. **Empty Array Passes**: An empty ingredient list (`'{}'::text[]`) returns `cardinality = 0` and passes without error.
2. **Cardinality Limit**: Exactly 30 items pass; 31 items fail.
3. **Item Bounds**: Items with 1 to 60 characters pass; items with 61 characters fail.
4. **Whitespace Rejection**: Blank or whitespace-only items fail (`length(btrim(item)) < 1`). Null array elements fail.
5. **Execution Hardening**: Pure `IMMUTABLE`, `PARALLEL SAFE`, `SET search_path = ''`, with privileges revoked from `PUBLIC` and `anon`.

### 18.4 Staff Guard & Role Enforcement (`public.prevent_menu_item_unauthorized_update`)
Canteen staff possess row-update privileges on `public.menu_items` solely to flip availability toggles and adjust live stock counts during busy shifts. Staff must never modify menu pricing, titles, descriptions, prep durations, categories, photos, or nutrition details.

In migration 0018, `public.prevent_menu_item_unauthorized_update()` is updated to explicitly forbid staff from altering `calories_kcal` and `ingredients`:
```sql
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
       NEW.calories_kcal IS DISTINCT FROM OLD.calories_kcal OR
       NEW.ingredients IS DISTINCT FROM OLD.ingredients OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Staff are only permitted to update is_available and stock';
    END IF;
```

#### Column Privileges on `public.menu_items`
- `SELECT`: Granted to `anon`, `authenticated`, and `service_role`.
- `INSERT`: Prohibited directly; routed via admin server actions (`adminCreateMenuItemAction`).
- `UPDATE`: Executable by `admin` (all columns except ratings) and `staff` (restricted strictly to `is_available` and `stock`). Protected by `prevent_menu_item_unauthorized_update` trigger.
- `DELETE`: Prohibited; items are soft-archived via `is_active = false` to preserve historical order snapshots and ratings integrity.

### 18.5 Server Action Update Semantics
Admin updates via `adminUpdateMenuItemAction` follow precise partial update semantics:
- **Omission**: Omitting `calories_kcal` or `ingredients` leaves stored values untouched in the database.
- **Calories Clearing**: Passing `null` sets `calories_kcal = NULL`.
- **Ingredients Clearing**: Passing an empty array `[]` (or `null`) sets `ingredients = '{}'::text[]`.
- **Form Idempotency**: Opening an existing dish in the admin menu editor and saving without editing nutrition fields preserves existing values without wiping them.
- **Preserved Existing Validations**: Price parsing (`parseRupeesToPaise`), storage URL validation (`isAllowedMenuImageUrl`), and prep duration clamping (`1..180`) remain completely untouched.

### 18.6 Student Sheet UX & Mobile Viewport Safety
- **Right-Hand Layout**: In `ItemDetailSheet`, the calories pill (`~{calories_kcal} kcal`) sits directly beneath the item price in the right column (`flex flex-col items-end gap-1`).
- **375px Viewport Hardening**:
  - The left title block utilizes `min-w-0 flex-1` with `break-words` on the heading.
  - Prevents horizontal overflow, maintains touch-friendly 44px tap targets, and keeps the "Add to cart" CTA fully visible without sideways scrolling.
- **Collapsible Ingredients Disclosure**:
  - Hidden by default; rendered via a button with a rotating chevron (`aria-expanded`, `aria-controls="ingredients-panel"`).
  - Ingredients rendered as compact chips with `motion-reduce:transition-none`.
  - Returns nothing if the ingredient list is empty.
  - Accompanied by a disclaimer note: *"Calorie and ingredient details are provided by the canteen and are approximate."*
