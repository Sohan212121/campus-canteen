import { describe, it, expect } from "vitest";
import {
  getRealMenuNutrition,
  enrichAndFilterProteinMenuItems,
} from "@/lib/real-menu-nutrition";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

describe("Real Menu Nutrition & Protein Filtering", () => {
  describe("getRealMenuNutrition", () => {
    it("identifies high-protein dishes accurately", () => {
      const chicken = getRealMenuNutrition("Chicken Kathi Roll");
      expect(chicken).not.toBeNull();
      expect(chicken?.protein_g).toBe(28);
      expect(chicken?.is_protein).toBe(true);

      const paneer = getRealMenuNutrition("Paneer Kathi Roll");
      expect(paneer).not.toBeNull();
      expect(paneer?.protein_g).toBe(24);
      expect(paneer?.is_protein).toBe(true);

      const thali = getRealMenuNutrition("Special Deluxe Thali");
      expect(thali).not.toBeNull();
      expect(thali?.protein_g).toBe(26);
      expect(thali?.is_protein).toBe(true);

      const eggs = getRealMenuNutrition("Egg Fried Rice");
      expect(eggs).not.toBeNull();
      expect(eggs?.protein_g).toBe(22);
      expect(eggs?.is_protein).toBe(true);

      const rajma = getRealMenuNutrition("Rajma Chawal Bowl");
      expect(rajma).not.toBeNull();
      expect(rajma?.protein_g).toBe(18);
      expect(rajma?.is_protein).toBe(true);

      const lassi = getRealMenuNutrition("Sweet Punjabi Lassi");
      expect(lassi).not.toBeNull();
      expect(lassi?.protein_g).toBe(12);
      expect(lassi?.is_protein).toBe(true);
    });

    it("identifies non-protein items and marks them is_protein = false", () => {
      const chai = getRealMenuNutrition("Masala Chai");
      expect(chai).not.toBeNull();
      expect(chai?.is_protein).toBe(false);

      const samosa = getRealMenuNutrition("Samosa (2 pcs)");
      expect(samosa).not.toBeNull();
      expect(samosa?.is_protein).toBe(false);

      const vadaPav = getRealMenuNutrition("Vada Pav");
      expect(vadaPav).not.toBeNull();
      expect(vadaPav?.is_protein).toBe(false);

      const nimbuPani = getRealMenuNutrition("Fresh Nimbu Pani");
      expect(nimbuPani).not.toBeNull();
      expect(nimbuPani?.is_protein).toBe(false);

      const plainDosa = getRealMenuNutrition("Plain Dosa");
      expect(plainDosa).not.toBeNull();
      expect(plainDosa?.is_protein).toBe(false);

      const vegPuff = getRealMenuNutrition("Veg Puff");
      expect(vegPuff).not.toBeNull();
      expect(vegPuff?.is_protein).toBe(false);
    });
  });

  describe("enrichAndFilterProteinMenuItems", () => {
    const sampleDbItems: MenuItemData[] = [
      {
        id: "real-uuid-chicken",
        canteen_id: "canteen-1",
        category_id: "cat-fastfood",
        name: "Chicken Kathi Roll",
        description: "Crisp paratha rolled with seasoned shredded chicken",
        price_paise: 9500,
        image_url: null,
        is_veg: false,
        is_available: true,
        stock: 15,
        prep_minutes: 9,
        is_active: true,
        rating_avg: 4.8,
        rating_count: 10,
        calories_kcal: null,
        ingredients: [],
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        fibre_g: null,
        sugar_g: null,
        sat_fat_g: null,
        key_minerals: [],
      },
      {
        id: "real-uuid-samosa",
        canteen_id: "canteen-1",
        category_id: "cat-snacks",
        name: "Samosa (2 pcs)",
        description: "Crisp golden pastry filled with spiced potatoes",
        price_paise: 3000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 50,
        prep_minutes: 3,
        is_active: true,
        rating_avg: 4.2,
        rating_count: 20,
        calories_kcal: null,
        ingredients: [],
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        fibre_g: null,
        sugar_g: null,
        sat_fat_g: null,
        key_minerals: [],
      },
      {
        id: "real-uuid-chai",
        canteen_id: "canteen-1",
        category_id: "cat-beverages",
        name: "Masala Chai",
        description: "Strong Indian tea infused with cardamom and ginger",
        price_paise: 1500,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 100,
        prep_minutes: 2,
        is_active: true,
        rating_avg: 4.9,
        rating_count: 50,
        calories_kcal: null,
        ingredients: [],
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        fibre_g: null,
        sugar_g: null,
        sat_fat_g: null,
        key_minerals: [],
      },
      {
        id: "real-uuid-paneer-out-of-stock",
        canteen_id: "canteen-1",
        category_id: "cat-fastfood",
        name: "Paneer Kathi Roll",
        description: "Flaky paratha wrap stuffed with marinated tandoori paneer cubes",
        price_paise: 8000,
        image_url: null,
        is_veg: true,
        is_available: false, // OUT OF STOCK
        stock: 0,
        prep_minutes: 8,
        is_active: true,
        rating_avg: 4.6,
        rating_count: 15,
        calories_kcal: null,
        ingredients: [],
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        fibre_g: null,
        sugar_g: null,
        sat_fat_g: null,
        key_minerals: [],
      },
      {
        id: "real-uuid-paneer-active",
        canteen_id: "canteen-1",
        category_id: "cat-fastfood",
        name: "Paneer Kathi Roll",
        description: "Flaky paratha wrap stuffed with marinated tandoori paneer cubes",
        price_paise: 8000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 20,
        prep_minutes: 8,
        is_active: true,
        rating_avg: 4.6,
        rating_count: 15,
        calories_kcal: null,
        ingredients: [],
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        fibre_g: null,
        sugar_g: null,
        sat_fat_g: null,
        key_minerals: [],
      },
    ];

    it("filters out non-protein items and unavailable items", () => {
      const result = enrichAndFilterProteinMenuItems(sampleDbItems);
      const names = result.map((r) => r.name);

      // Should include available protein items
      expect(names).toContain("Chicken Kathi Roll");
      expect(names).toContain("Paneer Kathi Roll");

      // Should NOT include non-protein items
      expect(names).not.toContain("Samosa (2 pcs)");
      expect(names).not.toContain("Masala Chai");

      // Should NOT include out-of-stock items
      expect(result.some((r) => r.id === "real-uuid-paneer-out-of-stock")).toBe(false);
    });

    it("preserves authentic database UUID so Cart, Checkout and Orders work properly", () => {
      const result = enrichAndFilterProteinMenuItems(sampleDbItems);
      const chicken = result.find((r) => r.name === "Chicken Kathi Roll");
      expect(chicken?.id).toBe("real-uuid-chicken");
      expect(chicken?.price_paise).toBe(9500);
    });

    it("enriches items with verified macronutrient content and minerals", () => {
      const result = enrichAndFilterProteinMenuItems(sampleDbItems);
      const chicken = result.find((r) => r.name === "Chicken Kathi Roll");
      expect(chicken?.protein_g).toBe(28);
      expect(chicken?.calories_kcal).toBe(380);
      expect(chicken?.carbs_g).toBe(34);
      expect(chicken?.fat_g).toBe(9);
      expect(chicken?.key_minerals).toContain("Iron");
      expect(chicken?.key_minerals).toContain("Zinc");
    });
  });
});
