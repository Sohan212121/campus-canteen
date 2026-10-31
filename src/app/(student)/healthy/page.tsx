import type { Metadata } from "next";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { isMissingColumnError, logSupabaseError } from "@/lib/supabase-error";
import { HealthyMainView } from "@/components/student/healthy/healthy-main-view";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export const metadata: Metadata = {
  title: "Healthy Mode & High-Protein Fuel | Campus Canteen",
  description:
    "Explore high-protein, nutrient-dense campus canteen meals with full macronutrient pie charts, mineral percentages, and clean calories.",
};

export default async function HealthyModePage() {
  await requireRole(["student"]);
  const canteenId = await getActiveCanteenId();

  let canteenItems: MenuItemData[] = [];
  let migrationPending = false;

  if (canteenId) {
    const supabase = await createReadOnlyClient();

    // Query menu items including the new macro columns added in migration 0020
    const { data, error } = await supabase
      .from("menu_items")
      .select(
        "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients, protein_g, fat_g, carbs_g, fibre_g, sugar_g, sat_fat_g, key_minerals"
      )
      .eq("canteen_id", canteenId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      if (
        isMissingColumnError(error) ||
        error.code === "42703" ||
        String(error.code).includes("42703")
      ) {
        console.warn("[HealthyModePage] WARNING: migration 0020 not applied");
        migrationPending = true;

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
        logSupabaseError("HealthyModePage:menu_items", error);
      }
    } else if (data) {
      canteenItems = data as MenuItemData[];
    }
  }

  return (
    <HealthyMainView
      initialItems={canteenItems}
      migrationPending={migrationPending}
    />
  );
}
