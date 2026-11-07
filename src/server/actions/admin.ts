"use server";

import { revalidatePath } from "next/cache";
import { safeRevalidateTag } from "@/lib/safe-cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createClient } from "@/lib/supabase/server";
import { parseRupeesToPaise } from "@/lib/money";
import {
  validateImageBytes,
  isAllowedMenuImageUrl,
  extractStorageFilename,
} from "@/lib/image-upload";
import { validateAndNormalizeNutrition } from "@/lib/menu-nutrition";
import { logSupabaseError, isMissingColumnError } from "@/lib/supabase-error";

const uuidSchema = z.string().uuid("Invalid ID format");

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// 1. Dashboard & Analytics
// ---------------------------------------------------------------------------

export type DashboardStats = {
  orders_by_status: Record<string, number>;
  revenue_paise: number;
  top_items: Array<{
    name: string;
    quantity: number;
    revenue_paise: number;
  }>;
  orders_by_hour: Array<{
    hour: number;
    count: number;
  }>;
  total_placed: number;
  total_cancelled: number;
  cancellation_rate: number;
  avg_prep_minutes: number;
};

/**
 * Computes Asia/Kolkata day boundaries on the server and loads dashboard stats.
 * Client sends a preset ("today", "7d", "30d") or a specific IST date ("YYYY-MM-DD").
 */
export async function getAdminDashboardStatsAction(
  rangeParam: string = "today"
): Promise<ActionResult<DashboardStats>> {
  await requireRole(["admin"]);

  // Calculate IST timestamps (+05:30)
  const nowUtc = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(nowUtc.getTime() + istOffsetMs);

  let fromIst: Date;
  let toIst: Date;

  if (rangeParam === "7d") {
    // Last 7 days in IST
    fromIst = new Date(nowIst);
    fromIst.setUTCDate(fromIst.getUTCDate() - 6);
    fromIst.setUTCHours(0, 0, 0, 0);

    toIst = new Date(nowIst);
    toIst.setUTCHours(23, 59, 59, 999);
  } else if (rangeParam === "30d") {
    // Last 30 days in IST
    fromIst = new Date(nowIst);
    fromIst.setUTCDate(fromIst.getUTCDate() - 29);
    fromIst.setUTCHours(0, 0, 0, 0);

    toIst = new Date(nowIst);
    toIst.setUTCHours(23, 59, 59, 999);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(rangeParam)) {
    // Specific IST date
    const [year, month, day] = rangeParam.split("-").map(Number);
    fromIst = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    toIst = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  } else {
    // Default: Today in IST
    fromIst = new Date(nowIst);
    fromIst.setUTCHours(0, 0, 0, 0);

    toIst = new Date(nowIst);
    toIst.setUTCHours(23, 59, 59, 999);
  }

  // Convert IST calendar boundaries back to UTC timestamptz for PostgreSQL
  const fromUtc = new Date(fromIst.getTime() - istOffsetMs);
  const toUtc = new Date(toIst.getTime() - istOffsetMs);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dashboard_stats", {
    p_from: fromUtc.toISOString(),
    p_to: toUtc.toISOString(),
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to load dashboard metrics.",
      code: "METRICS_FAILED",
    };
  }

  return {
    success: true,
    data: data as DashboardStats,
  };
}

// ---------------------------------------------------------------------------
// 2. Orders Monitor
// ---------------------------------------------------------------------------

export type AdminOrderRow = {
  id: string;
  order_code: string;
  status: string;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  placed_at: string;
  estimated_ready_at: string;
  canteen_name: string;
  student_name: string;
  item_count: number;
};

export type AdminOrdersListResult = {
  total_count: number;
  orders: AdminOrderRow[];
};

export async function getAdminOrdersAction(params: {
  from?: string;
  to?: string;
  status?: string[];
  search?: string;
  page?: number;
  limit?: number;
}): Promise<ActionResult<AdminOrdersListResult>> {
  await requireRole(["admin"]);

  const limit = Math.max(1, Math.min(params.limit || 25, 100));
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * limit;

  // Default to today if from/to are not supplied
  const fromIso = params.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toIso = params.to || new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_orders", {
    p_from: fromIso,
    p_to: toIso,
    p_status: params.status && params.status.length > 0 ? params.status : null,
    p_search: params.search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to list orders.",
      code: "ORDERS_FAILED",
    };
  }

  return {
    success: true,
    data: data as AdminOrdersListResult,
  };
}

