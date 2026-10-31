import { z } from "zod";

/**
 * Strips invisible, zero-width, bidi, and control characters:
 * - U+200B to U+200F (zero-width spaces, joiners, directional marks)
 * - U+202A to U+202E (directional embeddings/overrides)
 * - U+2060 (word joiner)
 * - U+2066 to U+2069 (directional isolates)
 * - U+FEFF (zero-width non-breaking space / byte order mark)
 * - Control characters [\x00-\x1F\x7F]
 */
export function sanitizeNutritionString(input: string): string {
  if (!input) return "";
  return input
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes an array of ingredients:
 * 1. Sanitizes each entry.
 * 2. Drops empty strings.
 * 3. Deduplicates case-insensitively, preserving original casing and order of first appearance.
 */
export function normalizeIngredientsList(rawIngredients: string[]): string[] {
  if (!Array.isArray(rawIngredients)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of rawIngredients) {
    if (typeof raw !== "string") continue;
    const clean = sanitizeNutritionString(raw);
    if (!clean) continue;

    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      normalized.push(clean);
    }
  }

  return normalized;
}

/**
 * Normalizes an array of key minerals:
 * 1. Sanitizes each entry.
 * 2. Drops empty strings.
 * 3. Deduplicates case-insensitively, preserving original casing and order of first appearance.
 */
export function normalizeMineralsList(rawMinerals: string[]): string[] {
  if (!Array.isArray(rawMinerals)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of rawMinerals) {
    if (typeof raw !== "string") continue;
    const clean = sanitizeNutritionString(raw);
    if (!clean) continue;

    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      normalized.push(clean);
    }
  }

  return normalized;
}

export const singleIngredientSchema = z
  .string()
  .transform((val) => sanitizeNutritionString(val))
  .pipe(
    z
      .string()
      .min(1, "Ingredient cannot be empty.")
      .max(60, "Ingredient must be at most 60 characters.")
  );

export const ingredientsArraySchema = z
  .array(z.string())
  .transform((items) => normalizeIngredientsList(items))
  .pipe(
    z
      .array(
        z
          .string()
          .min(1, "Ingredient cannot be empty.")
          .max(60, "Ingredient must be at most 60 characters.")
      )
      .max(30, "A maximum of 30 ingredients is allowed.")
  );

export const singleMineralSchema = z
  .string()
  .transform((val) => sanitizeNutritionString(val))
  .pipe(
    z
      .string()
      .min(1, "Mineral cannot be empty.")
      .max(40, "Mineral must be at most 40 characters.")
  );

export const mineralsArraySchema = z
  .array(z.string())
  .transform((items) => normalizeMineralsList(items))
  .pipe(
    z
      .array(
        z
          .string()
          .min(1, "Mineral cannot be empty.")
          .max(40, "Mineral must be at most 40 characters.")
      )
      .max(8, "A maximum of 8 key minerals is allowed.")
  );

export const caloriesSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((val): number | null | undefined => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : NaN;
    }
    return val;
  })
  .refine(
    (val) => {
      if (val === undefined || val === null) return true;
      return Number.isInteger(val) && val >= 0 && val <= 5000;
    },
    { message: "Calories must be a whole number between 0 and 5,000 kcal." }
  );

export function createMacroGramSchema(fieldName: string) {
  return z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((val): number | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (!trimmed) return null;
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : NaN;
      }
      return val;
    })
    .refine(
      (val) => {
        if (val === undefined || val === null) return true;
        if (!Number.isFinite(val)) return false;
        if (val < 0 || val > 500) return false;
        const rounded = Math.round(val * 10) / 10;
        return Math.abs(val - rounded) < 0.0001;
      },
      { message: `${fieldName} must be a number between 0 and 500 with at most 1 decimal place.` }
    );
}

export const proteinSchema = createMacroGramSchema("Protein");
export const fatSchema = createMacroGramSchema("Fat");
export const carbsSchema = createMacroGramSchema("Carbohydrates");
export const fibreSchema = createMacroGramSchema("Fibre");
export const sugarSchema = createMacroGramSchema("Sugar");
export const satFatSchema = createMacroGramSchema("Saturated fat");

