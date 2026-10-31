/**
 * Shared constants and configuration for Healthy Mode.
 *
 * All Healthy Score criteria, weights, thresholds, bands, insight rules,
 * and deterministic carousel tips are centralized here so that UI components,
 * scoring algorithms, and the explainer page never disagree.
 */

export interface ScoreCriterionConfig {
  id: string;
  name: string;
  weightPercent: number;
  icon: string;
  description: string;
}

export const HEALTHY_SCORE_CRITERIA: ScoreCriterionConfig[] = [
  {
    id: "protein_density",
    name: "Protein Density",
    weightPercent: 35,
    icon: "Dumbbell",
    description: "Measures protein grams per 100 kcal. Higher concentration of protein supports sustained energy and muscle maintenance.",
  },
  {
    id: "fibre",
    name: "Dietary Fibre",
    weightPercent: 20,
    icon: "Wheat",
    description: "Evaluates dietary fibre per 100 kcal from whole grains, legumes, and vegetables to support smooth digestion and steady fullness.",
  },
  {
    id: "carb_quality",
    name: "Carbohydrate Quality",
    weightPercent: 15,
    icon: "Leaf",
    description: "Assesses the proportion of complex carbohydrates relative to simple sugars. Lower sugar proportion scores higher.",
  },
  {
    id: "fat_quality",
    name: "Fat Quality",
    weightPercent: 15,
    icon: "Heart",
    description: "Compares saturated fat against total fats. Lower saturated fat proportion scores higher.",
  },
  {
    id: "calorie_balance",
    name: "Calorie Balance",
    weightPercent: 15,
    icon: "Scale",
    description: "Checks meal portion alignment with a typical campus meal benchmark of 300 to 600 kcal. Calories alone do not determine nutrition.",
  },
];

export const HEALTHY_SCORE_THRESHOLDS = {
  // Protein density (g per 100 kcal)
  proteinMinDensity: 2.0, // <= 2.0g/100kcal = 0 score
  proteinTargetDensity: 10.0, // >= 10.0g/100kcal = 100 score

  // Fibre density (g per 100 kcal)
  fibreMinDensity: 0.0,
  fibreTargetDensity: 3.0, // >= 3.0g/100kcal = 100 score

  // Carb quality: sugar share of carbs (ratio 0..1)
  sugarIdealMaxShare: 0.10, // <= 10% sugar = 100 score
  sugarPoorMinShare: 0.60, // >= 60% sugar = 0 score

  // Fat quality: sat fat share of total fat (ratio 0..1)
  satFatIdealMaxShare: 0.20, // <= 20% sat fat = 100 score
  satFatPoorMinShare: 0.70, // >= 70% sat fat = 0 score

  // Calorie balance benchmark (kcal)
  calorieIdealMin: 300,
  calorieIdealMax: 600,
  calorieLowerFloor: 100, // < 100 kcal = 0 balance score
  calorieUpperCeiling: 1100, // > 1100 kcal = 0 balance score

  // Score Bands
  highBandMin: 70,
  mediumBandMin: 40,
};

export const INSIGHT_THRESHOLDS = {
  highProtein: 20, // g
  goodProtein: 12, // g
  highFibre: 5, // g
  goodFibre: 3, // g
  highSugar: 10, // g
  highSatFat: 5, // g
  lowCalorieMax: 300, // kcal
  balancedCalorieMax: 600, // kcal
};

/**
 * 8 short, original, neutral healthy-eating tips rotated across carousel slides.
 * Not attributed to real people; no medical claims.
 */
export const HEALTHY_CAROUSEL_TIPS = [
  {
    headline: "Fuel Your Study Sessions",
    body: "Pairing complex carbs with lean protein provides slow-burning energy to power through back-to-back lectures without a mid-afternoon crash.",
    tag: "Campus Nutrition Tip #1",
  },
  {
    headline: "Prioritize Natural Fibre",
    body: "Dishes with whole grains, toor dal, and chickpeas release glucose gradually, keeping you full and focused between classroom breaks.",
    tag: "Campus Nutrition Tip #2",
  },
  {
    headline: "Smart Post-Workout Recovery",
    body: "Aim for 20g to 30g of protein within an hour after physical activity to support muscle repair and physical stamina.",
    tag: "Campus Nutrition Tip #3",
  },
  {
    headline: "Look Beyond Just Calories",
    body: "Nutrient density matters more than calorie count alone. Nutrient-dense foods supply vitamins, minerals, and essential amino acids.",
    tag: "Campus Nutrition Tip #4",
  },
  {
    headline: "Stay Hydrated and Energized",
    body: "Chilled cultured curd and lassi offer natural probiotics that aid comfortable digestion while delivering bioavailable calcium.",
    tag: "Campus Nutrition Tip #5",
  },
  {
    headline: "Balance Your Plate",
    body: "A balanced campus meal combines a palm-sized portion of protein, slow carbs, and fresh greens for optimal daily vitality.",
    tag: "Campus Nutrition Tip #6",
  },
  {
    headline: "Mindful Snacking",
    body: "Choosing sprouted mung chaat or roasted legumes over deep-fried snacks helps sustain mental alertness during study hours.",
    tag: "Campus Nutrition Tip #7",
  },
  {
    headline: "Know Your Food Ratios",
    body: "Checking the protein, carb, and healthy fat balance helps you customize orders to match your personal daily fitness goals.",
    tag: "Campus Nutrition Tip #8",
  },
];

