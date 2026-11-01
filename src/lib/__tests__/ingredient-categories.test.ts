import { describe, it, expect } from "vitest";
import {
  categorizeIngredient,
  getPresentCategories,
  calculateGridRovingIndex,
  CATEGORY_PRIORITY,
} from "@/lib/ingredient-categories";

describe("Ingredient Categorizer - Last Noun First & Precedence", () => {
  it("categorises by the last matching noun/term in compound names", () => {
    // "butter roti" -> "roti" is last (grain)
    expect(categorizeIngredient("Butter roti").category).toBe("grain");
    // "butter chicken" -> "chicken" is last (protein)
    expect(categorizeIngredient("Butter chicken").category).toBe("protein");
    // "garlic naan" -> "naan" is last (grain)
    expect(categorizeIngredient("Garlic naan").category).toBe("grain");
    // "chilli paneer" -> "paneer" is last (protein)
    expect(categorizeIngredient("Chilli paneer").category).toBe("protein");
    // "peanut butter" -> "butter" is last (dairy)
    expect(categorizeIngredient("Peanut butter").category).toBe("dairy");
    // "coconut chutney" -> "chutney" is last (sauce_spice)
    expect(categorizeIngredient("Coconut chutney").category).toBe("sauce_spice");
    // "tomato rice" -> "rice" is last (grain)
    expect(categorizeIngredient("Tomato rice").category).toBe("grain");
    // "lemon rice" -> "rice" is last (grain)
    expect(categorizeIngredient("Lemon rice").category).toBe("grain");
  });

  it("falls back to priority order (protein > dairy > vegetable > grain > sauce_spice) when matching tied positions", () => {
    // A single compound concept or tie:
    const eggMilk = categorizeIngredient("Egg Milk");
    // "Milk" is last -> dairy
    expect(eggMilk.category).toBe("dairy");

    // Single words follow canonical priority when checked individually
    expect(CATEGORY_PRIORITY).toEqual([
      "protein",
      "dairy",
      "vegetable",
      "grain",
      "sauce_spice",
      "other",
    ]);
  });
});

describe("Ingredient Categorizer - Canteen Terms & Menu Items", () => {
  it("classifies grains and Indian staples correctly", () => {
    expect(categorizeIngredient("maida").category).toBe("grain");
    expect(categorizeIngredient("flattened rice").category).toBe("grain");
    expect(categorizeIngredient("poha").category).toBe("grain");
    expect(categorizeIngredient("papad").category).toBe("grain");
    expect(categorizeIngredient("dosa batter").category).toBe("grain");
    expect(categorizeIngredient("semolina / suji").category).toBe("grain");
    expect(categorizeIngredient("paratha").category).toBe("grain");
    expect(categorizeIngredient("chapati").category).toBe("grain");
    expect(categorizeIngredient("pav").category).toBe("grain");
  });

  it("classifies protein items correctly, with dal strictly as protein", () => {
    expect(categorizeIngredient("dal").category).toBe("protein");
    expect(categorizeIngredient("chana dal").category).toBe("protein");
    expect(categorizeIngredient("urad dal").category).toBe("protein");
    expect(categorizeIngredient("moong dal").category).toBe("protein");
    expect(categorizeIngredient("peanuts").category).toBe("protein");
    expect(categorizeIngredient("cashew").category).toBe("protein");
    expect(categorizeIngredient("paneer").category).toBe("protein");
    expect(categorizeIngredient("chicken").category).toBe("protein");
    expect(categorizeIngredient("egg").category).toBe("protein");
    expect(categorizeIngredient("chana").category).toBe("protein");
    expect(categorizeIngredient("rajma").category).toBe("protein");
  });

  it("classifies dairy items correctly", () => {
    expect(categorizeIngredient("milk").category).toBe("dairy");
    expect(categorizeIngredient("curd").category).toBe("dairy");
    expect(categorizeIngredient("ghee").category).toBe("dairy");
    expect(categorizeIngredient("butter").category).toBe("dairy");
    expect(categorizeIngredient("cheese").category).toBe("dairy");
    expect(categorizeIngredient("cream").category).toBe("dairy");
  });

  it("classifies vegetables and produce correctly", () => {
    expect(categorizeIngredient("coconut").category).toBe("vegetable");
    expect(categorizeIngredient("onion").category).toBe("vegetable");
    expect(categorizeIngredient("tomato").category).toBe("vegetable");
    expect(categorizeIngredient("potato").category).toBe("vegetable");
    expect(categorizeIngredient("capsicum").category).toBe("vegetable");
    expect(categorizeIngredient("spinach").category).toBe("vegetable");
    expect(categorizeIngredient("ginger").category).toBe("vegetable");
    expect(categorizeIngredient("garlic").category).toBe("vegetable");
    expect(categorizeIngredient("coriander").category).toBe("vegetable");
  });

  it("classifies sauces, spices, condiments, and oils correctly", () => {
    // Mayonnaise is strictly sauce, not dairy
    expect(categorizeIngredient("mayonnaise").category).toBe("sauce_spice");
    expect(categorizeIngredient("mayo").category).toBe("sauce_spice");
    expect(categorizeIngredient("sambar").category).toBe("sauce_spice");
    expect(categorizeIngredient("podi").category).toBe("sauce_spice");
    expect(categorizeIngredient("pickle").category).toBe("sauce_spice");
    expect(categorizeIngredient("oil").category).toBe("sauce_spice");
    expect(categorizeIngredient("black salt").category).toBe("sauce_spice");
    expect(categorizeIngredient("cumin").category).toBe("sauce_spice");
    expect(categorizeIngredient("cardamom").category).toBe("sauce_spice");
    expect(categorizeIngredient("tea").category).toBe("sauce_spice");
    expect(categorizeIngredient("coffee").category).toBe("sauce_spice");
    expect(categorizeIngredient("chicory").category).toBe("sauce_spice");
    expect(categorizeIngredient("chutney").category).toBe("sauce_spice");
    expect(categorizeIngredient("garam masala").category).toBe("sauce_spice");
  });
});

