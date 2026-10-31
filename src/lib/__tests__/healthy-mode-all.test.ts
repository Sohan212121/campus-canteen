import { describe, it, expect } from "vitest";
import {
  validateAndNormalizeNutrition,
  normalizeMineralsList,
} from "@/lib/menu-nutrition";
import {
  calculateHealthyScore,
} from "@/lib/healthy-score";
import {
  calculateMacroCalorieShares,
  calculateDonutArcs,
  generateNutritionalInsights,
} from "@/lib/healthy-macros";
import {
  suggestHealthyDishes,
} from "@/lib/healthy-suggestions";
import {
  HEALTHY_SCORE_THRESHOLDS,
} from "@/lib/healthy-constants";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

describe("Macronutrients & Minerals Validation (menu-nutrition.ts)", () => {
  describe("Minerals helper boundary tests", () => {
    it("accepts 0 minerals (empty array)", () => {
      const res = validateAndNormalizeNutrition({ key_minerals: [] });
      expect(res.success).toBe(true);
      expect(res.key_minerals).toEqual([]);
    });

    it("drops empty or whitespace-only mineral items", () => {
      const res = normalizeMineralsList(["Iron", "", "  ", "\u200B", "Zinc"]);
      expect(res).toEqual(["Iron", "Zinc"]);
    });

    it("accepts up to 8 minerals", () => {
      const eight = [
        "Iron",
        "Zinc",
        "Magnesium",
        "Calcium",
        "Potassium",
        "Folate",
        "Selenium",
        "Copper",
      ];
      const res = validateAndNormalizeNutrition({ key_minerals: eight });
      expect(res.success).toBe(true);
      expect(res.key_minerals?.length).toBe(8);
    });

    it("rejects 9 minerals", () => {
      const nine = [
        "Iron",
        "Zinc",
        "Magnesium",
        "Calcium",
        "Potassium",
        "Folate",
        "Selenium",
        "Copper",
        "Manganese",
      ];
      const res = validateAndNormalizeNutrition({ key_minerals: nine });
      expect(res.success).toBe(false);
      expect(res.error).toContain("A maximum of 8 key minerals is allowed");
    });

    it("accepts a 40-character mineral name", () => {
      const exact40 = "A".repeat(40);
      const res = validateAndNormalizeNutrition({ key_minerals: [exact40] });
      expect(res.success).toBe(true);
      expect(res.key_minerals).toEqual([exact40]);
    });

    it("rejects a 41-character mineral name", () => {
      const exact41 = "A".repeat(41);
      const res = validateAndNormalizeNutrition({ key_minerals: [exact41] });
      expect(res.success).toBe(false);
      expect(res.error).toContain("Mineral must be at most 40 characters.");
    });
  });

  describe("Macro Grams Validation", () => {
    it("accepts boundary values 0 and 500", () => {
      const res = validateAndNormalizeNutrition({
        protein_g: 0,
        fat_g: 500,
        carbs_g: 250.5,
      });
      expect(res.success).toBe(true);
      expect(res.protein_g).toBe(0);
      expect(res.fat_g).toBe(500);
      expect(res.carbs_g).toBe(250.5);
    });

    it("rejects negative values and values exceeding 500", () => {
      expect(validateAndNormalizeNutrition({ protein_g: -0.1 }).success).toBe(false);
      expect(validateAndNormalizeNutrition({ protein_g: 500.1 }).success).toBe(false);
    });

    it("correctly handles omitted vs null vs empty string (never converts empty to 0)", () => {
      // Omitted => undefined (preserve existing stored value)
      const omitted = validateAndNormalizeNutrition({});
      expect(omitted.success).toBe(true);
      expect(omitted.protein_g).toBeUndefined();
      expect(omitted.fat_g).toBeUndefined();

      // Null => null (clear value)
      const cleared = validateAndNormalizeNutrition({ protein_g: null, fat_g: null });
      expect(cleared.success).toBe(true);
      expect(cleared.protein_g).toBeNull();
      expect(cleared.fat_g).toBeNull();

      // Empty string => null (never 0!)
      const emptyStr = validateAndNormalizeNutrition({ protein_g: "", carbs_g: "   " });
      expect(emptyStr.success).toBe(true);
      expect(emptyStr.protein_g).toBeNull();
      expect(emptyStr.carbs_g).toBeNull();
    });

    it("enforces soft sanity bound: 4P + 4C + 9F <= 7500", () => {
      // 4*500 + 4*500 + 9*500 = 2000 + 2000 + 4500 = 8500 > 7500
      const insane = validateAndNormalizeNutrition({
        protein_g: 500,
        carbs_g: 500,
        fat_g: 500,
      });
      expect(insane.success).toBe(false);
      expect(insane.error).toContain("exceed the maximum bound of 7,500 kcal");
    });
  });
});

