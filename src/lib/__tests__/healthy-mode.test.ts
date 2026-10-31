import { describe, it, expect } from "vitest";
import {
  HEALTHY_FOOD_ITEMS,
  calculateMacroPercentages,
  type MacroBreakdown,
} from "@/lib/healthy-mode-data";

describe("Healthy Mode & High-Protein Data", () => {
  describe("calculateMacroPercentages", () => {
    it("accurately calculates macro calorie percentages using Atwater factors", () => {
      // 25g protein (100 kcal), 25g carbs (100 kcal), 0g fat (0 kcal) -> total 200 kcal -> 50% protein, 50% carbs, 0% fat
      const macros: MacroBreakdown = {
        protein_g: 25,
        carbs_g: 25,
        fats_g: 0,
        fiber_g: 5,
        calories_kcal: 200,
      };

      const result = calculateMacroPercentages(macros);
      expect(result.proteinPercent).toBe(50);
      expect(result.carbsPercent).toBe(50);
      expect(result.fatsPercent).toBe(0);
    });

    it("ensures total percentages sum to 100", () => {
      const macros: MacroBreakdown = {
        protein_g: 28,
        carbs_g: 34,
        fats_g: 9,
        fiber_g: 4,
        calories_kcal: 380,
      };

      const { proteinPercent, carbsPercent, fatsPercent } = calculateMacroPercentages(macros);
      expect(proteinPercent + carbsPercent + fatsPercent).toBe(100);
    });

    it("handles zero macros gracefully without division by zero", () => {
      const macros: MacroBreakdown = {
        protein_g: 0,
        carbs_g: 0,
        fats_g: 0,
        fiber_g: 0,
        calories_kcal: 0,
      };

      const result = calculateMacroPercentages(macros);
      expect(result.proteinPercent).toBe(0);
      expect(result.carbsPercent).toBe(0);
      expect(result.fatsPercent).toBe(100);
    });
  });

  describe("HEALTHY_FOOD_ITEMS catalog", () => {
    it("contains at least 8 nutritious campus items", () => {
      expect(HEALTHY_FOOD_ITEMS.length).toBeGreaterThanOrEqual(8);
    });

    it("verifies every item contains complete macronutrient information", () => {
      HEALTHY_FOOD_ITEMS.forEach((item) => {
        expect(item.id).toBeTruthy();
        expect(item.name).toBeTruthy();
        expect(item.price_paise).toBeGreaterThan(0);
        expect(item.macros.protein_g).toBeGreaterThan(0);
        expect(item.macros.carbs_g).toBeGreaterThan(0);
        expect(item.macros.calories_kcal).toBeGreaterThan(0);
        expect(item.dietaryBadges.length).toBeGreaterThan(0);
      });
    });

    it("verifies every item includes essential minerals with daily value percentages", () => {
      HEALTHY_FOOD_ITEMS.forEach((item) => {
        expect(item.minerals.length).toBeGreaterThanOrEqual(3);
        item.minerals.forEach((mineral) => {
          expect(mineral.name).toBeTruthy();
          expect(mineral.amount).toBeTruthy();
          expect(mineral.dailyValuePercent).toBeGreaterThan(0);
        });
      });
    });

    it("verifies every item includes extracted ingredients with functional health benefits", () => {
      HEALTHY_FOOD_ITEMS.forEach((item) => {
        expect(item.extractedIngredients.length).toBeGreaterThanOrEqual(3);
        item.extractedIngredients.forEach((ing) => {
          expect(ing.name).toBeTruthy();
          expect(ing.benefit).toBeTruthy();
          expect(ing.benefit.length).toBeGreaterThan(15);
        });
      });
    });

    it("includes high-protein staples (soya, paneer, chicken, egg, rajma, sprouts)", () => {
      const itemNames = HEALTHY_FOOD_ITEMS.map((i) => i.name.toLowerCase());
      expect(itemNames.some((n) => n.includes("soya"))).toBe(true);
      expect(itemNames.some((n) => n.includes("paneer"))).toBe(true);
      expect(itemNames.some((n) => n.includes("chicken"))).toBe(true);
      expect(itemNames.some((n) => n.includes("egg"))).toBe(true);
      expect(itemNames.some((n) => n.includes("rajma"))).toBe(true);
      expect(itemNames.some((n) => n.includes("sprout"))).toBe(true);
    });
  });
});

