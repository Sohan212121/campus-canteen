import Link from "next/link";
import { Leaf } from "lucide-react";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { logSupabaseError, isMissingColumnError } from "@/lib/supabase-error";
import { getBestSellersAction, type BestSellerItem } from "@/server/actions/best-sellers";
import { MenuView, type CategoryData } from "@/components/student/menu-view";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export default async function MenuPage() {
  await requireRole(["student"]);
  const canteenId = await getActiveCanteenId();

  let categories: CategoryData[] = [];
  let menuItems: MenuItemData[] = [];
  let bestSellers: BestSellerItem[] = [];

  if (canteenId) {
    const supabase = await createReadOnlyClient();

    const [categoriesRes, itemsRes, bestSellersRes] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, display_order, is_active")
        .eq("canteen_id", canteenId)
        .eq("is_active", true)
        .order("display_order", { ascending: true }),

      supabase
        .from("menu_items")
        .select(
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients"
        )
        .eq("canteen_id", canteenId)
        .eq("is_active", true)
        .order("name", { ascending: true }),

      getBestSellersAction().catch((err) => {
        console.error("Failed to load best sellers on menu page:", err);
        return { success: true, data: [] };
      }),
    ]);

    if (categoriesRes.data) {
      categories = categoriesRes.data as CategoryData[];
    } else if (categoriesRes.error) {
      logSupabaseError("MenuPage:categories", categoriesRes.error);
    }

    if (itemsRes.data) {
      menuItems = itemsRes.data as MenuItemData[];
    } else if (itemsRes.error) {
      logSupabaseError("MenuPage:menu_items", itemsRes.error);

      if (isMissingColumnError(itemsRes.error)) {
        // TODO: Remove fallback after migration 0018 is applied
        console.warn("[MenuPage] WARNING: migration 0018 not applied");
        const fallbackRes = await supabase
          .from("menu_items")
          .select(
            "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count"
          )
          .eq("canteen_id", canteenId)
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (fallbackRes.data) {
          menuItems = fallbackRes.data.map((row: Record<string, unknown>) => ({
            ...row,
            calories_kcal: null,
            ingredients: [],
          })) as MenuItemData[];
        } else if (fallbackRes.error) {
          logSupabaseError("MenuPage:menu_items_fallback", fallbackRes.error);
        }
      }
    }

    if (bestSellersRes.success && bestSellersRes.data) {
      bestSellers = bestSellersRes.data;
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Canteen Menu</h1>
          <p className="text-xs text-muted-foreground">
            Select items and customize quantities before placing your pre-order.
          </p>
        </div>

        <Link
          href="/healthy"
          prefetch={true}
          className="shrink-0 min-h-[40px] px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
          aria-label="Switch to Healthy Mode"
        >
          <Leaf className="h-4 w-4" />
          <span>Healthy Mode</span>
        </Link>
      </header>

      <MenuView
        categories={categories}
        initialItems={menuItems}
        bestSellers={bestSellers}
      />
    </div>
  );
}