describe("Healthy Score Calculation (healthy-score.ts)", () => {
  it("returns null if any required macro or calorie is missing or non-positive", () => {
    expect(calculateHealthyScore({ calories_kcal: 400 })).toBeNull();
    expect(
      calculateHealthyScore({
        calories_kcal: 400,
        protein_g: 20,
        fat_g: 10,
        carbs_g: 40,
        fibre_g: 5,
        sugar_g: 4,
        // sat_fat_g missing
      })
    ).toBeNull();

    expect(
      calculateHealthyScore({
        calories_kcal: 0,
        protein_g: 20,
        fat_g: 10,
        carbs_g: 40,
        fibre_g: 5,
        sugar_g: 4,
        sat_fat_g: 2,
      })
    ).toBeNull();
  });

  it("calculates accurate score and classifies into High, Medium, or Low band", () => {
    // High nutrient-dense bowl
    const healthyBowl = calculateHealthyScore({
      calories_kcal: 380,
      protein_g: 32, // (32/380)*100 = 8.42g/100kcal
      fat_g: 6,
      carbs_g: 42,
      fibre_g: 9, // 9/380 * 100 = 2.36g/100kcal
      sugar_g: 3, // 3/42 = 7%
      sat_fat_g: 1, // 1/6 = 16.6%
    });

    expect(healthyBowl).not.toBeNull();
    expect(healthyBowl?.score).toBeGreaterThanOrEqual(HEALTHY_SCORE_THRESHOLDS.highBandMin);
    expect(healthyBowl?.band).toBe("High");

    // Medium profile
    const mediumItem = calculateHealthyScore({
      calories_kcal: 450,
      protein_g: 14,
      fat_g: 15,
      carbs_g: 55,
      fibre_g: 3,
      sugar_g: 12,
      sat_fat_g: 6,
    });
    expect(mediumItem).not.toBeNull();
    expect(mediumItem?.band).toBe("Medium");

    // Low profile (high sugar, high sat fat, low protein)
    const junkItem = calculateHealthyScore({
      calories_kcal: 650,
      protein_g: 6,
      fat_g: 35,
      carbs_g: 80,
      fibre_g: 1,
      sugar_g: 45,
      sat_fat_g: 22,
    });
    expect(junkItem).not.toBeNull();
    expect(junkItem?.score).toBeLessThan(HEALTHY_SCORE_THRESHOLDS.mediumBandMin);
    expect(junkItem?.band).toBe("Low");
  });
});

describe("Macro Calorie Shares & Donut Chart Arcs (healthy-macros.ts)", () => {
  it("computes exact calorie percentages summing to 100%", () => {
    const shares = calculateMacroCalorieShares(25, 40, 10);
    // protein: 25*4 = 100 kcal
    // fat: 10*9 = 90 kcal
    // carbs: 40*4 = 160 kcal
    // total: 350 kcal
    expect(shares.proteinCalories).toBe(100);
    expect(shares.fatCalories).toBe(90);
    expect(shares.carbsCalories).toBe(160);
    expect(shares.totalMacroCalories).toBe(350);

    expect(shares.proteinPercent + shares.carbsPercent + shares.fatPercent).toBe(100);
  });

  it("handles zero values safely without division by zero", () => {
    const zeroShares = calculateMacroCalorieShares(0, 0, 0);
    expect(zeroShares.totalMacroCalories).toBe(0);
    expect(zeroShares.proteinPercent).toBe(0);
    expect(zeroShares.carbsPercent).toBe(0);
    expect(zeroShares.fatPercent).toBe(0);

    const arcs = calculateDonutArcs(0, 0, 0, 45);
    expect(arcs.proteinArc).toBe(0);
    expect(arcs.circumference).toBeCloseTo(2 * Math.PI * 45, 1);
  });

  it("calculates contiguous donut SVG arcs", () => {
    const shares = calculateMacroCalorieShares(30, 30, 10);
    const arcs = calculateDonutArcs(shares.proteinPercent, shares.carbsPercent, shares.fatPercent, 38);
    expect(arcs.proteinArc).toBeGreaterThan(0);
    expect(arcs.carbsArc).toBeGreaterThan(0);
    expect(arcs.fatArc).toBeGreaterThan(0);
  });
});