// ---------------------------------------------------------------------------
// 3. User & Staff Management
// ---------------------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  college_id: string | null;
  role: string;
  canteen_id: string | null;
  canteen_name: string | null;
  is_active: boolean;
  created_at: string;
};

export type AdminUsersListResult = {
  total_count: number;
  users: AdminUserRow[];
};

export async function getAdminUsersAction(params: {
  search?: string;
  role?: string;
  page?: number;
  limit?: number;
}): Promise<ActionResult<AdminUsersListResult>> {
  await requireRole(["admin"]);

  const limit = Math.max(1, Math.min(params.limit || 25, 100));
  const page = Math.max(1, params.page || 1);
  const offset = (page - 1) * limit;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_search: params.search?.trim() || null,
    p_role: params.role || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to list users.",
      code: "USERS_FAILED",
    };
  }

  return {
    success: true,
    data: data as AdminUsersListResult,
  };
}

export async function adminSetUserRoleAction(
  userId: string,
  role: "student" | "staff" | "admin",
  canteenId?: string | null
): Promise<ActionResult> {
  await requireRole(["admin"]);

  const parsedId = uuidSchema.safeParse(userId);
  if (!parsedId.success) {
    return { success: false, error: "Invalid user ID.", code: "INVALID_INPUT" };
  }

  if (role === "staff" && (!canteenId || !uuidSchema.safeParse(canteenId).success)) {
    return {
      success: false,
      error: "Staff accounts must be assigned to an active canteen.",
      code: "INVALID_INPUT",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: parsedId.data,
    p_role: role,
    p_canteen_id: role === "staff" ? canteenId : null,
  });

  if (error) {
    const rawMsg = error.message || "";
    if (rawMsg.includes("CANNOT_MODIFY_SELF")) {
      return {
        success: false,
        code: "CANNOT_MODIFY_SELF",
        error: "You cannot change your own administrator role.",
      };
    }
    if (rawMsg.includes("LAST_ADMIN")) {
      return {
        success: false,
        code: "LAST_ADMIN",
        error: "Cannot demote the last remaining active administrator.",
      };
    }
    if (rawMsg.includes("INVALID_INPUT")) {
      return {
        success: false,
        code: "INVALID_INPUT",
        error: rawMsg.replace(/^[A-Z_]+:\s*/, ""),
      };
    }
    return {
      success: false,
      code: "UPDATE_FAILED",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to update user role.",
    };
  }

  revalidatePath("/admin/users");
  return { success: true, data: undefined };
}

