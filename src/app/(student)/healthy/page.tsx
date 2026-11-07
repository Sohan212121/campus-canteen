import type { Metadata } from "next";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { isMissingColumnError, logSupabaseError } from "@/lib/supabase-error";
import { HealthyMainView } from "@/components/student/healthy/healthy-main-view";
import {
  enrichAndFilterProteinMenuItems,
  getRealMenuNutrition,
} from "@/lib/real-menu-nutrition";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export const metadata: Metadata = {
  title: "Healthy Mode & High-Protein Fuel | C@mpBite",
  description:
    "Explore high-protein, nutrient-dense C@mpBite meals with full macronutrient pie charts, mineral percentages, and clean calories.",
};

export default async function HealthyModePage() {
  const profile = await requireRole(["student"]);
  const canteenId = await getActiveCanteenId();

  let canteenItems: MenuItemData[] = [];
  let orderedProteinToday = 0;

  if (canteenId) {
    const supabase = await createReadOnlyClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Query active menu items and today's user orders in parallel
    const [menuRes, ordersRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select(
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients, protein_g, fat_g, carbs_g, fibre_g, sugar_g, sat_fat_g, key_minerals"
        )
        .eq("canteen_id", canteenId)
        .eq("is_active", true)
        .order("name", { ascending: true }),

      supabase
        .from("orders")
        .select(`
          id,
          status,
          placed_at,
          order_items (
            name_snapshot,
            quantity
          )
        `)
        .eq("user_id", profile.id)
        .neq("status", "CANCELLED")
        .gte("placed_at", todayStart.toISOString()),
    ]);

    // Calculate protein from today's successful orders
    if (ordersRes.data) {
      for (const order of ordersRes.data) {
        if (Array.isArray(order.order_items)) {
          for (const item of order.order_items) {
            const nut = getRealMenuNutrition(item.name_snapshot);
            if (nut && nut.is_protein) {
              orderedProteinToday += (nut.protein_g || 0) * (item.quantity || 1);
            }
          }
        }
      }
    }

    if (menuRes.error) {
      if (
        isMissingColumnError(menuRes.error) ||
        menuRes.error.code === "42703" ||
        String(menuRes.error.code).includes("42703")
      ) {
        // Fallback query to load active items without the unapplied macro columns
        const fallbackRes = await supabase
          .from("menu_items")
          .select(
            "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients"
          )
          .eq("canteen_id", canteenId)
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (fallbackRes.data) {
          canteenItems = fallbackRes.data.map((row: Record<string, unknown>) => ({
            ...row,
            protein_g: null,
            fat_g: null,
            carbs_g: null,
            fibre_g: null,
            sugar_g: null,
            sat_fat_g: null,
            key_minerals: [],
          })) as MenuItemData[];
        }
      } else {
        logSupabaseError("HealthyModePage:menu_items", menuRes.error);
      }
    } else if (menuRes.data) {
      canteenItems = menuRes.data as MenuItemData[];
    }
  }

  // Filter ONLY available protein-content items from the real menu and enrich with verified macros
  const realProteinItems = enrichAndFilterProteinMenuItems(canteenItems);

  return (
    <HealthyMainView
      initialItems={realProteinItems}
      initialOrderedProteinToday={orderedProteinToday}
      migrationPending={false}
    />
  );
}
