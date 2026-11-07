import type { MenuItemData } from "@/components/student/item-detail-sheet";

export interface RealMenuNutritionProfile {
  protein_g: number;
  calories_kcal: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sugar_g: number;
  sat_fat_g: number;
  key_minerals: string[];
  ingredients: string[];
  is_protein: boolean;
}

/**
 * Authentic nutritional profiles for the real canteen food menu.
 * Only items with is_protein = true (>= 10g protein) are included in the Healthy section.
 * Non-protein food items (sugary beverages, tea, coffee, deep-fried carb snacks) are marked is_protein = false.
 */
export const REAL_MENU_NUTRITION: Record<string, RealMenuNutritionProfile> = {
  "chicken kathi roll": {
    protein_g: 28.0,
    calories_kcal: 380,
    carbs_g: 34.0,
    fat_g: 9.0,
    fibre_g: 4.0,
    sugar_g: 2.0,
    sat_fat_g: 2.5,
    key_minerals: ["Iron", "Zinc", "Vitamin B12", "Phosphorus"],
    ingredients: [
      "Lean chicken breast",
      "Whole wheat paratha",
      "Red onions",
      "Mint chutney",
      "Lemon",
      "Roasted spices",
    ],
    is_protein: true,
  },
  "special deluxe thali": {
    protein_g: 26.0,
    calories_kcal: 580,
    carbs_g: 72.0,
    fat_g: 16.0,
    fibre_g: 12.0,
    sugar_g: 4.0,
    sat_fat_g: 6.0,
    key_minerals: ["Calcium", "Iron", "Magnesium", "Potassium"],
    ingredients: [
      "Paneer butter masala",
      "Dal makhani",
      "Seasonal vegetables",
      "Whole wheat rotis",
      "Jeera rice",
      "Salad",
    ],
    is_protein: true,
  },
  "paneer kathi roll": {
    protein_g: 24.0,
    calories_kcal: 350,
    carbs_g: 28.0,
    fat_g: 12.0,
    fibre_g: 6.0,
    sugar_g: 3.0,
    sat_fat_g: 4.5,
    key_minerals: ["Calcium", "Phosphorus", "Magnesium", "Vitamin A"],
    ingredients: [
      "Fresh paneer",
      "Whole wheat roti",
      "Bell peppers",
      "Greek curd",
      "Mint",
      "Cumin",
    ],
    is_protein: true,
  },
  "egg fried rice": {
    protein_g: 22.0,
    calories_kcal: 340,
    carbs_g: 38.0,
    fat_g: 10.0,
    fibre_g: 4.0,
    sugar_g: 1.5,
    sat_fat_g: 2.5,
    key_minerals: ["Choline", "Selenium", "Vitamin D", "Vitamin B2"],
    ingredients: [
      "Farm fresh eggs",
      "Basmati rice",
      "Spring onions",
      "Carrots",
      "Black pepper",
      "Light soy",
    ],
    is_protein: true,
  },
  "student veg thali": {
    protein_g: 22.0,
    calories_kcal: 460,
    carbs_g: 68.0,
    fat_g: 9.0,
    fibre_g: 11.0,
    sugar_g: 3.0,
    sat_fat_g: 2.5,
    key_minerals: ["Calcium", "Iron", "Potassium", "Zinc"],
    ingredients: [
      "Yellow toor dal",
      "Mixed veg subzi",
      "3 wheat phulkas",
      "Steamed rice",
      "Fresh salad",
      "Pickle",
    ],
    is_protein: true,
  },
  "rajma chawal bowl": {
    protein_g: 18.0,
    calories_kcal: 380,
    carbs_g: 58.0,
    fat_g: 5.0,
    fibre_g: 12.0,
    sugar_g: 2.5,
    sat_fat_g: 1.0,
    key_minerals: ["Potassium", "Iron", "Folate", "Manganese"],
    ingredients: [
      "Red kidney beans",
      "Basmati rice",
      "Tomato gravy",
      "Ginger",
      "Cumin",
      "Coriander",
    ],
    is_protein: true,
  },
  "paneer bread pakoda": {
    protein_g: 16.0,
    calories_kcal: 310,
    carbs_g: 29.0,
    fat_g: 14.0,
    fibre_g: 3.5,
    sugar_g: 2.0,
    sat_fat_g: 4.0,
    key_minerals: ["Calcium", "Phosphorus", "Iron"],
    ingredients: [
      "Fresh cottage cheese paneer",
      "Gram flour (besan)",
      "Bread slice",
      "Carom seeds (ajwain)",
      "Spices",
    ],
    is_protein: true,
  },
  "chole bhature": {
    protein_g: 15.0,
    calories_kcal: 490,
    carbs_g: 62.0,
    fat_g: 18.0,
    fibre_g: 9.0,
    sugar_g: 3.0,
    sat_fat_g: 3.5,
    key_minerals: ["Iron", "Magnesium", "Folate", "Zinc"],
    ingredients: [
      "Kabuli chana (chickpeas)",
      "Bhature",
      "Pickled onions",
      "Ginger",
      "Amritsari spices",
    ],
    is_protein: true,
  },
  "south indian power combo": {
    protein_g: 14.0,
    calories_kcal: 420,
    carbs_g: 64.0,
    fat_g: 12.0,
    fibre_g: 7.0,
    sugar_g: 4.0,
    sat_fat_g: 2.5,
    key_minerals: ["Iron", "Calcium", "Potassium"],
    ingredients: [
      "Masala dosa",
      "Medu vada",
      "Toor dal sambar",
      "Coconut chutney",
      "Filter coffee",
    ],
    is_protein: true,
  },
  "sweet punjabi lassi": {
    protein_g: 12.0,
    calories_kcal: 195,
    carbs_g: 24.0,
    fat_g: 5.0,
    fibre_g: 1.0,
    sugar_g: 18.0,
    sat_fat_g: 3.0,
    key_minerals: ["Calcium", "Vitamin B12", "Phosphorus", "Riboflavin"],
    ingredients: [
      "Cultured dahi (curd)",
      "Almond dust",
      "Cardamom",
      "Chilled milk",
    ],
    is_protein: true,
  },
  "idli vada combo": {
    protein_g: 12.0,
    calories_kcal: 290,
    carbs_g: 48.0,
    fat_g: 6.0,
    fibre_g: 6.0,
    sugar_g: 2.0,
    sat_fat_g: 1.5,
    key_minerals: ["Iron", "Magnesium", "Potassium"],
    ingredients: [
      "Fermented rice & urad dal idlis",
      "Crispy medu vada",
      "Toor dal sambar",
      "Coconut chutney",
    ],
    is_protein: true,
  },
  "veg cheese grilled sandwich": {
    protein_g: 11.0,
    calories_kcal: 310,
    carbs_g: 38.0,
    fat_g: 12.0,
    fibre_g: 4.0,
    sugar_g: 3.0,
    sat_fat_g: 6.0,
    key_minerals: ["Calcium", "Phosphorus", "Vitamin A"],
    ingredients: [
      "Processed cheddar cheese",
      "Multi-grain bread",
      "Potatoes",
      "Cucumber",
      "Tomato",
      "Green chutney",
    ],
    is_protein: true,
  },

  // Non-protein items explicitly marked is_protein: false
  "masala chai": {
    protein_g: 1.0,
    calories_kcal: 85,
    carbs_g: 14.0,
    fat_g: 2.5,
    fibre_g: 0.0,
    sugar_g: 12.0,
    sat_fat_g: 1.5,
    key_minerals: ["Potassium"],
    ingredients: ["Black tea", "Milk", "Sugar", "Ginger", "Cardamom"],
    is_protein: false,
  },
  "south indian filter coffee": {
    protein_g: 1.5,
    calories_kcal: 95,
    carbs_g: 15.0,
    fat_g: 3.0,
    fibre_g: 0.0,
    sugar_g: 12.0,
    sat_fat_g: 1.8,
    key_minerals: ["Potassium"],
    ingredients: ["Filter coffee decoction", "Whole milk", "Sugar"],
    is_protein: false,
  },
  "fresh nimbu pani": {
    protein_g: 0.2,
    calories_kcal: 60,
    carbs_g: 15.0,
    fat_g: 0.1,
    fibre_g: 0.3,
    sugar_g: 14.0,
    sat_fat_g: 0.0,
    key_minerals: ["Vitamin C", "Potassium"],
    ingredients: ["Fresh lemon juice", "Water", "Sugar", "Black salt", "Cumin"],
    is_protein: false,
  },
  "samosa (2 pcs)": {
    protein_g: 3.5,
    calories_kcal: 260,
    carbs_g: 32.0,
    fat_g: 14.0,
    fibre_g: 2.5,
    sugar_g: 1.5,
    sat_fat_g: 3.5,
    key_minerals: ["Iron"],
    ingredients: ["Refined flour", "Potatoes", "Green peas", "Oil", "Spices"],
    is_protein: false,
  },
  "vada pav": {
    protein_g: 4.0,
    calories_kcal: 290,
    carbs_g: 38.0,
    fat_g: 13.0,
    fibre_g: 2.0,
    sugar_g: 2.0,
    sat_fat_g: 3.0,
    key_minerals: ["Iron", "Potassium"],
    ingredients: ["Pav bun", "Potato batata vada", "Garlic chutney", "Green chili"],
    is_protein: false,
  },
  "pav bhaji": {
    protein_g: 5.0,
    calories_kcal: 400,
    carbs_g: 52.0,
    fat_g: 18.0,
    fibre_g: 6.0,
    sugar_g: 5.0,
    sat_fat_g: 9.0,
    key_minerals: ["Vitamin A", "Vitamin C"],
    ingredients: ["Mashed vegetables", "Butter", "Pav buns", "Pav bhaji masala"],
    is_protein: false,
  },
  "veg puff": {
    protein_g: 2.8,
    calories_kcal: 220,
    carbs_g: 24.0,
    fat_g: 12.0,
    fibre_g: 1.5,
    sugar_g: 1.0,
    sat_fat_g: 5.0,
    key_minerals: ["Iron"],
    ingredients: ["Puff pastry", "Carrots", "Potatoes", "Peas"],
    is_protein: false,
  },
  "plain dosa": {
    protein_g: 3.5,
    calories_kcal: 210,
    carbs_g: 38.0,
    fat_g: 4.5,
    fibre_g: 2.0,
    sugar_g: 1.0,
    sat_fat_g: 1.0,
    key_minerals: ["Iron", "Sodium"],
    ingredients: ["Fermented rice & urad dal batter", "Oil", "Sambar", "Chutney"],
    is_protein: false,
  },
  "masala dosa": {
    protein_g: 4.5,
    calories_kcal: 280,
    carbs_g: 46.0,
    fat_g: 8.0,
    fibre_g: 3.5,
    sugar_g: 2.0,
    sat_fat_g: 2.0,
    key_minerals: ["Iron", "Potassium"],
    ingredients: ["Rice crepe", "Spiced potato masala", "Sambar", "Coconut chutney"],
    is_protein: false,
  },
  "poha": {
    protein_g: 4.0,
    calories_kcal: 240,
    carbs_g: 42.0,
    fat_g: 6.0,
    fibre_g: 3.0,
    sugar_g: 2.0,
    sat_fat_g: 1.0,
    key_minerals: ["Iron", "Magnesium"],
    ingredients: ["Flattened rice", "Roasted peanuts", "Onions", "Mustard seeds", "Turmeric"],
    is_protein: false,
  },
  "veg hakka noodles": {
    protein_g: 4.5,
    calories_kcal: 320,
    carbs_g: 54.0,
    fat_g: 9.0,
    fibre_g: 3.0,
    sugar_g: 3.0,
    sat_fat_g: 1.5,
    key_minerals: ["Iron"],
    ingredients: ["Wheat noodles", "Cabbage", "Bell peppers", "Carrots", "Soy sauce"],
    is_protein: false,
  },
  "break fast-track: samosa & chai": {
    protein_g: 4.5,
    calories_kcal: 345,
    carbs_g: 46.0,
    fat_g: 16.5,
    fibre_g: 2.5,
    sugar_g: 13.5,
    sat_fat_g: 5.0,
    key_minerals: ["Iron"],
    ingredients: ["Samosa", "Masala chai", "Chutney"],
    is_protein: false,
  },
};

