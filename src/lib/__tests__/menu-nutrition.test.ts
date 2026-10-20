import { describe, it, expect } from "vitest";
import {
  sanitizeNutritionString,
  normalizeIngredientsList,
  validateAndNormalizeNutrition,
} from "@/lib/menu-nutrition";

describe("sanitizeNutritionString", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeNutritionString("  Fresh   Curry   Leaves  ")).toBe("Fresh Curry Leaves");
  });

  it("strips invisible, zero-width and bidi characters", () => {
    // U+200B (zero-width space), U+202E (right-to-left override), U+FEFF (BOM)
    const tainted = "\u200BFresh\u202E Basmati \uFEFFRice";
    expect(sanitizeNutritionString(tainted)).toBe("Fresh Basmati Rice");
  });

  it("strips control characters", () => {
    const tainted = "Sugar\x00\x07\x1F Syrup";
    expect(sanitizeNutritionString(tainted)).toBe("Sugar Syrup");
  });
});

describe("normalizeIngredientsList", () => {
  it("drops empty or whitespace-only items", () => {
    const raw = ["Tomatoes", "   ", "", "\u200B", "Onions"];
    expect(normalizeIngredientsList(raw)).toEqual(["Tomatoes", "Onions"]);
  });

  it("deduplicates case-insensitively, keeping first occurrence casing", () => {
    const raw = ["Potatoes", "potatoes", "POTATOES", "Ginger"];
    expect(normalizeIngredientsList(raw)).toEqual(["Potatoes", "Ginger"]);
  });
});

describe("validateAndNormalizeNutrition - Calories", () => {
  it("accepts valid whole number boundaries (0 and 5000)", () => {
    expect(validateAndNormalizeNutrition({ calories_kcal: 0 })).toEqual({
      success: true,
      calories_kcal: 0,
      ingredients: undefined,
    });

    expect(validateAndNormalizeNutrition({ calories_kcal: 5000 })).toEqual({
      success: true,
      calories_kcal: 5000,
      ingredients: undefined,
    });
  });

  it("accepts string representation of numbers", () => {
    expect(validateAndNormalizeNutrition({ calories_kcal: " 350 " })).toEqual({
      success: true,
      calories_kcal: 350,
      ingredients: undefined,
    });
  });

  it("handles undefined (omitted) vs null / empty string (cleared)", () => {
    // Omitted => calories_kcal is undefined (do not wipe stored value)
    expect(validateAndNormalizeNutrition({})).toEqual({
      success: true,
      calories_kcal: undefined,
      ingredients: undefined,
    });

    // Explicit null => calories_kcal is null (clears stored value)
    expect(validateAndNormalizeNutrition({ calories_kcal: null })).toEqual({
      success: true,
      calories_kcal: null,
      ingredients: undefined,
    });

    // Empty string => calories_kcal is null (clears stored value)
    expect(validateAndNormalizeNutrition({ calories_kcal: "" })).toEqual({
      success: true,
      calories_kcal: null,
      ingredients: undefined,
    });
  });

  it("rejects negative calories", () => {
    const res = validateAndNormalizeNutrition({ calories_kcal: -1 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Calories must be a whole number between 0 and 5,000 kcal.");
  });

  it("rejects calories > 5000", () => {
    const res = validateAndNormalizeNutrition({ calories_kcal: 5001 });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Calories must be a whole number between 0 and 5,000 kcal.");
  });

  it("rejects non-integer calories", () => {
    const res = validateAndNormalizeNutrition({ calories_kcal: 250.5 });
    expect(res.success).toBe(false);
  });
});

describe("validateAndNormalizeNutrition - Ingredients", () => {
  it("handles undefined (omitted) vs empty array (cleared)", () => {
    // Omitted => ingredients is undefined (do not wipe stored value)
    expect(validateAndNormalizeNutrition({})).toEqual({
      success: true,
      calories_kcal: undefined,
      ingredients: undefined,
    });

    // Explicit empty list => ingredients is [] (clears stored value)
    expect(validateAndNormalizeNutrition({ ingredients: [] })).toEqual({
      success: true,
      calories_kcal: undefined,
      ingredients: [],
    });
  });

  it("accepts exactly 30 valid ingredients", () => {
    const thirtyItems = Array.from({ length: 30 }, (_, i) => `Ingredient ${i + 1}`);
    const res = validateAndNormalizeNutrition({ ingredients: thirtyItems });
    expect(res.success).toBe(true);
    expect(res.ingredients?.length).toBe(30);
  });

  it("rejects 31 distinct ingredients", () => {
    const thirtyOneItems = Array.from({ length: 31 }, (_, i) => `Ingredient ${i + 1}`);
    const res = validateAndNormalizeNutrition({ ingredients: thirtyOneItems });
    expect(res.success).toBe(false);
    expect(res.error).toContain("A maximum of 30 ingredients is allowed.");
  });

  it("accepts a 60-character ingredient", () => {
    const exactly60 = "a".repeat(60);
    const res = validateAndNormalizeNutrition({ ingredients: [exactly60] });
    expect(res.success).toBe(true);
    expect(res.ingredients).toEqual([exactly60]);
  });

  it("rejects a 61-character ingredient", () => {
    const exactly61 = "a".repeat(61);
    const res = validateAndNormalizeNutrition({ ingredients: [exactly61] });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Ingredient must be at most 60 characters.");
  });
});
