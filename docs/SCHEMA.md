# Database Schema Reference

**Project**: Campus Canteen Pre-Order & Smart Pickup Platform  
**Target Database**: PostgreSQL 15+ (Supabase)  
**Schema**: `public`

---

## 1. Custom Types & Enums

### `user_role`
Role-based access levels across the application:
- `student`: Standard campus customer. Can browse menus, place pre-orders, view own orders, update own profile info.
- `staff`: Canteen operational personnel. Can view canteen orders, process prep stages, toggle item availability and stock.
- `admin`: Campus / canteen administrator. Full access to menu, slots, canteens, categories, and analytics.

### `order_status`
Explicit lifecycle transitions for every order:
- `PLACED`: Order successfully submitted by student; awaiting canteen pickup acknowledgment.
- `ACCEPTED`: Canteen has acknowledged the incoming order.
- `PREPARING`: Food is currently being prepared in the kitchen.
- `READY`: Items are prepared and ready at the collection counter.
- `COLLECTED`: Student showed pickup token/QR and received items.
- `CANCELLED`: Order cancelled within the eligible cutoff period.
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
Represents physical campus dining locations. Ready for multi-canteen scalability while defaulting to 1 in Phase 2.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique canteen identifier |
| `name` | `text` | NOT NULL, UNIQUE | Canteen name (e.g., "Main Campus Canteen") |
| `location` | `text` | NULL | Physical building/floor location |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Availability flag |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Record creation timestamp |

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
| `prep_minutes` | `integer` | NOT NULL, `DEFAULT 5`, `CHECK (prep_minutes >= 0)` | Average kitchen preparation time |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Active in menu |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Creation timestamp |
| `updated_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Last update timestamp |

*Constraints*: `UNIQUE (canteen_id, name)`

---

### 3.5 `public.pickup_slots`
Configured break windows for pre-order collection. All times are evaluated in **Asia/Kolkata (IST)**.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique slot ID |
| `canteen_id` | `uuid` | NOT NULL, REFERENCES `canteens(id)` ON DELETE CASCADE | Associated canteen |
| `slot_date` | `date` | NOT NULL | Calendar date of slot (IST) |
| `start_time` | `time` | NOT NULL | Window start time (e.g. `10:30:00`) |
| `end_time` | `time` | NOT NULL | Window end time (e.g. `10:45:00`) |
| `max_orders` | `integer` | NOT NULL, `CHECK (max_orders > 0)` | Peak workload throttling capacity |
| `cutoff_minutes`| `integer` | NOT NULL, `DEFAULT 15`, `CHECK (cutoff_minutes >= 0)` | Pre-order closure prior to slot start |
| `is_active` | `boolean` | NOT NULL, `DEFAULT true` | Active slot status |
| `created_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Record creation timestamp |

*Constraints*: `CHECK (end_time > start_time)`, `UNIQUE (canteen_id, slot_date, start_time, end_time)`

---

### 3.6 `public.orders`
Master order record tracking lifecycle and financial state.

| Column | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Unique order ID |
| `order_code` | `text` | NOT NULL, UNIQUE, `DEFAULT ('CN' \|\| nextval('order_code_seq')::text)` | Display reference (e.g. `CN10247`) |
| `user_id` | `uuid` | NOT NULL, REFERENCES `profiles(id)` ON DELETE RESTRICT | Ordering customer |
| `canteen_id` | `uuid` | NOT NULL, REFERENCES `canteens(id)` ON DELETE RESTRICT | Fulfillment canteen |
| `slot_id` | `uuid` | NOT NULL, REFERENCES `pickup_slots(id)` ON DELETE RESTRICT | Selected pickup window |
| `status` | `order_status` | NOT NULL, `DEFAULT 'PLACED'` | Current lifecycle stage |
| `payment_method` | `payment_method` | NOT NULL, `DEFAULT 'PAY_AT_PICKUP'` | Chosen payment mode |
| `payment_status` | `payment_status` | NOT NULL, `DEFAULT 'PENDING'` | Payment settlement status |
| `total_paise` | `integer` | NOT NULL, `CHECK (total_paise >= 0)` | Total payable amount in paise |
| `pickup_token` | `text` | NOT NULL, UNIQUE | 4-6 digit numeric or QR code token |
| `idempotency_key` | `text` | NULL | Client-submitted deduplication token |
| `placed_at` | `timestamptz` | NOT NULL, `DEFAULT now()` | Timestamp when placed |
| `accepted_at` | `timestamptz` | NULL | Acknowledged by kitchen |
| `preparing_at` | `timestamptz` | NULL | Preparation began |
| `ready_at` | `timestamptz` | NULL | Waiting at pickup counter |
| `collected_at` | `timestamptz` | NULL | Handed over to student |
| `cancelled_at` | `timestamptz` | NULL | Order cancelled |
| `rejected_at` | `timestamptz` | NULL | Order rejected by canteen |

