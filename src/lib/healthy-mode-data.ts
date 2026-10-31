export interface MacroBreakdown {
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g: number;
  calories_kcal: number;
}

export interface MineralProfile {
  name: string;
  amount: string;
  dailyValuePercent: number;
}

export interface ExtractedIngredient {
  name: string;
  benefit: string;
}

export interface HealthyFoodItem {
  id: string;
  name: string;
  tagline: string;
  category: "all" | "high_protein" | "veg" | "non_veg" | "low_calorie";
  is_veg: boolean;
  price_paise: number;
  prep_minutes: number;
  description: string;
  macros: MacroBreakdown;
  minerals: MineralProfile[];
  extractedIngredients: ExtractedIngredient[];
  proteinHighlight: string;
  dietaryBadges: string[];
}

export const HEALTHY_FOOD_ITEMS: HealthyFoodItem[] = [
  {
    id: "chicken-kathi-roll",
    name: "Chicken Kathi Roll (High Protein)",
    tagline: "Lean chicken breast in a crisp whole-wheat paratha wrap",
    category: "non_veg",
    is_veg: false,
    price_paise: 9500, // ₹95
    prep_minutes: 9,
    description: "Tender shredded chicken breast marinated in roasted cumin, ginger-garlic, and yogurt, wrapped with crunchy sliced red onions and fresh mint chutney.",
    macros: {
      protein_g: 28,
      carbs_g: 34,
      fats_g: 9,
      fiber_g: 4,
      calories_kcal: 380,
    },
    minerals: [
      { name: "Iron", amount: "3.2 mg", dailyValuePercent: 18 },
      { name: "Zinc", amount: "2.4 mg", dailyValuePercent: 22 },
      { name: "Vitamin B12", amount: "0.8 mcg", dailyValuePercent: 35 },
      { name: "Phosphorus", amount: "240 mg", dailyValuePercent: 24 },
    ],
    extractedIngredients: [
      { name: "Lean Chicken Breast", benefit: "Rich in complete protein with all 9 essential amino acids for fast muscle recovery." },
      { name: "Whole-Wheat Paratha", benefit: "Complex carbohydrates that release slow, sustained energy during long lectures." },
      { name: "Red Onions & Lemon", benefit: "Quercetin antioxidants and Vitamin C that enhance dietary iron absorption." },
      { name: "Mint & Greek Curd Chutney", benefit: "Natural probiotics that assist with smooth digestion and gut health." },
    ],
    proteinHighlight: "28g Muscle Fuel",
    dietaryBadges: ["High Protein", "Lean Muscle", "Iron Rich"],
  },
  {
    id: "paneer-kathi-roll",
    name: "Paneer Tikka Protein Wrap",
    tagline: "Golden tandoori paneer with bell peppers & mint spread",
    category: "veg",
    is_veg: true,
    price_paise: 8000, // ₹80
    prep_minutes: 8,
    description: "Generous chunks of fresh cottage cheese paneer grilled with bell peppers and roasted spices, wrapped in a wholesome roti with green chutney.",
    macros: {
      protein_g: 24,
      carbs_g: 28,
      fats_g: 12,
      fiber_g: 6,
      calories_kcal: 350,
    },
    minerals: [
      { name: "Calcium", amount: "420 mg", dailyValuePercent: 42 },
      { name: "Phosphorus", amount: "280 mg", dailyValuePercent: 28 },
      { name: "Magnesium", amount: "45 mg", dailyValuePercent: 15 },
      { name: "Vitamin A", amount: "180 mcg", dailyValuePercent: 20 },
    ],
    extractedIngredients: [
      { name: "Fresh Cow Milk Paneer", benefit: "High in casein protein, which digests steadily to keep you satiated for hours." },
      { name: "Crisp Bell Peppers", benefit: "Packed with Vitamin C and carotenoids that combat daily academic screen fatigue." },
      { name: "Whole Grains", benefit: "Provides dietary fiber to maintain stable blood sugar levels between classes." },
      { name: "Coriander & Cumin Seeds", benefit: "Carminative spices that enhance nutrient absorption and relieve bloating." },
    ],
    proteinHighlight: "24g Vegetarian Protein",
    dietaryBadges: ["High Protein", "Calcium Rich", "100% Veg"],
  },
  {
    id: "soya-chunk-biryani",
    name: "Soya Chunk Protein Bowl",
    tagline: "Nutri-dense textured soya with fragrant brown basmati",
    category: "veg",
    is_veg: true,
    price_paise: 7500, // ₹75
    prep_minutes: 6,
    description: "High-density protein soya chunks cooked in a slow-simmered aromatic masala with brown basmati rice, mint leaves, and cooling raita.",
    macros: {
      protein_g: 32,
      carbs_g: 42,
      fats_g: 4,
      fiber_g: 8,
      calories_kcal: 360,
    },
    minerals: [
      { name: "Iron", amount: "6.2 mg", dailyValuePercent: 35 },
      { name: "Magnesium", amount: "95 mg", dailyValuePercent: 25 },
      { name: "Folate", amount: "120 mcg", dailyValuePercent: 30 },
      { name: "Copper", amount: "0.4 mg", dailyValuePercent: 20 },
    ],
    extractedIngredients: [
      { name: "Defatted Soya Chunks", benefit: "Highest protein concentration among plant sources (52% protein by dry weight)." },
      { name: "Brown Basmati Rice", benefit: "Low glycemic index grain providing slow-burning energy with zero afternoon crash." },
      { name: "Mint & Cilantro Leaf Broth", benefit: "Rich in chlorophyll and polyphenols supporting mental focus and vitality." },
    ],
    proteinHighlight: "32g Super Protein",
    dietaryBadges: ["Highest Protein", "Zero Cholesterol", "High Fiber"],
  },
  {
    id: "egg-fried-rice",
    name: "Egg Power Bowl (3 Whole Eggs)",
    tagline: "Scrambled farm eggs tossed with brown rice & veggies",
    category: "non_veg",
    is_veg: false,
    price_paise: 8500, // ₹85
    prep_minutes: 8,
    description: "Three farm-fresh eggs scrambled with crunchy carrots, sweet corn, spring onions, and fragrant basmati rice tossed with light soy and white pepper.",
    macros: {
      protein_g: 22,
      carbs_g: 36,
      fats_g: 10,
      fiber_g: 5,
      calories_kcal: 330,
    },
    minerals: [
      { name: "Choline", amount: "250 mg", dailyValuePercent: 45 },
      { name: "Selenium", amount: "28 mcg", dailyValuePercent: 50 },
      { name: "Vitamin D", amount: "2.1 mcg", dailyValuePercent: 21 },
      { name: "Vitamin B2", amount: "0.4 mg", dailyValuePercent: 30 },
    ],
    extractedIngredients: [
      { name: "Farm Fresh Eggs", benefit: "Gold standard biological value protein with high bioavailability and brain-boosting choline." },
      { name: "Spring Onions & Carrots", benefit: "Rich in beta-carotene and sulfur compounds that promote cellular immunity." },
      { name: "Black Pepper & Ginger", benefit: "Piperine compounds that enhance micronutrient uptake in the digestive tract." },
    ],
    proteinHighlight: "22g Complete Protein",
    dietaryBadges: ["Complete Amino Acids", "Brain Fuel", "Selenium Rich"],
  },
  {
    id: "rajma-chawal-bowl",
    name: "Punjabi Rajma & Rice Bowl",
    tagline: "Slow-cooked red kidney beans in rich spiced gravy",
    category: "veg",
    is_veg: true,
    price_paise: 7000, // ₹70
    prep_minutes: 5,
    description: "Homestyle red kidney beans slow-cooked with fresh tomatoes, ginger, and roasted cumin seeds, served piping hot over fragrant steamed rice.",
    macros: {
      protein_g: 18,
      carbs_g: 58,
      fats_g: 5,
      fiber_g: 12,
      calories_kcal: 380,
    },
    minerals: [
      { name: "Potassium", amount: "620 mg", dailyValuePercent: 26 },
      { name: "Iron", amount: "4.1 mg", dailyValuePercent: 23 },
      { name: "Folate", amount: "160 mcg", dailyValuePercent: 40 },
      { name: "Manganese", amount: "0.8 mg", dailyValuePercent: 35 },
    ],
    extractedIngredients: [
      { name: "Red Kidney Beans (Rajma)", benefit: "High in resistant starch and prebiotic fiber, fostering optimal gut microbiome health." },
      { name: "Steamed Basmati Rice", benefit: "Combines with kidney beans to form a complementary complete plant-protein profile." },
      { name: "Ripe Tomato & Ginger Base", benefit: "Natural lycopene antioxidants that reduce oxidative physical and mental stress." },
    ],
    proteinHighlight: "18g Fiber & Protein",
    dietaryBadges: ["12g Fiber", "Heart Healthy", "Gluten Free"],
  },
  {
    id: "sprouted-moong-chaat",
    name: "Sprouted Moong & Chana Chaat",
    tagline: "Fresh sprouted mung beans, kala chana, lime & pomegranate",
    category: "low_calorie",
    is_veg: true,
    price_paise: 5000, // ₹50
    prep_minutes: 3,
    description: "Crunchy live sprouted green mung beans and black chickpeas tossed with cucumber, juicy pomegranate pearls, fresh coriander, and tangy chaat masala.",
    macros: {
      protein_g: 16,
      carbs_g: 28,
      fats_g: 2,
      fiber_g: 9,
      calories_kcal: 210,
    },
    minerals: [
      { name: "Vitamin C", amount: "28 mg", dailyValuePercent: 32 },
      { name: "Potassium", amount: "480 mg", dailyValuePercent: 20 },
      { name: "Magnesium", amount: "65 mg", dailyValuePercent: 18 },
      { name: "Folate", amount: "140 mcg", dailyValuePercent: 35 },
    ],
    extractedIngredients: [
      { name: "Sprouted Green Moong", benefit: "Sprouting activates live digestive enzymes and doubles bioavailable Vitamin C." },
      { name: "Black Chickpeas (Kala Chana)", benefit: "Extremely low glycemic response that prevents sluggishness and brain fog." },
      { name: "Pomegranate & Lime", benefit: "Potent polyphenol antioxidants that refresh the palate and boost mental alertness." },
    ],
    proteinHighlight: "16g Clean Protein",
    dietaryBadges: ["Low Calorie", "Live Enzymes", "Zero Oil"],
  },
  {
    id: "student-veg-thali",
    name: "Balanced Campus Power Thali",
    tagline: "Toor dal, paneer subzi, 3 phulkas, rice & fresh salad",
    category: "veg",
    is_veg: true,
    price_paise: 8000, // ₹80
    prep_minutes: 10,
    description: "Traditional campus meal balanced for academic stamina: yellow toor dal tadka, fresh cottage cheese paneer subzi, 3 hot wheat phulkas, rice, and crisp salad.",
    macros: {
      protein_g: 22,
      carbs_g: 68,
      fats_g: 9,
      fiber_g: 11,
      calories_kcal: 460,
    },
    minerals: [
      { name: "Calcium", amount: "320 mg", dailyValuePercent: 32 },
      { name: "Iron", amount: "4.5 mg", dailyValuePercent: 25 },
      { name: "Potassium", amount: "540 mg", dailyValuePercent: 22 },
      { name: "Zinc", amount: "2.1 mg", dailyValuePercent: 19 },
    ],
    extractedIngredients: [
      { name: "Yellow Toor Dal", benefit: "Rich in molybdenum and plant protein that supports regular metabolic detox pathways." },
      { name: "Soft Wheat Phulkas", benefit: "Unrefined whole grain providing steady fuel for demanding laboratory & study sessions." },
      { name: "Paneer & Curd Subzi", benefit: "Provides bioavailable calcium and essential fatty acids for joint and bone support." },
    ],
    proteinHighlight: "22g Balanced Plate",
    dietaryBadges: ["Complete Meal", "High Fiber", "Traditional"],
  },
  {
    id: "sweet-punjabi-lassi",
    name: "High-Protein Churned Lassi",
    tagline: "Thick cultured probiotic curd with cardamom & almond dust",
    category: "low_calorie",
    is_veg: true,
    price_paise: 3500, // ₹35
    prep_minutes: 2,
    description: "Traditional chilled probiotic yogurt lassi churned smooth with a hint of green cardamom and crushed roasted California almonds.",
    macros: {
      protein_g: 12,
      carbs_g: 24,
      fats_g: 5,
      fiber_g: 1,
      calories_kcal: 195,
    },
    minerals: [
      { name: "Calcium", amount: "380 mg", dailyValuePercent: 38 },
      { name: "Riboflavin B2", amount: "0.35 mg", dailyValuePercent: 27 },
      { name: "Phosphorus", amount: "210 mg", dailyValuePercent: 21 },
      { name: "Vitamin B12", amount: "0.6 mcg", dailyValuePercent: 25 },
    ],
    extractedIngredients: [
      { name: "Cultured Full-Fat Dahi", benefit: "Billions of live probiotic CFU cultures that strengthen intestinal gut flora." },
      { name: "Crushed Almond Dust", benefit: "Provides healthy monounsaturated fats and Vitamin E for radiant skin and cellular health." },
      { name: "Green Cardamom (Elaichi)", benefit: "Calming botanical that aids gastric comfort and freshens breath naturally." },
    ],
    proteinHighlight: "12g Probiotic Drink",
    dietaryBadges: ["Gut Health", "Calcium Boost", "Chilled"],
  },
];

/**
 * Calculates percentage breakdown of macronutrients (Protein, Carbs, Fats)
 * based on standard Atwater factors: Protein 4 kcal/g, Carbs 4 kcal/g, Fats 9 kcal/g.
 */
export function calculateMacroPercentages(macros: MacroBreakdown): {
  proteinPercent: number;
  carbsPercent: number;
  fatsPercent: number;
} {
  const proteinCalories = macros.protein_g * 4;
  const carbsCalories = macros.carbs_g * 4;
  const fatsCalories = macros.fats_g * 9;
  const totalCalories = proteinCalories + carbsCalories + fatsCalories || 1;

  const proteinPercent = Math.round((proteinCalories / totalCalories) * 100);
  const carbsPercent = Math.round((carbsCalories / totalCalories) * 100);
  const fatsPercent = Math.max(0, 100 - proteinPercent - carbsPercent);

  return { proteinPercent, carbsPercent, fatsPercent };
}