describe("Ingredient Categorizer - Robustness & Text Processing", () => {
  it("ignores bracket text for matching while retaining original label", () => {
    const res1 = categorizeIngredient("Chicken (boneless, diced)");
    expect(res1.category).toBe("protein");
    expect(res1.label).toBe("Chicken (boneless, diced)");

    const res2 = categorizeIngredient("Wheat Flour [organic]");
    expect(res2.category).toBe("grain");
    expect(res2.label).toBe("Wheat Flour [organic]");

    const res3 = categorizeIngredient("Roti (contains gluten)");
    expect(res3.category).toBe("grain");
    expect(res3.label).toBe("Roti (contains gluten)");
  });

  it("handles simple plurals cleanly", () => {
    expect(categorizeIngredient("egg").category).toBe("protein");
    expect(categorizeIngredient("eggs").category).toBe("protein");
    expect(categorizeIngredient("peanut").category).toBe("protein");
    expect(categorizeIngredient("peanuts").category).toBe("protein");
    expect(categorizeIngredient("noodle").category).toBe("grain");
    expect(categorizeIngredient("noodles").category).toBe("grain");
    expect(categorizeIngredient("tomato").category).toBe("vegetable");
    expect(categorizeIngredient("tomatoes").category).toBe("vegetable");
    expect(categorizeIngredient("spice").category).toBe("sauce_spice");
    expect(categorizeIngredient("spices").category).toBe("sauce_spice");
  });

  it("enforces whole-word matching to avoid partial substring mismatches", () => {
    // "ricebran" should not match "rice"
    expect(categorizeIngredient("ricebran oil").category).toBe("sauce_spice"); // matches oil
    expect(categorizeIngredient("ricebran").category).toBe("other");
    // "chickpea" is matched as a whole word (protein), not "pea" (vegetable)
    expect(categorizeIngredient("chickpea").category).toBe("protein");
  });

  it("is case-insensitive", () => {
    expect(categorizeIngredient("CHICKEN").category).toBe("protein");
    expect(categorizeIngredient("pAnEeR").category).toBe("protein");
    expect(categorizeIngredient("FLATTENED RICE").category).toBe("grain");
  });

  it("safely handles odd or null inputs without throwing", () => {
    expect(categorizeIngredient(null)).toEqual({ category: "other", label: "" });
    expect(categorizeIngredient(undefined)).toEqual({ category: "other", label: "" });
    expect(categorizeIngredient("")).toEqual({ category: "other", label: "" });
    expect(categorizeIngredient("    ")).toEqual({ category: "other", label: "" });
    expect(categorizeIngredient(12345)).toEqual({ category: "other", label: "12345" });
    expect(categorizeIngredient("!@#$%^&*()_+")).toEqual({
      category: "other",
      label: "!@#$%^&*()_+",
    });
    expect(categorizeIngredient("mystery item xyz")).toEqual({
      category: "other",
      label: "mystery item xyz",
    });
  });
});

describe("Legend Builder - getPresentCategories", () => {
  it("returns only unique categories present in the dish, in canonical priority order", () => {
    const ingredients = [
      "Basmati Rice",
      "Chicken",
      "Ghee",
      "Onion",
      "Garam Masala",
    ];

    const present = getPresentCategories(ingredients);
    const presentIds = present.map((p) => p.id);

    // Should contain protein, dairy, vegetable, grain, sauce_spice
    expect(presentIds).toEqual([
      "protein",
      "dairy",
      "vegetable",
      "grain",
      "sauce_spice",
    ]);
  });

  it("omits absent categories", () => {
    const ingredients = ["Basmati Rice", "Wheat Flour"];
    const present = getPresentCategories(ingredients);
    expect(present.map((p) => p.id)).toEqual(["grain"]);
  });

  it("returns empty array for empty or invalid ingredients", () => {
    expect(getPresentCategories([])).toEqual([]);
    // @ts-expect-error testing invalid type
    expect(getPresentCategories(null)).toEqual([]);
  });
});

describe("Grid Roving Tabindex - calculateGridRovingIndex", () => {
  const total = 5;
  const cols = 2;

  it("moves right with wrap-around", () => {
    expect(calculateGridRovingIndex(0, total, cols, "ArrowRight")).toBe(1);
    expect(calculateGridRovingIndex(4, total, cols, "ArrowRight")).toBe(0);
  });

  it("moves left with wrap-around", () => {
    expect(calculateGridRovingIndex(1, total, cols, "ArrowLeft")).toBe(0);
    expect(calculateGridRovingIndex(0, total, cols, "ArrowLeft")).toBe(4);
  });

  it("moves down clamped to total items", () => {
    expect(calculateGridRovingIndex(0, total, cols, "ArrowDown")).toBe(2);
    expect(calculateGridRovingIndex(1, total, cols, "ArrowDown")).toBe(3);
    expect(calculateGridRovingIndex(4, total, cols, "ArrowDown")).toBe(4); // clamped
  });

  it("moves up clamped to 0", () => {
    expect(calculateGridRovingIndex(3, total, cols, "ArrowUp")).toBe(1);
    expect(calculateGridRovingIndex(1, total, cols, "ArrowUp")).toBe(1); // clamped
  });

  it("jumps to first with Home and last with End", () => {
    expect(calculateGridRovingIndex(3, total, cols, "Home")).toBe(0);
    expect(calculateGridRovingIndex(1, total, cols, "End")).toBe(4);
  });
});