*Constraints*: `UNIQUE (user_id, idempotency_key)`

---

### 3.7 `public.order_items`
Immutable line-item records snapshotting item names and prices at order time.

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

### 3.8 `public.notifications`
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

## 4. Database Triggers & Defense-in-Depth

1. **`set_updated_at()`**: Automatically maintains `updated_at` timestamps on row updates (`profiles`, `menu_items`).
2. **`handle_new_user()`**: Triggered on `AFTER INSERT ON auth.users`. Hardcodes `role = 'student'` and creates the user profile automatically without trusting any client metadata for privilege assignment.
3. **`prevent_profile_escalation()`**: Triggered on `BEFORE UPDATE ON public.profiles` (`SECURITY INVOKER`).
   - Allows direct SQL Editor / migration executions where `auth.uid() IS NULL`.
   - Allows internal / service_role / `SECURITY DEFINER` functions (`current_user NOT IN ('authenticated', 'anon')`).
   - Allows users with `role = 'admin'` to update all columns.
   - For authenticated non-admins (`auth.uid() IS NOT NULL AND role != 'admin'`), raises an exception if `role`, `canteen_id`, or `is_active` are altered.
4. **`prevent_menu_item_unauthorized_update()`**: Triggered on `BEFORE UPDATE ON public.menu_items` (`SECURITY INVOKER`).
   - Allows SQL Editor / service_role updates (`auth.uid() IS NULL`).
   - Allows internal / service_role / `SECURITY DEFINER` functions (`current_user NOT IN ('authenticated', 'anon')`), ensuring server-side stock decrements are not blocked.
   - Allows admins full update capability.
   - Restricts staff to altering **only** `is_available` and `stock`, and only for items belonging to their assigned `canteen_id`.

---

## 5. Row Level Security (RLS) Policy Matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| **`canteens`** | Authenticated (`true`) | Admin only | Admin only | Admin only |
| **`profiles`** | Own profile (`id = auth.uid()`), Staff (customers with orders in their canteen), Admin (all) | Admin only (Trigger handles auth insert) | Own profile (`USING & WITH CHECK id = auth.uid()`), Admin (all) | Admin only |
| **`categories`** | Authenticated (`true`) | Admin only | Admin only | Admin only |
| **`menu_items`** | Authenticated (`true`) | Admin only | Staff (own canteen items; availability/stock only via trigger), Admin (all) | Admin only |
| **`pickup_slots`**| Authenticated (`true`) | Admin only | Admin only | Admin only |
| **`orders`** | Own orders (`user_id = auth.uid()`), Staff (own canteen orders), Admin (all) | Blocked directly (Handled by Phase 5 server function) | Blocked directly (Handled by Phase 5 server function) | Admin only |
| **`order_items`** | Own order items, Staff (own canteen), Admin (all) | Blocked directly | Blocked directly | Admin only |
| **`notifications`**| Own notifications (`user_id = auth.uid()`), Admin (all) | Admin / service_role only | Own notifications (`is_read` column grant), Admin (all) | Admin only |
