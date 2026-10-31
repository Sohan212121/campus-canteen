import type { MenuItemData } from "@/components/student/item-detail-sheet";

export interface HealthyPreferences {
  targetCalories: number; // 200..800 kcal (default 400)
  targetProtein: number; // 10..60 g (default 30)
  tolerance?: number; // default 0.20 (widened to 0.35 on request)
}

export interface HealthySuggestion {
  item: MenuItemData;
  distance: number;
  isCloseMatch: boolean;
  matchReason: string;
  whyItMatches: string;
}

export const DEFAULT_HEALTHY_PREFERENCES: HealthyPreferences = {
  targetCalories: 400,
  targetProtein: 30,
  tolerance: 0.20,
};

/**
 * Pure function that ranks and suggests dishes based on student calorie and protein slider targets.
 * Only includes active, available dishes with BOTH calories_kcal and protein_g.
 * Filters within tolerance (default ±20%, widenable to ±35%).
 * Returns up to 12 suggestions sorted by closest match (closeness distance), then by price.
 */
export function suggestHealthyDishes(
  items: MenuItemData[],
  preferences: HealthyPreferences
): HealthySuggestion[] {
  const { targetCalories, targetProtein, tolerance = 0.20 } = preferences;

  // Filter to active, available dishes with both metrics
  const eligibleItems = items.filter(
    (item) =>
      item.is_active &&
      item.is_available &&
      (item.stock === null || item.stock > 0) &&
      item.calories_kcal != null &&
      item.calories_kcal > 0 &&
      item.protein_g != null &&
      item.protein_g >= 0
  );

  // Filter within requested tolerance
  const matchedItems = eligibleItems.filter((item) => {
    const cals = item.calories_kcal as number;
    const protein = item.protein_g as number;
    const calWithin = Math.abs(cals - targetCalories) <= targetCalories * tolerance;
    const proteinWithin = Math.abs(protein - targetProtein) <= targetProtein * tolerance;
    return calWithin && proteinWithin;
  });

  const scored: HealthySuggestion[] = matchedItems.map((item) => {
    const cals = item.calories_kcal as number;
    const protein = item.protein_g as number;

    // Normalised distance across full slider scales:
    // Calories scale: 200 to 800 (width = 600)
    // Protein scale: 10 to 60 (width = 50)
    const calDelta = Math.abs(cals - targetCalories) / 600;
    const proteinDelta = Math.abs(protein - targetProtein) / 50;
    const combinedDistance = calDelta * 0.5 + proteinDelta * 0.5;

    // Tolerance ±20%
    const calWithin20 = Math.abs(cals - targetCalories) <= targetCalories * 0.2;
    const proteinWithin20 = Math.abs(protein - targetProtein) <= targetProtein * 0.2;
    const isCloseMatch = calWithin20 && proteinWithin20;

    const proteinDiffPct = Math.round((Math.abs(protein - targetProtein) / targetProtein) * 100);
    const whyItMatches = `Within ${proteinDiffPct}% of your protein target, ${cals} kcal`;

    return {
      item,
      distance: combinedDistance,
      isCloseMatch,
      matchReason: whyItMatches,
      whyItMatches,
    };
  });

  // Sort by lowest distance (closest match), then by price (ascending)
  scored.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > 0.001) {
      return a.distance - b.distance;
    }
    return a.item.price_paise - b.item.price_paise;
  });

  return scored.slice(0, 12);
}
