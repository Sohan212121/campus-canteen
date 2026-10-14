"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";
import { extractMenuItemImageUrl } from "@/lib/image-utils";

const uuidSchema = z.string().uuid("Invalid ID format");

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
    image_url?: string | null;
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

  if (parsedStatus.data === "COLLECTED") {
    return {
      success: false,
      code: "INVALID_TRANSITION",
      error: "Orders cannot be directly transitioned to COLLECTED. Use collectOrderAction instead.",
    };
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
export type CollectionCard = {
  order_id: string;
  order_code: string;
  first_name: string;
  college_id_last4: string;
  pickup_for_name?: string | null;
  total_paise: number;
  is_amber: boolean;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit_price_paise: number;
  }>;
};

export type PreviewCollectionResult = {
  success: boolean;
  code?: string;
  error?: string;
  data?: CollectionCard;
};

export type CollectOrderResult = {
  success: boolean;
  code?: string;
  error?: string;
  data?: {
    order_id: string;
    order_code: string;
    first_name: string;
    college_id_last4: string;
    pickup_for_name?: string | null;
    total_paise: number;
    collected_with: string;
    collection_method: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      unit_price_paise: number;
    }>;
  };
};

/**
 * Previews collection credentials without altering state. Returns the scan card.
 */
export async function previewCollectionAction(input: {
  orderRef: string;
  code?: string;
  pin?: string;
}): Promise<PreviewCollectionResult> {
  const profile = await requireRole(["staff", "admin"]);
  const canteenId = await resolveStaffCanteen(profile);

  const cleanRef = input.orderRef?.trim();
  if (!cleanRef) {
    return { success: false, code: "INVALID_INPUT", error: "Please provide an order reference or scan a valid QR." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_collection", {
    p_canteen_id: canteenId,
    p_order_ref: cleanRef,
    p_code: input.code?.trim() || null,
    p_pin: input.pin?.trim() || null,
  });

  if (error) {
    const rawMsg = error.message || "";
    const code = rawMsg.split(":")[0]?.trim() || "ERROR";
    return {
      success: false,
      code,
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Verification failed.",
    };
  }

  const res = data as { ok: boolean; error?: string; [key: string]: unknown };
  if (!res || !res.ok) {
    const errorMap: Record<string, string> = {
      RATE_LIMITED: "Too many failed attempts. Please wait before trying again.",
      PIN_LOCKED: "Too many failed PIN attempts. Order PIN is locked.",
      INVALID_CODE: "Invalid or expired pickup code.",
      INVALID_PIN: "Incorrect 4-digit PIN.",
      PIN_REQUIRED: "PIN verification required for this high-value or bulk order.",
      AMBER_REQUIRES_CODE_AND_PIN: "Orders over 5 items or ₹500 require both the rotating QR code and PIN.",
      ORDER_NOT_READY: "Order is not marked ready yet.",
      ALREADY_COLLECTED: "Order has already been collected.",
      SECRET_NOT_FOUND: "No security credentials found for this order.",
      CODE_OR_PIN_REQUIRED: "Please enter a valid 6-digit code or 4-digit PIN.",
    };
    return {
      success: false,
      code: res?.error || "VERIFY_FAILED",
      error: (res?.error && errorMap[res.error]) || res?.error || "Verification failed.",
    };
  }

  return {
    success: true,
    data: {
      order_id: res.order_id as string,
      order_code: res.order_code as string,
      first_name: res.first_name as string,
      college_id_last4: res.college_id_last4 as string,
      pickup_for_name: (res.pickup_for_name as string) || null,
      total_paise: Number(res.total_paise || 0),
      is_amber: Boolean(res.is_amber),
      items: (res.items as CollectionCard["items"]) || [],
    },
  };
}

/**
 * Atomically marks order as collected with payment confirmation.
 */