/**
 * Resolves nutritional information for any real menu item name with fuzzy matching.
 */
export function getRealMenuNutrition(name: string): RealMenuNutritionProfile | null {
  if (!name) return null;
  const clean = name.toLowerCase().trim();

  // 1. Direct exact lookup
  if (REAL_MENU_NUTRITION[clean]) {
    return REAL_MENU_NUTRITION[clean];
  }

  // 2. Exact match on normalized keys
  for (const [key, profile] of Object.entries(REAL_MENU_NUTRITION)) {
    if (clean === key || clean.startsWith(key) || key.startsWith(clean)) {
      return profile;
    }
  }

  // 3. Keyword heuristic matching
  if (clean.includes("chicken") && clean.includes("kathi")) {
    return REAL_MENU_NUTRITION["chicken kathi roll"];
  }
  if (clean.includes("deluxe") && clean.includes("thali")) {
    return REAL_MENU_NUTRITION["special deluxe thali"];
  }
  if (
    clean.includes("paneer") &&
    (clean.includes("kathi") || clean.includes("wrap") || clean.includes("roll"))
  ) {
    return REAL_MENU_NUTRITION["paneer kathi roll"];
  }
  if (clean.includes("egg") && clean.includes("rice")) {
    return REAL_MENU_NUTRITION["egg fried rice"];
  }
  if (clean.includes("veg thali") || clean.includes("student thali") || clean.includes("student veg")) {
    return REAL_MENU_NUTRITION["student veg thali"];
  }
  if (clean.includes("rajma")) {
    return REAL_MENU_NUTRITION["rajma chawal bowl"];
  }
  if (clean.includes("paneer") && clean.includes("pakoda")) {
    return REAL_MENU_NUTRITION["paneer bread pakoda"];
  }
  if (clean.includes("chole") || clean.includes("bhature")) {
    return REAL_MENU_NUTRITION["chole bhature"];
  }
  if (clean.includes("power combo") || clean.includes("south indian combo")) {
    return REAL_MENU_NUTRITION["south indian power combo"];
  }
  if (clean.includes("lassi")) {
    return REAL_MENU_NUTRITION["sweet punjabi lassi"];
  }
  if (clean.includes("idli") && clean.includes("vada")) {
    return REAL_MENU_NUTRITION["idli vada combo"];
  }
  if (clean.includes("cheese") && clean.includes("sandwich")) {
    return REAL_MENU_NUTRITION["veg cheese grilled sandwich"];
  }

  return null;
}

