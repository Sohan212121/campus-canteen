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

export interface NutritionValidationInput {
  calories_kcal?: number | string | null;
  ingredients?: string[] | null;
}

export type NutritionValidationResult = {
  success: boolean;
  error?: string;
  calories_kcal?: number | null;
  ingredients?: string[];
};

/**
 * Validates and normalizes calories and ingredients input.
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

  return {
    success: true,
    calories_kcal: calRes.data,
    ingredients: normalizedIngredients,
  };
}
