import type { Metadata } from "next";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { HealthyModeView } from "@/components/student/healthy-mode-view";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export const metadata: Metadata = {
  title: "Healthy Mode & High-Protein Fuel | Campus Canteen",
  description: "Explore high-protein, nutrient-dense campus canteen meals with full macronutrient pie charts, mineral percentages, and clean calories.",
};

export default async function HealthyModePage() {
  await requireRole(["student"]);
  const canteenId = await getActiveCanteenId();

  let canteenItems: MenuItemData[] = [];

  if (canteenId) {
    const supabase = await createReadOnlyClient();
    const { data } = await supabase
      .from("menu_items")
      .select("id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients")
      .eq("canteen_id", canteenId)
      .eq("is_active", true);

    if (data) {
      canteenItems = data as MenuItemData[];
    }
  }

  return <HealthyModeView canteenItems={canteenItems} />;
}