/**
 * Filters out non-protein and unavailable items, and enriches real menu items with verified
 * nutritional macros so they integrate with Cart, Checkout, and Order Tracking.
 */
export function enrichAndFilterProteinMenuItems(
  items: MenuItemData[]
): MenuItemData[] {
  return items
    .filter((item) => {
      // Must be active and available
      if (!item.is_active || !item.is_available) return false;

      // If item already has protein_g >= 10 from DB:
      if (item.protein_g != null && item.protein_g >= 10) {
        return true;
      }

      // Check against real menu nutrition dictionary
      const nutrition = getRealMenuNutrition(item.name);
      return nutrition ? nutrition.is_protein : false;
    })
    .map((item) => {
      const nutrition = getRealMenuNutrition(item.name);
      if (!nutrition) return item;

      return {
        ...item,
        protein_g: item.protein_g ?? nutrition.protein_g,
        calories_kcal: item.calories_kcal ?? nutrition.calories_kcal,
        carbs_g: item.carbs_g ?? nutrition.carbs_g,
        fat_g: item.fat_g ?? nutrition.fat_g,
        fibre_g: item.fibre_g ?? nutrition.fibre_g,
        sugar_g: item.sugar_g ?? nutrition.sugar_g,
        sat_fat_g: item.sat_fat_g ?? nutrition.sat_fat_g,
        key_minerals:
          item.key_minerals && item.key_minerals.length > 0
            ? item.key_minerals
            : nutrition.key_minerals,
        ingredients:
          item.ingredients && item.ingredients.length > 0
            ? item.ingredients
            : nutrition.ingredients,
      };
    });
}