export interface NutritionValidationInput {
  calories_kcal?: number | string | null;
  ingredients?: string[] | null;
  protein_g?: number | string | null;
  fat_g?: number | string | null;
  carbs_g?: number | string | null;
  fibre_g?: number | string | null;
  sugar_g?: number | string | null;
  sat_fat_g?: number | string | null;
  key_minerals?: string[] | null;
}

export type NutritionValidationResult = {
  success: boolean;
  error?: string;
  calories_kcal?: number | null;
  ingredients?: string[];
  protein_g?: number | null;
  fat_g?: number | null;
  carbs_g?: number | null;
  fibre_g?: number | null;
  sugar_g?: number | null;
  sat_fat_g?: number | null;
  key_minerals?: string[];
};

/**
 * Validates and normalizes nutrition, macronutrients and minerals input.
 * Supports partial update semantics:
 * - undefined => omitted (leave unchanged)
 * - null / "" => cleared
 * - valid value => updated
 */
export function validateAndNormalizeNutrition(
  input: NutritionValidationInput
): NutritionValidationResult {
  // 1. Calories validation
  const calRes = caloriesSchema.safeParse(input.calories_kcal);
  if (!calRes.success) {
    const msg = calRes.error.issues[0]?.message || "Invalid calories value.";
    return { success: false, error: msg };
  }

  // 2. Ingredients validation
  let normalizedIngredients: string[] | undefined = undefined;
  if (input.ingredients !== undefined) {
    if (input.ingredients === null) {
      normalizedIngredients = [];
    } else {
      const ingRes = ingredientsArraySchema.safeParse(input.ingredients);
      if (!ingRes.success) {
        const msg = ingRes.error.issues[0]?.message || "Invalid ingredients list.";
        return { success: false, error: msg };
      }
      normalizedIngredients = ingRes.data;
    }
  }

  // 3. Macros validation
  const proteinRes = proteinSchema.safeParse(input.protein_g);
  if (!proteinRes.success) {
    return { success: false, error: proteinRes.error.issues[0]?.message || "Invalid protein value." };
  }

  const fatRes = fatSchema.safeParse(input.fat_g);
  if (!fatRes.success) {
    return { success: false, error: fatRes.error.issues[0]?.message || "Invalid fat value." };
  }

  const carbsRes = carbsSchema.safeParse(input.carbs_g);
  if (!carbsRes.success) {
    return { success: false, error: carbsRes.error.issues[0]?.message || "Invalid carbohydrates value." };
  }

  const fibreRes = fibreSchema.safeParse(input.fibre_g);
  if (!fibreRes.success) {
    return { success: false, error: fibreRes.error.issues[0]?.message || "Invalid fibre value." };
  }

  const sugarRes = sugarSchema.safeParse(input.sugar_g);
  if (!sugarRes.success) {
    return { success: false, error: sugarRes.error.issues[0]?.message || "Invalid sugar value." };
  }

  const satFatRes = satFatSchema.safeParse(input.sat_fat_g);
  if (!satFatRes.success) {
    return { success: false, error: satFatRes.error.issues[0]?.message || "Invalid saturated fat value." };
  }

  // 4. Key minerals validation
  let normalizedMinerals: string[] | undefined = undefined;
  if (input.key_minerals !== undefined) {
    if (input.key_minerals === null) {
      normalizedMinerals = [];
    } else {
      const minRes = mineralsArraySchema.safeParse(input.key_minerals);
      if (!minRes.success) {
        const msg = minRes.error.issues[0]?.message || "Invalid minerals list.";
        return { success: false, error: msg };
      }
      normalizedMinerals = minRes.data;
    }
  }

  // 5. Soft macro sanity bound check: if P, C, F are present
  const p = proteinRes.data;
  const c = carbsRes.data;
  const f = fatRes.data;
  if (p !== undefined && p !== null && c !== undefined && c !== null && f !== undefined && f !== null) {
    const totalCal = p * 4 + c * 4 + f * 9;
    if (totalCal > 7500) {
      return { success: false, error: "Total calories from protein, carbs, and fat exceed the maximum bound of 7,500 kcal." };
    }
  }

  return {
    success: true,
    calories_kcal: calRes.data,
    ingredients: normalizedIngredients,
    protein_g: proteinRes.data,
    fat_g: fatRes.data,
    carbs_g: carbsRes.data,
    fibre_g: fibreRes.data,
    sugar_g: sugarRes.data,
    sat_fat_g: satFatRes.data,
    key_minerals: normalizedMinerals,
  };
}
