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
