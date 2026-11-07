import { describe, it, expect } from "vitest";
import {
  suggestHealthyDishes,
  DEFAULT_HEALTHY_PREFERENCES,
} from "@/lib/healthy-suggestions";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

const sampleDishes: MenuItemData[] = [
  {
    id: "dish-high-protein",
    canteen_id: "test-canteen",
    category_id: null,
    description: null,
    image_url: null,
    name: "Grilled Chicken Breast",
    price_paise: 18000,
    is_veg: false,
    is_available: true,
    is_active: true,
    stock: 10,
    calories_kcal: 450,
    protein_g: 38,
    prep_minutes: 12,
  },
  {
    id: "dish-rajma",
    canteen_id: "test-canteen",
    category_id: null,
    description: null,
    image_url: null,
    name: "Rajma Chawal Bowl",
    price_paise: 7000,
    is_veg: true,
    is_available: true,
    is_active: true,
    stock: 15,
    calories_kcal: 550,
    protein_g: 20,
    prep_minutes: 5,
  },
  {
    id: "dish-egg-rice",
    canteen_id: "test-canteen",
    category_id: null,
    description: null,
    image_url: null,
    name: "Egg Fried Rice",
    price_paise: 8500,
    is_veg: false,
    is_available: true,
    is_active: true,
    stock: 8,
    calories_kcal: 480,
    protein_g: 22,
    prep_minutes: 8,
  },
];

describe("Healthy Preferences & Suggestions Contract", () => {
  it("has valid default preferences within slider bounds (200..800 kcal, 10..60g)", () => {
    expect(DEFAULT_HEALTHY_PREFERENCES.targetCalories).toBeGreaterThanOrEqual(200);
    expect(DEFAULT_HEALTHY_PREFERENCES.targetCalories).toBeLessThanOrEqual(800);
    expect(DEFAULT_HEALTHY_PREFERENCES.targetProtein).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_HEALTHY_PREFERENCES.targetProtein).toBeLessThanOrEqual(60);
  });

  it("finds matching dishes when target protein is 20g and calories is 500 kcal", () => {
    const matches = suggestHealthyDishes(sampleDishes, {
      targetCalories: 500,
      targetProtein: 20,
      tolerance: 0.2,
    });

    expect(matches.length).toBeGreaterThan(0);
    const matchedIds = matches.map((m) => m.item.id);
    expect(matchedIds).toContain("dish-rajma");
    expect(matchedIds).toContain("dish-egg-rice");
  });

  it("correctly marks close matches and best fits based on target fit score", () => {
    const matches = suggestHealthyDishes(sampleDishes, {
      targetCalories: 450,
      targetProtein: 38,
      tolerance: 0.2,
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].item.id).toBe("dish-high-protein");
    expect(matches[0].isCloseMatch).toBe(true); // Within 20% bounds
  });
});
