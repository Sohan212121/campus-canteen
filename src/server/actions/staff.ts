"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid("Invalid ID format");
const tokenSchema = z.string().regex(/^\d{6}$/, "Pickup token must be a 6-digit numeric code");

const orderStatusSchema = z.enum([
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "REJECTED",
]);

export type StaffOrderStatus = z.infer<typeof orderStatusSchema>;

export type BoardOrder = {
  id: string;
  order_code: string;
  status: StaffOrderStatus;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  placed_at: string;
  estimated_ready_at: string;
  pickup_window_end: string;
  prep_minutes_total: number;
  customer_name: string;
  is_stale: boolean;
  order_items: Array<{
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price_paise: number;
  }>;
};

export type StaffBoardData = {
  canteenId: string | null;
  canteenName: string | null;
  newOrders: BoardOrder[];
  preparingOrders: BoardOrder[];
  readyOrders: BoardOrder[];
  completedOrders: BoardOrder[];
};

export type VerifiedPickupOrder = {
  order_id: string;
  order_code: string;
  status: string;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  student_name: string;
  items: Array<{
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price_paise: number;
  }>;
};

/**
 * Resolves the operational canteen ID strictly on the server.
 * Never accepts canteen ID from untrusted client input.
 */
async function resolveStaffCanteen(profile: { role: string; canteen_id: string | null }): Promise<string | null> {
  return profile.canteen_id;
}

/**
 * Transitions order state through public.transition_order.
 */
export async function transitionOrderAction(
  orderId: string,
  toStatus: StaffOrderStatus
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  was_noop?: boolean;
  data?: {
    order_id: string;
    status: StaffOrderStatus;
    was_noop: boolean;
  };
}> {
  await requireRole(["staff"]);

  const parsedId = uuidSchema.safeParse(orderId);
  const parsedStatus = orderStatusSchema.safeParse(toStatus);

  if (!parsedId.success || !parsedStatus.success) {
    return { success: false, code: "INVALID_INPUT", error: "Invalid transition parameters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_order", {
    p_order_id: parsedId.data,
    p_to_status: parsedStatus.data,
  });

  if (error) {
    const rawMsg = error.message || "";

    if (rawMsg.includes("Could not find the function") || rawMsg.includes("schema cache")) {
      return {
        success: false,
        code: "DATABASE_MIGRATION_REQUIRED",
        error: "Database function transition_order is missing. Please run 0005_staff_operations.sql.",
      };
    }
    if (rawMsg.includes("FORBIDDEN")) {
      return {
        success: false,
        code: "FORBIDDEN",
        error: "You are not authorized to transition orders for this canteen.",
      };
    }
    if (rawMsg.includes("INVALID_TRANSITION")) {
      return {
        success: false,
        code: "INVALID_TRANSITION",
        error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Invalid order status transition.",
      };
    }
    if (rawMsg.includes("NOT_FOUND")) {
      return { success: false, code: "NOT_FOUND", error: "Order not found." };
    }

    return {
      success: false,
      code: "UNKNOWN_ERROR",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to update order status.",
    };
  }

  revalidatePath("/staff");
  revalidatePath("/staff/pickup");
  revalidatePath("/orders");
  revalidatePath(`/orders/${parsedId.data}`, "page");

  const wasNoop = Boolean(data && (data as { was_noop?: boolean }).was_noop);
  return {
    success: true,
    data: {
      order_id: parsedId.data,
      status: parsedStatus.data,
      was_noop: wasNoop,
    },
    was_noop: wasNoop,
  };
}

/**
 * Verifies counter pickup token for ready orders through public.verify_pickup.
 */
export async function verifyPickupAction(
  token: string
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  data?: VerifiedPickupOrder;
  order?: VerifiedPickupOrder;
}> {
  const profile = await requireRole(["staff"]);
  const canteenId = await resolveStaffCanteen(profile);

  if (!canteenId) {
    return {
      success: false,
      code: "NO_CANTEEN_ASSIGNED",
      error: "No canteen assigned to your staff profile.",
    };
  }

  const parsedToken = tokenSchema.safeParse(token.trim());
  if (!parsedToken.success) {
    return {
      success: false,
      code: "INVALID_TOKEN",
      error: "Please enter a valid 6-digit numeric pickup token.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_pickup", {
    p_canteen_id: canteenId,
    p_token: parsedToken.data,
  });

  if (error) {
    const rawMsg = error.message || "";
    if (rawMsg.includes("RATE_LIMITED")) {
      return {
        success: false,
        code: "RATE_LIMITED",
        error: "Too many failed pickup attempts. Please wait 5 minutes before trying again.",
      };
    }
    if (rawMsg.includes("FORBIDDEN")) {
      return {
        success: false,
        code: "FORBIDDEN",
        error: "You are not authorized to verify pickups for this canteen.",
      };
    }
    return {
      success: false,
      code: "VERIFY_FAILED",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to verify pickup token.",
    };
  }

  const payload = data as { found: boolean } & VerifiedPickupOrder;
  if (!payload || !payload.found) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "No ready order found matching pickup token.",
    };
  }

  const verifiedOrder: VerifiedPickupOrder = {
    order_id: payload.order_id,
    order_code: payload.order_code,
    status: payload.status,
    total_paise: payload.total_paise,
    payment_method: payload.payment_method,
    payment_status: payload.payment_status,
    student_name: payload.student_name,
    items: payload.items || [],
  };

  return {
    success: true,
    data: verifiedOrder,
    order: verifiedOrder,
  };
}