export async function adminSetUserActiveAction(
  userId: string,
  active: boolean
): Promise<ActionResult> {
  await requireRole(["admin"]);

  const parsedId = uuidSchema.safeParse(userId);
  if (!parsedId.success) {
    return { success: false, error: "Invalid user ID.", code: "INVALID_INPUT" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_active", {
    p_user_id: parsedId.data,
    p_active: active,
  });

  if (error) {
    const rawMsg = error.message || "";
    if (rawMsg.includes("CANNOT_MODIFY_SELF")) {
      return {
        success: false,
        code: "CANNOT_MODIFY_SELF",
        error: "You cannot deactivate your own administrator account.",
      };
    }
    if (rawMsg.includes("LAST_ADMIN")) {
      return {
        success: false,
        code: "LAST_ADMIN",
        error: "Cannot deactivate the last remaining active administrator.",
      };
    }
    return {
      success: false,
      code: "UPDATE_FAILED",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to toggle user status.",
    };
  }

  revalidatePath("/admin/users");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// 4. Canteen Settings
// ---------------------------------------------------------------------------

export type CanteenData = {
  id: string;
  name: string;
  location: string | null;
  opens_at: string;
  closes_at: string;
  last_order_time: string;
  kitchen_capacity: number;
  min_lead_minutes: number;
  hold_minutes: number;
  is_active: boolean;
};

export async function getAdminCanteensAction(): Promise<ActionResult<CanteenData[]>> {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canteens")
    .select("id, name, location, opens_at, closes_at, last_order_time, kitchen_capacity, min_lead_minutes, hold_minutes, is_active")
    .order("name", { ascending: true });

  if (error) {
    return { success: false, error: error.message || "Failed to load canteens." };
  }

  return { success: true, data: data as CanteenData[] };
}

export async function adminUpdateCanteenSettingsAction(
  canteenId: string,
  settings: {
    opens_at: string;
    closes_at: string;
    last_order_time: string;
    kitchen_capacity: number;
    min_lead_minutes: number;
    hold_minutes: number;
  }
): Promise<ActionResult> {
  await requireRole(["admin"]);

  const parsedId = uuidSchema.safeParse(canteenId);
  if (!parsedId.success) {
    return { success: false, error: "Invalid canteen ID." };
  }

  if (settings.hold_minutes < 5 || settings.hold_minutes > 120) {
    return { success: false, error: "Hold window must be between 5 and 120 minutes." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_canteen_settings", {
    p_canteen_id: parsedId.data,
    p_opens_at: settings.opens_at,
    p_closes_at: settings.closes_at,
    p_last_order_time: settings.last_order_time,
    p_kitchen_capacity: settings.kitchen_capacity,
    p_min_lead_minutes: settings.min_lead_minutes,
    p_hold_minutes: settings.hold_minutes,
  });

  if (error) {
    return {
      success: false,
      code: "SETTINGS_FAILED",
      error: error.message.replace(/^[A-Z_]+:\s*/, "") || "Failed to update canteen settings.",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  revalidatePath("/menu");
  safeRevalidateTag("canteen-details");
  safeRevalidateTag("canteen-active");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// 5. Menu & Category Management
// ---------------------------------------------------------------------------

export type AdminCategory = {
  id: string;
  canteen_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

export type AdminMenuItem = {
  id: string;
  canteen_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_paise: number;
  image_url: string | null;
  is_veg: boolean;
  is_available: boolean;
  stock: number | null;
  prep_minutes: number;
  is_active: boolean;
  calories_kcal: number | null;
  ingredients: string[];
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  fibre_g?: number | null;
  sugar_g?: number | null;
  sat_fat_g?: number | null;
  key_minerals?: string[];
};

export async function getAdminMenuDataAction(
  canteenId?: string
): Promise<ActionResult<{ categories: AdminCategory[]; items: AdminMenuItem[]; selectedCanteenId: string }>> {
  await requireRole(["admin"]);

  const activeCanteenId = canteenId || (await getActiveCanteenId());
  if (!activeCanteenId) {
    return { success: false, error: "No canteen selected or available." };
  }

  const supabase = await createClient();

  const [categoriesRes, itemsRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id, canteen_id, name, display_order, is_active")
      .eq("canteen_id", activeCanteenId)
      .order("display_order", { ascending: true }),

    supabase
      .from("menu_items")
      .select(
        "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, calories_kcal, ingredients"
      )
      .eq("canteen_id", activeCanteenId)
      .order("name", { ascending: true }),
  ]);

  let itemsData = itemsRes.data;

  if (itemsRes.error) {
    logSupabaseError("getAdminMenuDataAction:items", itemsRes.error);

    if (isMissingColumnError(itemsRes.error)) {
      // TODO: Remove fallback after migration 0018 is applied
      console.warn("[getAdminMenuDataAction] WARNING: migration 0018 not applied");
      const fallbackRes = await supabase
        .from("menu_items")
        .select(
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active"
        )
        .eq("canteen_id", activeCanteenId)
        .order("name", { ascending: true });

      if (fallbackRes.error) {
        logSupabaseError("getAdminMenuDataAction:items_fallback", fallbackRes.error);
        return {
          success: false,
          error: fallbackRes.error.message || "Failed to load menu data.",
        };
      }

      itemsData = (fallbackRes.data || []).map((row: Record<string, unknown>) => ({
        ...row,
        calories_kcal: null,
        ingredients: [],
      })) as unknown as typeof itemsRes.data;
    } else {
      return {
        success: false,
        error: itemsRes.error.message || "Failed to load menu data.",
      };
    }
  }

  if (categoriesRes.error) {
    logSupabaseError("getAdminMenuDataAction:categories", categoriesRes.error);
    return {
      success: false,
      error: categoriesRes.error.message || "Failed to load menu data.",
    };
  }

  return {
    success: true,
    data: {
      categories: (categoriesRes.data || []) as AdminCategory[],
      items: (itemsData || []) as AdminMenuItem[],
      selectedCanteenId: activeCanteenId,
    },
  };
}

export async function adminCreateCategoryAction(
  canteenId: string,
  name: string,
  displayOrder: number = 0
): Promise<ActionResult<AdminCategory>> {
  await requireRole(["admin"]);

  const cleanName = name.trim();
  if (!cleanName) {
    return { success: false, error: "Category name is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      canteen_id: canteenId,
      name: cleanName,
      display_order: displayOrder,
      is_active: true,
    })
    .select("id, canteen_id, name, display_order, is_active")
    .single();

  if (error) {
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return {
        success: false,
        error: "A category with this name already exists in this canteen.",
        code: "UNIQUE_VIOLATION",
      };
    }
    return { success: false, error: error.message || "Failed to create category." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  safeRevalidateTag("categories");
  return { success: true, data: data as AdminCategory };
}

export async function adminUpdateCategoryAction(
  categoryId: string,
  name: string,
  displayOrder: number,
  isActive: boolean = true
): Promise<ActionResult> {
  await requireRole(["admin"]);

  const cleanName = name.trim();
  if (!cleanName) {
    return { success: false, error: "Category name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({
      name: cleanName,
      display_order: displayOrder,
      is_active: isActive,
    })
    .eq("id", categoryId);

  if (error) {
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return {
        success: false,
        error: "A category with this name already exists in this canteen.",
        code: "UNIQUE_VIOLATION",
      };
    }
    return { success: false, error: error.message || "Failed to update category." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  safeRevalidateTag("categories");
  return { success: true, data: undefined };
}

export async function adminArchiveCategoryAction(categoryId: string): Promise<ActionResult> {
  await requireRole(["admin"]);

  const supabase = await createClient();
  // Safe archive instead of hard delete
  const { error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", categoryId);

  if (error) {
    return { success: false, error: error.message || "Failed to archive category." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  safeRevalidateTag("categories");
  return { success: true, data: undefined };
}

export interface MenuItemInput {
  canteen_id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price_rupees: string | number;
  image_url?: string | null;
  is_veg: boolean;
  is_available: boolean;
  stock?: number | null;
  prep_minutes: number;
  calories_kcal?: number | null;
  ingredients?: string[] | null;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  fibre_g?: number | null;
  sugar_g?: number | null;
  sat_fat_g?: number | null;
  key_minerals?: string[] | null;
}

export async function adminCreateMenuItemAction(
  item: MenuItemInput
): Promise<ActionResult<AdminMenuItem>> {
  await requireRole(["admin"]);

  const cleanName = item.name.trim();
  if (!cleanName) {
    return { success: false, error: "Item name is required." };
  }

  const priceParsed = parseRupeesToPaise(item.price_rupees);
  if (!priceParsed.success || priceParsed.paise === undefined) {
    return { success: false, error: priceParsed.error || "Invalid item price." };
  }

  if (item.image_url && !isAllowedMenuImageUrl(item.image_url)) {
    return {
      success: false,
      error: "Image URL must point to the canteen menu-images storage bucket.",
    };
  }

  const prepMins = Math.max(1, Math.min(item.prep_minutes || 5, 180));
  const stockVal = item.stock !== undefined && item.stock !== null ? Math.max(0, item.stock) : null;

  const nutritionValidation = validateAndNormalizeNutrition({
    calories_kcal: item.calories_kcal,
    ingredients: item.ingredients,
    protein_g: item.protein_g,
    fat_g: item.fat_g,
    carbs_g: item.carbs_g,
    fibre_g: item.fibre_g,
    sugar_g: item.sugar_g,
    sat_fat_g: item.sat_fat_g,
    key_minerals: item.key_minerals,
  });
  if (!nutritionValidation.success) {
    return { success: false, error: nutritionValidation.error || "Invalid nutrition data." };
  }

  const caloriesVal = nutritionValidation.calories_kcal ?? null;
  const ingredientsVal = nutritionValidation.ingredients ?? [];
  const proteinVal = nutritionValidation.protein_g ?? null;
  const fatVal = nutritionValidation.fat_g ?? null;
  const carbsVal = nutritionValidation.carbs_g ?? null;
  const fibreVal = nutritionValidation.fibre_g ?? null;
  const sugarVal = nutritionValidation.sugar_g ?? null;
  const satFatVal = nutritionValidation.sat_fat_g ?? null;
  const mineralsVal = nutritionValidation.key_minerals ?? [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menu_items")
    .insert({
      canteen_id: item.canteen_id,
      category_id: item.category_id,
      name: cleanName,
      description: item.description?.trim() || null,
      price_paise: priceParsed.paise,
      image_url: item.image_url?.trim() || null,
      is_veg: item.is_veg,
      is_available: item.is_available,
      stock: stockVal,
      prep_minutes: prepMins,
      is_active: true,
      calories_kcal: caloriesVal,
      ingredients: ingredientsVal,
      protein_g: proteinVal,
      fat_g: fatVal,
      carbs_g: carbsVal,
      fibre_g: fibreVal,
      sugar_g: sugarVal,
      sat_fat_g: satFatVal,
      key_minerals: mineralsVal,
    })
    .select(
      "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, calories_kcal, ingredients"
    )
    .single();

  if (error) {
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return {
        success: false,
        error: "A menu item with this name already exists in this category/canteen.",
        code: "UNIQUE_VIOLATION",
      };
    }
    return { success: false, error: error.message || "Failed to create menu item." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  return { success: true, data: data as AdminMenuItem };
}

export async function adminUpdateMenuItemAction(
  itemId: string,
  item: MenuItemInput,
  oldImageUrl?: string | null
): Promise<ActionResult> {
  await requireRole(["admin"]);

  const cleanName = item.name.trim();
  if (!cleanName) {
    return { success: false, error: "Item name is required." };
  }

  const priceParsed = parseRupeesToPaise(item.price_rupees);
  if (!priceParsed.success || priceParsed.paise === undefined) {
    return { success: false, error: priceParsed.error || "Invalid item price." };
  }

  if (item.image_url && !isAllowedMenuImageUrl(item.image_url)) {
    return {
      success: false,
      error: "Image URL must point to the canteen menu-images storage bucket.",
    };
  }

  const prepMins = Math.max(1, Math.min(item.prep_minutes || 5, 180));
  const stockVal = item.stock !== undefined && item.stock !== null ? Math.max(0, item.stock) : null;

  const nutritionValidation = validateAndNormalizeNutrition({
    calories_kcal: item.calories_kcal,
    ingredients: item.ingredients,
    protein_g: item.protein_g,
    fat_g: item.fat_g,
    carbs_g: item.carbs_g,
    fibre_g: item.fibre_g,
    sugar_g: item.sugar_g,
    sat_fat_g: item.sat_fat_g,
    key_minerals: item.key_minerals,
  });
  if (!nutritionValidation.success) {
    return { success: false, error: nutritionValidation.error || "Invalid nutrition data." };
  }

  const supabase = await createClient();

  // If old image is replaced or removed, safely clean up old storage object
  if (oldImageUrl && oldImageUrl !== item.image_url) {
    const filenameToDelete = extractStorageFilename(oldImageUrl);
    if (filenameToDelete) {
      await supabase.storage.from("menu-images").remove([filenameToDelete]);
    }
  }

  const updatePayload: Record<string, unknown> = {
    category_id: item.category_id,
    name: cleanName,
    description: item.description?.trim() || null,
    price_paise: priceParsed.paise,
    image_url: item.image_url?.trim() || null,
    is_veg: item.is_veg,
    is_available: item.is_available,
    stock: stockVal,
    prep_minutes: prepMins,
  };

  if ("calories_kcal" in item && item.calories_kcal !== undefined) {
    updatePayload.calories_kcal = nutritionValidation.calories_kcal ?? null;
  }

  if ("ingredients" in item && item.ingredients !== undefined) {
    updatePayload.ingredients = nutritionValidation.ingredients ?? [];
  }

  if ("protein_g" in item && item.protein_g !== undefined) {
    updatePayload.protein_g = nutritionValidation.protein_g ?? null;
  }

  if ("fat_g" in item && item.fat_g !== undefined) {
    updatePayload.fat_g = nutritionValidation.fat_g ?? null;
  }

  if ("carbs_g" in item && item.carbs_g !== undefined) {
    updatePayload.carbs_g = nutritionValidation.carbs_g ?? null;
  }

  if ("fibre_g" in item && item.fibre_g !== undefined) {
    updatePayload.fibre_g = nutritionValidation.fibre_g ?? null;
  }

  if ("sugar_g" in item && item.sugar_g !== undefined) {
    updatePayload.sugar_g = nutritionValidation.sugar_g ?? null;
  }

  if ("sat_fat_g" in item && item.sat_fat_g !== undefined) {
    updatePayload.sat_fat_g = nutritionValidation.sat_fat_g ?? null;
  }

  if ("key_minerals" in item && item.key_minerals !== undefined) {
    updatePayload.key_minerals = nutritionValidation.key_minerals ?? [];
  }

  const { error } = await supabase
    .from("menu_items")
    .update(updatePayload)
    .eq("id", itemId);

  if (error) {
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return {
        success: false,
        error: "A menu item with this name already exists in this category/canteen.",
        code: "UNIQUE_VIOLATION",
      };
    }
    return { success: false, error: error.message || "Failed to update menu item." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  safeRevalidateTag("categories");
  return { success: true, data: undefined };
}

export async function adminArchiveMenuItemAction(itemId: string): Promise<ActionResult> {
  await requireRole(["admin"]);

  const supabase = await createClient();
  // Safe archive instead of hard delete (FK is ON DELETE RESTRICT on order_items)
  const { error } = await supabase
    .from("menu_items")
    .update({ is_active: false })
    .eq("id", itemId);

  if (error) {
    return { success: false, error: error.message || "Failed to archive menu item." };
  }

  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  safeRevalidateTag("categories");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// 6. Image Upload Action
// ---------------------------------------------------------------------------

export async function uploadMenuImageAction(
  formData: FormData
): Promise<ActionResult<{ publicUrl: string }>> {
  await requireRole(["admin"]);

  const file = formData.get("file") as File | null;
  if (!file) {
    return { success: false, error: "No image file provided." };
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const validation = validateImageBytes(bytes);
  if (!validation.valid || !validation.extension) {
    return {
      success: false,
      error: validation.error || "Invalid image file.",
    };
  }

  // Generate unique filename
  const filename = `${crypto.randomUUID()}.${validation.extension}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("menu-images")
    .upload(filename, bytes, {
      contentType: validation.mimeType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    return {
      success: false,
      error: uploadError.message || "Failed to upload image to storage.",
    };
  }

  const { data: publicUrlData } = supabase.storage
    .from("menu-images")
    .getPublicUrl(filename);

  return {
    success: true,
    data: { publicUrl: publicUrlData.publicUrl },
  };
}

// ---------------------------------------------------------------------------
// 9. Student Strikes & Penalty Management
// ---------------------------------------------------------------------------

export type StudentStrikeRow = {
  student_id: string;
  student_name: string;
  college_id_last4: string;
  strike_count: number;
  last_no_show_at: string | null;
  is_limited: boolean;
};

export async function adminListStudentStrikesAction(): Promise<ActionResult<StudentStrikeRow[]>> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_student_strikes");

  if (error) {
    return { success: false, error: error.message || "Failed to list student strikes." };
  }

  return { success: true, data: data as StudentStrikeRow[] };
}

export async function adminClearStudentStrikesAction(
  studentId: string,
  reason: string = "Cleared by admin"
): Promise<ActionResult> {
  await requireRole(["admin"]);
  const parsedId = uuidSchema.safeParse(studentId);
  if (!parsedId.success) {
    return { success: false, error: "Invalid student ID." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_clear_student_strikes", {
    p_student_id: parsedId.data,
    p_reason: reason.trim() || "Cleared by admin",
  });

  if (error) {
    return { success: false, error: error.message || "Failed to clear strikes." };
  }

  revalidatePath("/admin/strikes");
  return { success: true, data: undefined };
}

// ---------------------------------------------------------------------------
// 10. Daily Financial & Operational Reconciliation
// ---------------------------------------------------------------------------

export type DailyReconciliationData = {
  date: string;
  canteen_id: string | null;
  canteens: Array<{
    canteen_id: string;
    canteen_name: string;
    collected_count: number;
    total_collected_paise: number;
    cash_collected_count: number;
    cash_collected_paise: number;
    upi_collected_count: number;
    upi_collected_paise: number;
    manual_override_count: number;
    late_handover_count: number;
    no_show_count: number;
  }>;
  staff: Array<{
    canteen_id: string;
    canteen_name: string;
    staff_id: string;
    staff_name: string;
    collected_count: number;
    total_collected_paise: number;
    cash_count: number;
    cash_paise: number;
    upi_count: number;
    upi_paise: number;
    manual_count: number;
    manual_rate_pct: number;
    late_handover_count: number;
  }>;
  summary: {
    target_date: string;
    total_collected_count: number;
    total_collected_paise: number;
    total_cash_paise: number;
    total_upi_paise: number;
    total_manual_count: number;
    total_late_handover_count: number;
    total_no_show_count: number;
  };
};

export async function getDailyReconciliationAction(
  date?: string,
  canteenId?: string
): Promise<ActionResult<DailyReconciliationData>> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const rpcParams: Record<string, unknown> = {};
  if (date) rpcParams.p_date = date;
  if (canteenId) rpcParams.p_canteen_id = canteenId;

  const { data, error } = await supabase.rpc("get_daily_reconciliation", rpcParams);

  if (error) {
    return { success: false, error: error.message.replace(/^[A-Z_]+:\s*/, "") || "Failed to fetch reconciliation." };
  }

  return { success: true, data: data as DailyReconciliationData };
}

// ---------------------------------------------------------------------------
// 11. Collection Dispute Reports
// ---------------------------------------------------------------------------

export type AdminCollectionReportRow = {
  id: string;
  order_id: string;
  order_code: string;
  user_id: string;
  student_name: string;
  student_college_id: string | null;
  canteen_name: string | null;
  reason: string;
  status: "PENDING" | "RESOLVED" | "DISMISSED";
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  collection_method: string;
  collected_with: string;
  is_manual_override: boolean;
  manual_override_reason: string | null;
  collected_at: string;
  collecting_staff_name: string | null;
};

export async function adminListCollectionReportsAction(
  status?: string,
  limit: number = 50,
  offset: number = 0
): Promise<ActionResult<AdminCollectionReportRow[]>> {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_collection_reports", {
    p_status: status && status !== "ALL" ? status : null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return { success: false, error: error.message || "Failed to list collection reports." };
  }

  return { success: true, data: (data || []) as AdminCollectionReportRow[] };
}

export async function adminResolveCollectionReportAction(
  reportId: string,
  resolution: "RESOLVED" | "DISMISSED",
  notes?: string
): Promise<ActionResult> {
  await requireRole(["admin"]);
  const parsedId = uuidSchema.safeParse(reportId);
  if (!parsedId.success) {
    return { success: false, error: "Invalid report ID." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resolve_collection_report", {
    p_report_id: parsedId.data,
    p_resolution: resolution,
    p_notes: notes?.trim() || null,
  });

  if (error) {
    return { success: false, error: error.message || "Failed to resolve report." };
  }

  revalidatePath("/admin/reports");
  return { success: true, data: undefined };
}

