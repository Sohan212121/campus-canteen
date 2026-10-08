"use server";

import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";

const cartItemIdsSchema = z.array(z.string().uuid()).max(50);

export type CartItemDetail = {
  id: string;
  name: string;
  price_paise: number;
  is_available: boolean;
  is_active: boolean;
  stock: number | null;
  prep_minutes: number;
  image_url: string | null;
};

export type CartItemDetailsResult = {
  success: boolean;
  data?: CartItemDetail[];
  error?: string;
};

/**
 * Server action to fetch current price, availability, and stock for items
 * in the client's cart.
 *
 * Requirements:
 * - Requires an authenticated user role (student, staff, or admin).
 * - Validates item IDs with Zod (UUID array, max 50).
 * - Returns only the fields required for cart calculation and display.
 * - Always reads fresh state from the database; never trusts frontend pricing.
 */
export async function getCartItemDetailsAction(
  itemIds: string[]
): Promise<CartItemDetailsResult> {
  await requireRole(["student", "staff", "admin"]);

  const parsed = cartItemIdsSchema.safeParse(itemIds);
  if (!parsed.success) {
    return { success: false, error: "Invalid item IDs requested." };
  }

  if (parsed.data.length === 0) {
    return { success: true, data: [] };
  }

  const supabase = await createReadOnlyClient();
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, name, price_paise, is_available, is_active, stock, prep_minutes, image_url")
    .in("id", parsed.data);

  if (error) {
    return { success: false, error: "Failed to fetch item details." };
  }

  return {
    success: true,
    data: (data || []) as CartItemDetail[],
  };
}
