import {
  HEALTHY_SCORE_THRESHOLDS,
  HEALTHY_SCORE_CRITERIA,
} from "@/lib/healthy-constants";

export type HealthyScoreBand = "High" | "Medium" | "Low";

export interface HealthyScoreInput {
  calories_kcal?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  fibre_g?: number | null;
  sugar_g?: number | null;
  sat_fat_g?: number | null;
}

export interface CriterionResult {
  id: string;
  name: string;
  weightPercent: number;
  score: number; // 0..100
  weightedContribution: number;
}

export interface HealthyScoreResult {
  score: number;
  band: HealthyScoreBand;
  criteria: CriterionResult[];
}

/**
 * Pure function that calculates the Healthy Score (0-100) and classification band.
 * Returns null if any core nutritional value (calories, protein, fat, carbs) is missing or invalid.
 */
export function calculateHealthyScore(
  input: HealthyScoreInput
): HealthyScoreResult | null {
  const {
    calories_kcal,
    protein_g,
    fat_g,
    carbs_g,
    fibre_g,
    sugar_g,
    sat_fat_g,
  } = input;

  // Invariant: All 7 core values must be present and calories > 0
  if (
    calories_kcal == null ||
    protein_g == null ||
    fat_g == null ||
    carbs_g == null ||
    fibre_g == null ||
    sugar_g == null ||
    sat_fat_g == null ||
    calories_kcal <= 0 ||
    protein_g < 0 ||
    fat_g < 0 ||
    carbs_g < 0 ||
    fibre_g < 0 ||
    sugar_g < 0 ||
    sat_fat_g < 0
  ) {
    return null;
  }

  const {
    proteinMinDensity,
    proteinTargetDensity,
    fibreTargetDensity,
    sugarIdealMaxShare,
    sugarPoorMinShare,
    satFatIdealMaxShare,
    satFatPoorMinShare,
    calorieIdealMin,
    calorieIdealMax,
    calorieLowerFloor,
    calorieUpperCeiling,
    highBandMin,
    mediumBandMin,
  } = HEALTHY_SCORE_THRESHOLDS;

  // 1. Protein density score (35% weight)
  // Formula: (protein_g / calories_kcal) * 100
  // Target: >= 10.0g per 100 kcal = 100; <= 2.0g per 100 kcal = 0
  const proteinDensity = (protein_g / calories_kcal) * 100;
  let proteinScore = 0;
  if (proteinDensity >= proteinTargetDensity) {
    proteinScore = 100;
  } else if (proteinDensity <= proteinMinDensity) {
    proteinScore = 0;
  } else {
    proteinScore =
      ((proteinDensity - proteinMinDensity) /
        (proteinTargetDensity - proteinMinDensity)) *
      100;
  }

  // 2. Fibre score (20% weight)
  // Formula: (fibre_g / calories_kcal) * 100
  // Target: >= 3.0g per 100 kcal = 100; 0g = 0. Null treated as 0g.
  const safeFibre = fibre_g != null && fibre_g > 0 ? fibre_g : 0;
  const fibreDensity = (safeFibre / calories_kcal) * 100;
  let fibreScore = 0;
  if (fibreDensity >= fibreTargetDensity) {
    fibreScore = 100;
  } else if (fibreDensity <= 0) {
    fibreScore = 0;
  } else {
    fibreScore = (fibreDensity / fibreTargetDensity) * 100;
  }

  // 3. Carb quality score (15% weight)
  // Formula: sugar share of carbs (ratio).
  // Target: <= 10% sugar = 100; >= 60% sugar = 0. Null sugar treated as neutral (50).
  let carbScore = 50;
  if (sugar_g != null) {
    if (carbs_g <= 0) {
      carbScore = 50;
    } else {
      const sugarShare = Math.min(1, Math.max(0, sugar_g / carbs_g));
      if (sugarShare <= sugarIdealMaxShare) {
        carbScore = 100;
      } else if (sugarShare >= sugarPoorMinShare) {
        carbScore = 0;
      } else {
        carbScore =
          ((sugarPoorMinShare - sugarShare) /
            (sugarPoorMinShare - sugarIdealMaxShare)) *
          100;
      }
    }
  }

  // 4. Fat quality score (15% weight)
  // Formula: saturated fat share of total fat (ratio).
  // Target: <= 20% sat fat = 100; >= 70% sat fat = 0. Null sat_fat treated as neutral (50).
  let fatQualityScore = 50;
  if (sat_fat_g != null) {
    if (fat_g <= 0) {
      fatQualityScore = 50;
    } else {
      const satFatShare = Math.min(1, Math.max(0, sat_fat_g / fat_g));
      if (satFatShare <= satFatIdealMaxShare) {
        fatQualityScore = 100;
      } else if (satFatShare >= satFatPoorMinShare) {
        fatQualityScore = 0;
      } else {
        fatQualityScore =
          ((satFatPoorMinShare - satFatShare) /
            (satFatPoorMinShare - satFatIdealMaxShare)) *
          100;
      }
    }
  }

  // 5. Calorie balance score (15% weight)
  // Formula: distance from 300..600 kcal benchmark.
  // 300..600 kcal = 100. Lower floor 100 kcal, upper ceiling 1100 kcal.
  let calorieScore = 0;
  if (calories_kcal >= calorieIdealMin && calories_kcal <= calorieIdealMax) {
    calorieScore = 100;
  } else if (calories_kcal < calorieIdealMin) {
    if (calories_kcal <= calorieLowerFloor) {
      calorieScore = 0;
    } else {
      calorieScore =
        ((calories_kcal - calorieLowerFloor) /
          (calorieIdealMin - calorieLowerFloor)) *
        100;
    }
  } else {
    // calories_kcal > calorieIdealMax
    if (calories_kcal >= calorieUpperCeiling) {
      calorieScore = 0;
    } else {
      calorieScore =
        ((calorieUpperCeiling - calories_kcal) /
          (calorieUpperCeiling - calorieIdealMax)) *
        100;
    }
  }

  // Clamp individual scores between 0 and 100
  proteinScore = Math.min(100, Math.max(0, proteinScore));
  fibreScore = Math.min(100, Math.max(0, fibreScore));
  carbScore = Math.min(100, Math.max(0, carbScore));
  fatQualityScore = Math.min(100, Math.max(0, fatQualityScore));
  calorieScore = Math.min(100, Math.max(0, calorieScore));

  const weightedTotal =
    proteinScore * 0.35 +
    fibreScore * 0.2 +
    carbScore * 0.15 +
    fatQualityScore * 0.15 +
    calorieScore * 0.15;

  const score = Math.min(100, Math.max(0, Math.round(weightedTotal)));

  let band: HealthyScoreBand = "Low";
  if (score >= highBandMin) {
    band = "High";
  } else if (score >= mediumBandMin) {
    band = "Medium";
  }

  const criteriaResults: CriterionResult[] = [
    {
      id: "protein_density",
      name: HEALTHY_SCORE_CRITERIA[0].name,
      weightPercent: 35,
      score: Math.round(proteinScore),
      weightedContribution: Math.round(proteinScore * 0.35),
    },
    {
      id: "fibre",
      name: HEALTHY_SCORE_CRITERIA[1].name,
      weightPercent: 20,
      score: Math.round(fibreScore),
      weightedContribution: Math.round(fibreScore * 0.2),
    },
    {
      id: "carb_quality",
      name: HEALTHY_SCORE_CRITERIA[2].name,
      weightPercent: 15,
      score: Math.round(carbScore),
      weightedContribution: Math.round(carbScore * 0.15),
    },
    {
      id: "fat_quality",
      name: HEALTHY_SCORE_CRITERIA[3].name,
      weightPercent: 15,
      score: Math.round(fatQualityScore),
      weightedContribution: Math.round(fatQualityScore * 0.15),
    },
    {
      id: "calorie_balance",
      name: HEALTHY_SCORE_CRITERIA[4].name,
      weightPercent: 15,
      score: Math.round(calorieScore),
      weightedContribution: Math.round(calorieScore * 0.15),
    },
  ];

  return {
    score,
    band,
    criteria: criteriaResults,
  };
}
