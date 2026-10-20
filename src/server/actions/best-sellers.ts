"use server";

import * as z from "zod";

import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createClient } from "@/lib/supabase/server";
import { logSupabaseError, isMissingColumnError } from "@/lib/supabase-error";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

const bestSellersQuerySchema = z.object({
  days: z.number().int().min(1).max(90).optional().default(30),
  limit: z.number().int().min(1).max(20).optional().default(8),
});

export type BestSellerQueryInput = z.infer<typeof bestSellersQuerySchema>;

export type BestSellerItem = {
  rank: number;
  units_sold: string;
  item: MenuItemData;
};

export type GetBestSellersResult = {
  success: boolean;
  data: BestSellerItem[];
  error?: string;
};

type RpcBestSellerRow = {
  menu_item_id: string;
  rank: number;
  units_sold: string;
};

/**
 * Server action to fetch real sales-driven best sellers for the active canteen.
 *
 * Rules & Invariants:
 * - Requires active user with 'student' role.
 * - Resolves canteenId strictly via getActiveCanteenId() (never client-supplied).
 * - Calls SECURITY DEFINER function public.get_best_sellers via session-scoped Supabase client.
 * - Follow-up query fetches details for only active & available items in that canteen.
 * - Drops unavailable items automatically; enforces >= 3 items threshold.
 * - Never uses unstable_cache (must respect session cookies).
 * - Silent degradation: on any failure, logs to console.error and returns empty array.
 */
export async function getBestSellersAction(
  input?: Partial<BestSellerQueryInput>
): Promise<GetBestSellersResult> {
  try {
    await requireRole(["student"]);

    const parsed = bestSellersQuerySchema.safeParse(input ?? {});
    if (!parsed.success) {
      console.error("[getBestSellersAction] Validation error:", parsed.error.format());
      return { success: true, data: [] };
    }

    const canteenId = await getActiveCanteenId();
    if (!canteenId) {
      return { success: true, data: [] };
    }

    const { days, limit } = parsed.data;
    const supabase = await createClient();

    // 1. Fetch ranked sales from RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_best_sellers", {
      p_canteen_id: canteenId,
      p_days: days,
      p_limit: limit,
    });

    if (rpcError) {
      logSupabaseError("getBestSellersAction:rpc", rpcError);
      return { success: true, data: [] };
    }

    const rawBestSellers = (rpcData as RpcBestSellerRow[]) ?? [];
    if (!Array.isArray(rawBestSellers) || rawBestSellers.length < 3) {
      return { success: true, data: [] };
    }

    const itemIds = rawBestSellers.map((r) => r.menu_item_id);

    // 2. Fetch full menu item details in one follow-up query
    const { data: itemRows, error: itemsError } = await supabase
      .from("menu_items")
      .select(
        "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients"
      )
      .eq("canteen_id", canteenId)
      .in("id", itemIds)
      .eq("is_active", true)
      .eq("is_available", true);

    let finalItemRows = itemRows;

    if (itemsError) {
      logSupabaseError("getBestSellersAction:items", itemsError);

      if (isMissingColumnError(itemsError)) {
        // TODO: Remove fallback after migration 0018 is applied
        console.warn("[getBestSellersAction] WARNING: migration 0018 not applied");
        const fallbackRes = await supabase
          .from("menu_items")
          .select(
            "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count"
          )
          .eq("canteen_id", canteenId)
          .in("id", itemIds)
          .eq("is_active", true)
          .eq("is_available", true);

        if (fallbackRes.error) {
          logSupabaseError("getBestSellersAction:items_fallback", fallbackRes.error);
          return { success: true, data: [] };
        }

        finalItemRows = (fallbackRes.data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          calories_kcal: null,
          ingredients: [],
        })) as unknown as typeof itemRows;
      } else {
        return { success: true, data: [] };
      }
    }

    const itemsMap = new Map<string, MenuItemData>();
    for (const row of (finalItemRows as MenuItemData[]) ?? []) {
      itemsMap.set(row.id, row);
    }

    // 3. Assemble and preserve ranking, dropping any item that is no longer available
    const assembled: BestSellerItem[] = [];
    for (const b of rawBestSellers) {
      const item = itemsMap.get(b.menu_item_id);
      if (item) {
        assembled.push({
          rank: b.rank,
          units_sold: b.units_sold,
          item,
        });
      }
    }

    // Threshold invariant: if items dropped out and remaining is under 3, hide section
    if (assembled.length < 3) {
      return { success: true, data: [] };
    }

    return {
      success: true,
      data: assembled,
    };
  } catch (error) {
    console.error("[getBestSellersAction] Unexpected error:", error);
    return {
      success: true,
      data: [],
    };
  }
}
