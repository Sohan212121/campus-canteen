import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
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
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count"
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
    }
    if (itemsRes.data) {
      menuItems = itemsRes.data as MenuItemData[];
    }
    if (bestSellersRes.success && bestSellersRes.data) {
      bestSellers = bestSellersRes.data;
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Canteen Menu</h1>
        <p className="text-xs text-muted-foreground">
          Select items and customize quantities before placing your pre-order.
        </p>
      </header>

      <MenuView
        categories={categories}
        initialItems={menuItems}
        bestSellers={bestSellers}
      />
    </div>
  );
}
