import { INSIGHT_THRESHOLDS } from "@/lib/healthy-constants";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export interface MacroCalorieShare {
  proteinCalories: number;
  carbsCalories: number;
  fatCalories: number;
  totalMacroCalories: number;
  proteinPercent: number;
  carbsPercent: number;
  fatPercent: number;
}

/**
 * Calculates Atwater macronutrient calorie values and whole-number percentages summing to 100.
 * Atwater factors: Protein 4 kcal/g, Carbohydrates 4 kcal/g, Fat 9 kcal/g.
 */
export function calculateMacroCalorieShares(
  protein_g?: number | null,
  carbs_g?: number | null,
  fat_g?: number | null
): MacroCalorieShare {
  const p = protein_g != null && protein_g > 0 ? protein_g : 0;
  const c = carbs_g != null && carbs_g > 0 ? carbs_g : 0;
  const f = fat_g != null && fat_g > 0 ? fat_g : 0;

  const proteinCalories = Math.round(p * 4);
  const carbsCalories = Math.round(c * 4);
  const fatCalories = Math.round(f * 9);
  const totalMacroCalories = proteinCalories + carbsCalories + fatCalories;

  if (totalMacroCalories <= 0) {
    return {
      proteinCalories: 0,
      carbsCalories: 0,
      fatCalories: 0,
      totalMacroCalories: 0,
      proteinPercent: 0,
      carbsPercent: 0,
      fatPercent: 0,
    };
  }

  const rawProteinPct = (proteinCalories / totalMacroCalories) * 100;
  const rawCarbsPct = (carbsCalories / totalMacroCalories) * 100;

  const proteinPercent = Math.round(rawProteinPct);
  const carbsPercent = Math.round(rawCarbsPct);
  // Guarantee sum is exactly 100
  const fatPercent = Math.max(0, 100 - proteinPercent - carbsPercent);

  return {
    proteinCalories,
    carbsCalories,
    fatCalories,
    totalMacroCalories,
    proteinPercent,
    carbsPercent,
    fatPercent,
  };
}

export interface DonutArcConfig {
  radius: number;
  circumference: number;
  proteinArc: number;
  carbsArc: number;
  fatArc: number;
  proteinOffset: number;
  carbsOffset: number;
  fatOffset: number;
}

/**
 * Calculates pure SVG donut arc stroke-dasharray and stroke-dashoffset values.
 */
export function calculateDonutArcs(
  proteinPercent: number,
  carbsPercent: number,
  fatPercent: number,
  radius = 38
): DonutArcConfig {
  const circumference = 2 * Math.PI * radius;

  const proteinArc = (Math.max(0, proteinPercent) / 100) * circumference;
  const carbsArc = (Math.max(0, carbsPercent) / 100) * circumference;
  const fatArc = (Math.max(0, fatPercent) / 100) * circumference;

  const proteinOffset = 0;
  const carbsOffset = -proteinArc;
  const fatOffset = -(proteinArc + carbsArc);

  return {
    radius,
    circumference,
    proteinArc,
    carbsArc,
    fatArc,
    proteinOffset,
    carbsOffset,
    fatOffset,
  };
}

export interface NutritionalInsights {
  highlights: string[];
  considerations: string[];
}

/**
 * Generates neutral, factual nutritional statements strictly from dish data.
 * Does not make disease, diet, or allergen claims.
 */
export function generateNutritionalInsights(
  item: MenuItemData
): NutritionalInsights {
  const highlights: string[] = [];
  const considerations: string[] = [];

  const {
    highProtein,
    goodProtein,
    highFibre,
    goodFibre,
    highSugar,
    highSatFat,
    lowCalorieMax,
    balancedCalorieMax,
  } = INSIGHT_THRESHOLDS;

  // Protein checks
  if (item.protein_g != null) {
    if (item.protein_g >= highProtein) {
      highlights.push(`High protein: ${item.protein_g}g per serving`);
    } else if (item.protein_g >= goodProtein) {
      highlights.push(`Good protein source: ${item.protein_g}g per serving`);
    }
  }

  // Fibre checks
  if (item.fibre_g != null) {
    if (item.fibre_g >= highFibre) {
      highlights.push(`High fibre: ${item.fibre_g}g per serving`);
    } else if (item.fibre_g >= goodFibre) {
      highlights.push(`Good fibre: ${item.fibre_g}g per serving`);
    }
  }

  // Calorie checks
  if (item.calories_kcal != null) {
    if (item.calories_kcal < lowCalorieMax) {
      highlights.push(`Under ${lowCalorieMax} kcal per serving`);
    } else if (item.calories_kcal <= balancedCalorieMax) {
      highlights.push(`Balanced calorie range (${item.calories_kcal} kcal)`);
    }
  }

  // Saturated fat check
  if (item.sat_fat_g != null && item.sat_fat_g >= highSatFat) {
    considerations.push(`Higher in saturated fat: ${item.sat_fat_g}g`);
  }

  // Sugar check
  if (item.sugar_g != null && item.sugar_g >= highSugar) {
    considerations.push(`Higher in sugar: ${item.sugar_g}g`);
  }

  return { highlights, considerations };
}