/**
 * Toggles a menu item's availability through public.set_item_availability.
 */
export async function setItemAvailabilityAction(
  itemId: string,
  isAvailable: boolean
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRole(["staff"]);

  const parsedId = uuidSchema.safeParse(itemId);
  if (!parsedId.success) {
    return { success: false, code: "INVALID_INPUT", error: "Invalid menu item ID." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_availability", {
    p_item_id: parsedId.data,
    p_is_available: isAvailable,
  });

  if (error) {
    const rawMsg = error.message || "";
    if (rawMsg.includes("FORBIDDEN")) {
      return {
        success: false,
        code: "FORBIDDEN",
        error: "You are not authorized to update items for this canteen.",
      };
    }
    return {
      success: false,
      code: "UPDATE_FAILED",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to update item availability.",
    };
  }

  revalidatePath("/staff/inventory");
  revalidatePath("/menu");
  return { success: true };
}

/**
 * Loads kitchen board data for staff.
 * SECURITY INVARIANT: NEVER selects pickup_token.
 */
export async function getStaffBoardDataAction(): Promise<StaffBoardData> {
  const profile = await requireRole(["staff"]);
  const canteenId = await resolveStaffCanteen(profile);

  if (!canteenId) {
    return {
      canteenId: null,
      canteenName: null,
      newOrders: [],
      preparingOrders: [],
      readyOrders: [],
      completedOrders: [],
    };
  }

  const supabase = await createClient();

  // Fetch canteen name
  const { data: canteenData } = await supabase
    .from("canteens")
    .select("name")
    .eq("id", canteenId)
    .maybeSingle();

  // Today's date in Asia/Kolkata (YYYY-MM-DD)
  const todayIst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // NOTE ON TOKEN SECURITY:
  // We strictly omit pickup_token here to prevent any leakage onto staff displays.
  const { data: ordersData, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id,
      order_code,
      status,
      total_paise,
      payment_method,
      payment_status,
      placed_at,
      estimated_ready_at,
      pickup_window_end,
      prep_minutes_total,
      profiles!orders_user_id_fkey (
        full_name
      ),
      order_items (
        id,
        name_snapshot,
        quantity,
        unit_price_paise
      )
    `)
    .eq("canteen_id", canteenId)
    .order("estimated_ready_at", { ascending: true });

  if (ordersError || !ordersData) {
    return {
      canteenId,
      canteenName: canteenData?.name ?? null,
      newOrders: [],
      preparingOrders: [],
      readyOrders: [],
      completedOrders: [],
    };
  }

  const newOrders: BoardOrder[] = [];
  const preparingOrders: BoardOrder[] = [];
  const readyOrders: BoardOrder[] = [];
  const completedOrders: BoardOrder[] = [];

  for (const raw of ordersData) {
    const rawProfile = raw.profiles;
    const customerName = Array.isArray(rawProfile)
      ? rawProfile[0]?.full_name
      : (rawProfile as { full_name?: string | null })?.full_name ?? "Student";

    // Determine if placed date is strictly before today in IST
    const placedDateIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(raw.placed_at));

    const isStale = placedDateIst < todayIst;

    const order: BoardOrder = {
      id: raw.id,
      order_code: raw.order_code,
      status: raw.status as StaffOrderStatus,
      total_paise: raw.total_paise,
      payment_method: raw.payment_method,
      payment_status: raw.payment_status,
      placed_at: raw.placed_at,
      estimated_ready_at: raw.estimated_ready_at,
      pickup_window_end: raw.pickup_window_end,
      prep_minutes_total: raw.prep_minutes_total,
      customer_name: customerName,
      is_stale: isStale,
      order_items: (raw.order_items || []) as BoardOrder["order_items"],
    };

    if (raw.status === "PLACED") {
      newOrders.push(order);
    } else if (raw.status === "ACCEPTED" || raw.status === "PREPARING") {
      preparingOrders.push(order);
    } else if (raw.status === "READY") {
      readyOrders.push(order);
    } else if (["COLLECTED", "REJECTED", "CANCELLED"].includes(raw.status)) {
      // Completed shows today's orders only, max 50
      if (!isStale) {
        completedOrders.push(order);
      }
    }
  }

  // Completed sorted newest first, max 50
  completedOrders.sort(
    (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime()
  );
  const cappedCompleted = completedOrders.slice(0, 50);

  return {
    canteenId,
    canteenName: canteenData?.name ?? "Main Canteen",
    newOrders,
    preparingOrders,
    readyOrders,
    completedOrders: cappedCompleted,
  };
}

/**
 * Loads inventory items for staff's assigned canteen.
 */
export async function getStaffInventoryItemsAction(): Promise<{
  canteenId: string | null;
  canteenName: string | null;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    price_paise: number;
    is_veg: boolean;
    is_available: boolean;
    stock: number | null;
    prep_minutes: number;
    category_name: string | null;
  }>;
}> {
  const profile = await requireRole(["staff"]);
  const canteenId = await resolveStaffCanteen(profile);

  if (!canteenId) {
    return { canteenId: null, canteenName: null, items: [] };
  }

  const supabase = await createClient();

  const { data: canteenData } = await supabase
    .from("canteens")
    .select("name")
    .eq("id", canteenId)
    .maybeSingle();

  const { data: itemsData } = await supabase
    .from("menu_items")
    .select(`
      id,
      name,
      description,
      price_paise,
      is_veg,
      is_available,
      stock,
      prep_minutes,
      categories (
        name
      )
    `)
    .eq("canteen_id", canteenId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  interface RawCategoryRelation {
    name?: string;
  }
  interface RawMenuItemRow {
    id: string;
    name: string;
    description: string | null;
    price_paise: number;
    is_veg: boolean;
    is_available: boolean;
    stock: number | null;
    prep_minutes: number;
    categories: RawCategoryRelation | RawCategoryRelation[] | null;
  }

  const items = ((itemsData as unknown as RawMenuItemRow[]) || []).map((raw: RawMenuItemRow) => {
    const rawCategory = raw.categories;
    const resolvedName = Array.isArray(rawCategory)
      ? rawCategory[0]?.name
      : rawCategory?.name;
    const categoryName: string | null = resolvedName || null;

    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      price_paise: raw.price_paise,
      is_veg: raw.is_veg,
      is_available: raw.is_available,
      stock: raw.stock,
      prep_minutes: raw.prep_minutes,
      category_name: categoryName,
    };
  });

  return {
    canteenId,
    canteenName: canteenData?.name ?? null,
    items,
  };
}
