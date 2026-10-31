"use client";

import { FlaskConical } from "lucide-react";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthySampleToggleProps {
  useSampleData: boolean;
  onToggle: (next: boolean) => void;
}

/**
 * Development-only preview toggle compiled out of production builds.
 * Never writes to the database.
 */
export function HealthySampleToggle({
  useSampleData,
  onToggle,
}: HealthySampleToggleProps) {
  // Completely eliminated in production builds
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl border border-dashed border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs">
      <div className="flex items-center gap-1.5 font-semibold">
        <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span>Dev Preview: Sample data</span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={useSampleData}
        onClick={() => onToggle(!useSampleData)}
        className={`min-h-[32px] px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
          useSampleData
            ? "bg-amber-600 text-white shadow-xs"
            : "bg-card border border-amber-500/30 text-amber-800 dark:text-amber-300"
        }`}
      >
        {useSampleData ? "Sample Data ON" : "Real DB Data"}
      </button>
    </div>
  );
}

/**
 * Sample items with nutrition and macros for dev preview.
 */
export const SAMPLE_HEALTHY_ITEMS: MenuItemData[] = [
  {
    id: "sample-soya-bowl",
    canteen_id: "canteen-1",
    category_id: "cat-healthy",
    name: "Soya Chunk Protein Bowl",
    description: "High-protein defatted soya chunks cooked with fragrant brown basmati and fresh mint.",
    price_paise: 7500,
    image_url: null,
    is_veg: true,
    is_available: true,
    stock: 25,
    prep_minutes: 6,
    is_active: true,
    rating_avg: 4.8,
    rating_count: 12,
    calories_kcal: 360,
    ingredients: ["Soya chunks", "Brown basmati rice", "Mint", "Onions", "Cumin", "Ginger", "Garlic"],
    protein_g: 32.0,
    fat_g: 4.0,
    carbs_g: 42.0,
    fibre_g: 8.0,
    sugar_g: 2.5,
    sat_fat_g: 0.6,
    key_minerals: ["Iron", "Magnesium", "Folate", "Copper"],
  },
  {
    id: "sample-paneer-wrap",
    canteen_id: "canteen-1",
    category_id: "cat-healthy",
    name: "Paneer Tikka Protein Wrap",
    description: "Tandoori grilled cottage cheese paneer wrapped in whole wheat roti with mint spread.",
    price_paise: 8000,
    image_url: null,
    is_veg: true,
    is_available: true,
    stock: 20,
    prep_minutes: 8,
    is_active: true,
    rating_avg: 4.7,
    rating_count: 19,
    calories_kcal: 350,
    ingredients: ["Paneer", "Whole wheat roti", "Bell peppers", "Yogurt", "Mint", "Lemon"],
    protein_g: 24.0,
    fat_g: 12.0,
    carbs_g: 28.0,
    fibre_g: 6.0,
    sugar_g: 3.0,
    sat_fat_g: 4.5,
    key_minerals: ["Calcium", "Phosphorus", "Magnesium", "Vitamin A"],
  },
  {
    id: "sample-chicken-wrap",
    canteen_id: "canteen-1",
    category_id: "cat-healthy",
    name: "Chicken Kathi Roll (High Protein)",
    description: "Lean chicken breast cooked in roasted spices and wrapped in whole wheat flatbread.",
    price_paise: 9500,
    image_url: null,
    is_veg: false,
    is_available: true,
    stock: 15,
    prep_minutes: 9,
    is_active: true,
    rating_avg: 4.9,
    rating_count: 31,
    calories_kcal: 380,
    ingredients: ["Chicken breast", "Whole wheat flour", "Onions", "Green chutney", "Spices"],
    protein_g: 28.0,
    fat_g: 9.0,
    carbs_g: 34.0,
    fibre_g: 4.0,
    sugar_g: 2.0,
    sat_fat_g: 2.2,
    key_minerals: ["Iron", "Zinc", "Vitamin B12", "Phosphorus"],
  },
  {
    id: "sample-egg-power",
    canteen_id: "canteen-1",
    category_id: "cat-healthy",
    name: "Egg Power Bowl (3 Whole Eggs)",
    description: "Scrambled farm eggs tossed with brown rice, carrots, corn, and green onions.",
    price_paise: 8500,
    image_url: null,
    is_veg: false,
    is_available: true,
    stock: 30,
    prep_minutes: 8,
    is_active: true,
    rating_avg: 4.6,
    rating_count: 14,
    calories_kcal: 330,
    ingredients: ["Farm eggs", "Brown rice", "Carrots", "Corn", "Spring onions", "Black pepper"],
    protein_g: 22.0,
    fat_g: 10.0,
    carbs_g: 36.0,
    fibre_g: 5.0,
    sugar_g: 1.8,
    sat_fat_g: 2.5,
    key_minerals: ["Choline", "Selenium", "Vitamin D", "Vitamin B2"],
  },
  {
    id: "sample-sprouted-chaat",
    canteen_id: "canteen-1",
    category_id: "cat-healthy",
    name: "Sprouted Moong & Chana Chaat",
    description: "Live sprouted mung beans and black chickpeas tossed with lime, pomegranate, and cucumber.",
    price_paise: 5000,
    image_url: null,
    is_veg: true,
    is_available: true,
    stock: 40,
    prep_minutes: 3,
    is_active: true,
    rating_avg: 4.9,
    rating_count: 22,
    calories_kcal: 210,
    ingredients: ["Sprouted green moong", "Black chana", "Pomegranate", "Cucumber", "Lime", "Coriander"],
    protein_g: 16.0,
    fat_g: 2.0,
    carbs_g: 28.0,
    fibre_g: 9.0,
    sugar_g: 4.0,
    sat_fat_g: 0.3,
    key_minerals: ["Vitamin C", "Potassium", "Magnesium", "Folate"],
  },
];