describe("Nutritional Insights Generator (healthy-macros.ts)", () => {
  it("produces neutral wording with no medical, disease, or allergen claims", () => {
    const dummyItem: MenuItemData = {
      id: "test-dish-1",
      canteen_id: "canteen-1",
      category_id: "cat-1",
      name: "Protein Bowl",
      description: "High protein meal",
      price_paise: 9500,
      image_url: null,
      is_veg: true,
      is_available: true,
      stock: 10,
      prep_minutes: 5,
      is_active: true,
      calories_kcal: 380,
      protein_g: 26,
      fibre_g: 7,
      sugar_g: 2,
      sat_fat_g: 1,
      key_minerals: ["Iron", "Magnesium"],
    };

    const insights = generateNutritionalInsights(dummyItem);
    expect(insights.highlights.length).toBeGreaterThanOrEqual(1);

    const allStatements = [...insights.highlights, ...insights.considerations];
    for (const statement of allStatements) {
      // Must not contain forbidden medical, diet or ai generated claims
      const lower = statement.toLowerCase();
      expect(lower).not.toContain("cure");
      expect(lower).not.toContain("prevent");
      expect(lower).not.toContain("disease");
      expect(lower).not.toContain("allergen");
      expect(lower).not.toContain("ai generated");
    }
  });
});

describe("Healthy Dish Suggestions (healthy-suggestions.ts)", () => {
  const dummyItems: MenuItemData[] = [
    {
      id: "dish-1",
      canteen_id: "canteen-1",
      category_id: "cat-1",
      name: "Tofu Rice Bowl",
      description: "Tofu with rice",
      price_paise: 9000,
      image_url: null,
      is_veg: true,
      is_available: true,
      stock: 10,
      prep_minutes: 5,
      is_active: true,
      calories_kcal: 410,
      protein_g: 31,
    },
    {
      id: "dish-2",
      canteen_id: "canteen-1",
      category_id: "cat-1",
      name: "Paneer Biryani",
      description: "Fragrant paneer biryani",
      price_paise: 12000,
      image_url: null,
      is_veg: true,
      is_available: true,
      stock: 10,
      prep_minutes: 8,
      is_active: true,
      calories_kcal: 550,
      protein_g: 22,
    },
    {
      id: "dish-inactive",
      canteen_id: "canteen-1",
      category_id: "cat-1",
      name: "Inactive Dish",
      description: "Not active",
      price_paise: 5000,
      image_url: null,
      is_veg: true,
      is_available: true,
      stock: 10,
      prep_minutes: 5,
      is_active: false,
      calories_kcal: 400,
      protein_g: 30,
    },
    {
      id: "dish-no-protein",
      canteen_id: "canteen-1",
      category_id: "cat-1",
      name: "Chips",
      description: "Potato chips",
      price_paise: 3000,
      image_url: null,
      is_veg: true,
      is_available: true,
      stock: 10,
      prep_minutes: 1,
      is_active: true,
      calories_kcal: 400,
      protein_g: null,
    },
  ];

  it("filters only active, available items with both calories and protein", () => {
    const suggestions = suggestHealthyDishes(dummyItems, {
      targetCalories: 400,
      targetProtein: 30,
      tolerance: 0.2,
    });

    // Inactive and no-protein items excluded
    const ids = suggestions.map((s) => s.item.id);
    expect(ids).not.toContain("dish-inactive");
    expect(ids).not.toContain("dish-no-protein");

    // dish-1 matches target (410 kcal is within 20% of 400, 31g protein is within 20% of 30)
    expect(ids).toContain("dish-1");
  });

  it("generates a neutral whyItMatches explanation", () => {
    const suggestions = suggestHealthyDishes(dummyItems, {
      targetCalories: 400,
      targetProtein: 30,
      tolerance: 0.2,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].whyItMatches).toContain("protein target");
    expect(suggestions[0].whyItMatches).toContain("kcal");
  });

  it("widens search with tolerance 0.35 when strict search yields nothing", () => {
    // 550 kcal is 37.5% higher than 400 kcal, 22g protein is 26.6% lower than 30g
    // So with target 400/30 and tolerance 0.10, neither dish matches:
    const strict = suggestHealthyDishes(dummyItems, {
      targetCalories: 700,
      targetProtein: 45,
      tolerance: 0.1,
    });
    expect(strict.length).toBe(0);

    // But with target 550/22 and tolerance 0.10, dish-2 matches:
    const matched = suggestHealthyDishes(dummyItems, {
      targetCalories: 550,
      targetProtein: 22,
      tolerance: 0.1,
    });
    expect(matched.length).toBe(1);
    expect(matched[0].item.id).toBe("dish-2");
  });
});