export async function collectOrderAction(input: {
  orderId: string;
  code?: string;
  collectedWith: "CASH" | "UPI";
  method: "SCAN" | "PIN" | "MANUAL";
  pin?: string;
  reason?: string;
}): Promise<CollectOrderResult> {
  const profile = await requireRole(["staff", "admin"]);
  const canteenId = await resolveStaffCanteen(profile);
  const parsedId = uuidSchema.safeParse(input.orderId);
  if (!parsedId.success) {
    return { success: false, code: "INVALID_INPUT", error: "Invalid order ID format." };
  }

  if (!["CASH", "UPI"].includes(input.collectedWith)) {
    return { success: false, code: "INVALID_INPUT", error: "Payment method must be CASH or UPI." };
  }

  if (!["SCAN", "PIN", "MANUAL"].includes(input.method)) {
    return { success: false, code: "INVALID_INPUT", error: "Collection method must be SCAN, PIN, or MANUAL." };
  }

  if (input.method === "MANUAL" && (!input.reason || input.reason.trim().length < 5)) {
    return { success: false, code: "INVALID_INPUT", error: "Manual collection requires a reason of at least 5 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("collect_order", {
    p_canteen_id: canteenId,
    p_order_id: parsedId.data,
    p_code: input.code?.trim() || null,
    p_collected_with: input.collectedWith,
    p_method: input.method,
    p_pin: input.pin?.trim() || null,
    p_reason: input.reason?.trim() || null,
  });

  if (error) {
    const rawMsg = error.message || "";
    const code = rawMsg.split(":")[0]?.trim() || "ERROR";
    return {
      success: false,
      code,
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Collection failed.",
    };
  }

  const res = data as { ok: boolean; error?: string; [key: string]: unknown };
  if (!res || !res.ok) {
    const errorMap: Record<string, string> = {
      RATE_LIMITED: "Too many failed attempts. Please wait before trying again.",
      PIN_LOCKED: "Too many failed PIN attempts. Order PIN is locked.",
      INVALID_CODE: "Invalid or expired pickup code.",
      INVALID_PIN: "Incorrect 4-digit PIN.",
      PIN_REQUIRED: "PIN verification required for this high-value or bulk order.",
      AMBER_REQUIRES_CODE_AND_PIN: "Orders over 5 items or ₹500 require both the rotating QR code and PIN.",
      MANUAL_LIMIT: "Manual collection limit reached (maximum 10 per 24 hours per staff).",
      ORDER_NOT_READY: "Order is not marked ready yet.",
      ALREADY_COLLECTED: "Order has already been collected.",
    };
    return {
      success: false,
      code: res?.error || "COLLECT_FAILED",
      error: (res?.error && errorMap[res.error]) || res?.error || "Collection failed.",
    };
  }

  revalidatePath(`/orders/${parsedId.data}`, "page");
  revalidatePath("/staff/kitchen", "page");
  revalidatePath("/staff/pickup", "page");

  return {
    success: true,
    data: {
      order_id: res.order_id as string,
      order_code: res.order_code as string,
      first_name: res.first_name as string,
      college_id_last4: res.college_id_last4 as string,
      pickup_for_name: (res.pickup_for_name as string) || null,
      total_paise: Number(res.total_paise || 0),
      collected_with: res.collected_with as string,
      collection_method: res.collection_method as string,
      items: (res.items as CollectOrderResult["data"] extends { items: infer T } ? T : never) || [],
    },
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
        unit_price_paise,
        menu_items (
          image_url
        )
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

    const mappedItems = ((raw.order_items || []) as Array<{
      id: string;
      name_snapshot: string;
      quantity: number;
      unit_price_paise: number;
      menu_items?: { image_url?: string | null } | Array<{ image_url?: string | null }> | null;
    }>).map((item) => ({
      id: item.id,
      name_snapshot: item.name_snapshot,
      quantity: item.quantity,
      unit_price_paise: item.unit_price_paise,
      image_url: extractMenuItemImageUrl(item.menu_items),
    }));

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
      order_items: mappedItems,
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
      image_url,
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
    image_url: string | null;
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
      image_url: raw.image_url ?? null,
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
