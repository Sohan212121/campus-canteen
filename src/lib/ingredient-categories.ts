// Pure helper for ingredient classification and keyboard navigation.
// This helper only maps ingredient names to visual display categories for colour-coding and iconography.
// It NEVER states or implies allergen status, dietary suitability (e.g. halal/kosher/vegan), or health/nutrition facts.

export type IngredientCategory =
  | "protein"
  | "dairy"
  | "vegetable"
  | "grain"
  | "sauce_spice"
  | "other";

export interface CategorizedIngredient {
  category: IngredientCategory;
  label: string;
}

// Canonical priority order when positions tie or fallback is needed:
// protein > dairy > vegetable > grain > sauce_spice > other
export const CATEGORY_PRIORITY: readonly IngredientCategory[] = [
  "protein",
  "dairy",
  "vegetable",
  "grain",
  "sauce_spice",
  "other",
] as const;

export interface CategoryMetadata {
  id: IngredientCategory;
  displayName: string;
  dotClass: string;
  badgeClass: string;
  activeRingClass: string;
}

export const CATEGORY_METADATA: Record<IngredientCategory, CategoryMetadata> = {
  protein: {
    id: "protein",
    displayName: "Protein",
    dotClass: "bg-rose-500",
    badgeClass:
      "bg-rose-50 text-rose-950 border-rose-200/90 dark:bg-rose-950/40 dark:text-rose-100 dark:border-rose-800/50 hover:bg-rose-100/70 dark:hover:bg-rose-900/50",
    activeRingClass: "ring-2 ring-rose-500 ring-offset-2 ring-offset-background",
  },
  dairy: {
    id: "dairy",
    displayName: "Dairy",
    dotClass: "bg-sky-500",
    badgeClass:
      "bg-sky-50 text-sky-950 border-sky-200/90 dark:bg-sky-950/40 dark:text-sky-100 dark:border-sky-800/50 hover:bg-sky-100/70 dark:hover:bg-sky-900/50",
    activeRingClass: "ring-2 ring-sky-500 ring-offset-2 ring-offset-background",
  },
  vegetable: {
    id: "vegetable",
    displayName: "Vegetables",
    dotClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-50 text-emerald-950 border-emerald-200/90 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-800/50 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/50",
    activeRingClass: "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background",
  },
  grain: {
    id: "grain",
    displayName: "Grains & Breads",
    dotClass: "bg-amber-500",
    badgeClass:
      "bg-amber-50 text-amber-950 border-amber-200/90 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800/50 hover:bg-amber-100/70 dark:hover:bg-amber-900/50",
    activeRingClass: "ring-2 ring-amber-500 ring-offset-2 ring-offset-background",
  },
  sauce_spice: {
    id: "sauce_spice",
    displayName: "Sauces & Spices",
    dotClass: "bg-orange-500",
    badgeClass:
      "bg-orange-50 text-orange-950 border-orange-200/90 dark:bg-orange-950/40 dark:text-orange-100 dark:border-orange-800/50 hover:bg-orange-100/70 dark:hover:bg-orange-900/50",
    activeRingClass: "ring-2 ring-orange-500 ring-offset-2 ring-offset-background",
  },
  other: {
    id: "other",
    displayName: "Other",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    badgeClass:
      "bg-muted/70 text-foreground border-border dark:bg-muted/50 dark:text-foreground dark:border-border hover:bg-muted dark:hover:bg-muted/80",
    activeRingClass: "ring-2 ring-zinc-500 ring-offset-2 ring-offset-background",
  },
};

// Keyword dictionary tailored for Indian campus canteen items.
// Specific compound phrases listed first to capture multi-word terms.
const CATEGORY_KEYWORDS: Record<Exclude<IngredientCategory, "other">, string[]> = {
  protein: [
    "chicken",
    "egg",
    "mutton",
    "fish",
    "prawn",
    "paneer",
    "tofu",
    "soya",
    "soy",
    "dal",
    "daal",
    "lentil",
    "chickpea",
    "chana",
    "rajma",
    "bean",
    "peanut",
    "groundnut",
    "cashew",
    "kaju",
    "moong",
    "masoor",
    "toor",
    "chana dal",
    "urad dal",
    "mutton keema",
    "chicken keema",
  ],
  dairy: [
    "milk",
    "curd",
    "dahi",
    "yogurt",
    "yoghurt",
    "cheese",
    "butter",
    "makkhan",
    "ghee",
    "cream",
    "malai",
    "khoya",
    "mawa",
    "paneer whey",
  ],
  vegetable: [
    "coconut",
    "nariyal",
    "onion",
    "pyaz",
    "tomato",
    "tamatar",
    "potato",
    "aloo",
    "capsicum",
    "bell pepper",
    "carrot",
    "gajar",
    "cabbage",
    "patta gobhi",
    "peas",
    "matar",
    "spinach",
    "palak",
    "cucumber",
    "khira",
    "beetroot",
    "corn",
    "mushroom",
    "ginger",
    "adrak",
    "garlic",
    "lahsun",
    "chilli",
    "chili",
    "mirch",
    "green chilli",
    "coriander",
    "dhaniya",
    "cilantro",
    "mint",
    "pudina",
    "lettuce",
    "methi",
    "fenugreek leaves",
    "curry leaves",
    "kadi patta",
    "cauliflower",
    "gobhi",
    "brinjal",
    "eggplant",
    "baingan",
  ],
  grain: [
    "flattened rice",
    "dosa batter",
    "idli batter",
    "rice",
    "chawal",
    "wheat",
    "gehun",
    "flour",
    "atta",
    "maida",
    "paratha",
    "roti",
    "chapati",
    "naan",
    "kulcha",
    "bread",
    "bun",
    "pav",
    "pao",
    "pasta",
    "macaroni",
    "noodle",
    "oat",
    "oats",
    "semolina",
    "suji",
    "sooji",
    "rava",
    "poha",
    "papad",
    "papadum",
    "urad",
    "besan",
  ],
  sauce_spice: [
    "mayonnaise",
    "mayo",
    "sauce",
    "ketchup",
    "chutney",
    "masala",
    "spice",
    "pepper",
    "black pepper",
    "salt",
    "black salt",
    "kala namak",
    "sugar",
    "vinegar",
    "oil",
    "mustard oil",
    "refined oil",
    "lemon",
    "nimbu",
    "lime",
    "juice",
    "paste",
    "seasoning",
    "herb",
    "cumin",
    "jeera",
    "cardamom",
    "elaichi",
    "clove",
    "laung",
    "cinnamon",
    "dalchini",
    "turmeric",
    "haldi",
    "mustard",
    "rai",
    "pickle",
    "achaar",
    "achar",
    "sambar",
    "sambhar",
    "podi",
    "gunpowder",
    "chicory",
    "tea",
    "chai",
    "coffee",
  ],
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface MatchCandidate {
  category: Exclude<IngredientCategory, "other">;
  startIndex: number;
  endIndex: number;
  keyword: string;
}

/**
 * Categorise an ingredient string.
 *
 * Rules:
 * 1. Safe on odd/missing input (never throws).
 * 2. Text in parentheses/brackets is stripped for keyword matching, but preserved in label.
 * 3. Categorises by the LAST noun/term match first (e.g., "butter chicken" -> chicken [protein], "butter roti" -> roti [grain]).
 * 4. In case of position ties, falls back to priority order:
 *    protein > dairy > vegetable > grain > sauce_spice > other.
 * 5. Supports simple plurals (e.g. egg/eggs, peanut/peanuts, noodle/noodles).
 */
export function categorizeIngredient(rawName: unknown): CategorizedIngredient {
  if (rawName == null) {
    return { category: "other", label: "" };
  }

  const label = typeof rawName === "string" ? rawName.trim() : String(rawName).trim();
  if (!label) {
    return { category: "other", label: "" };
  }

  // Strip text within brackets for matching purpose only
  const cleanForMatching = label
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .toLowerCase();

  const candidates: MatchCandidate[] = [];

  const categories = Object.keys(CATEGORY_KEYWORDS) as Array<Exclude<IngredientCategory, "other">>;

  for (const cat of categories) {
    const keywords = CATEGORY_KEYWORDS[cat];
    for (const kw of keywords) {
      const escaped = escapeRegex(kw.toLowerCase());
      // Handle optional plural suffix: s, es
      const pattern = new RegExp(`\\b${escaped}(?:es|s)?\\b`, "gi");

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(cleanForMatching)) !== null) {
        candidates.push({
          category: cat,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          keyword: kw,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { category: "other", label };
  }

  // 1. Sort primarily by furthest right (highest endIndex) to respect the "last noun" rule
  // 2. If end positions match (e.g. nested keywords or phrases ending at the same point),
  //    prefer longer matched phrases (e.g. "flattened rice" over "rice")
  // 3. If still tied, follow canonical priority order: protein > dairy > vegetable > grain > sauce_spice
  const priorityIndex = (cat: IngredientCategory) => CATEGORY_PRIORITY.indexOf(cat);

  candidates.sort((a, b) => {
    if (b.endIndex !== a.endIndex) {
      return b.endIndex - a.endIndex;
    }
    const lenA = a.endIndex - a.startIndex;
    const lenB = b.endIndex - b.startIndex;
    if (lenB !== lenA) {
      return lenB - lenA; // longer match wins
    }
    return priorityIndex(a.category) - priorityIndex(b.category);
  });

  return {
    category: candidates[0].category,
    label,
  };
}

/**
 * Builds the list of unique categories present in the given ingredient list,
 * preserving canonical priority order.
 */
export function getPresentCategories(ingredients: string[]): CategoryMetadata[] {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return [];
  }

  const presentSet = new Set<IngredientCategory>();
  for (const item of ingredients) {
    const { category } = categorizeIngredient(item);
    presentSet.add(category);
  }

  // Return in canonical order
  return CATEGORY_PRIORITY.filter((cat) => presentSet.has(cat)).map((cat) => CATEGORY_METADATA[cat]);
}

/**
 * Pure helper for roving tabindex grid keyboard navigation.
 * Calculates next focused index based on key press in a grid of `columns` width.
 */
export function calculateGridRovingIndex(
  currentIndex: number,
  total: number,
  columns: number,
  key: string
): number {
  if (total <= 0) return 0;
  const cols = Math.max(1, columns);

  switch (key) {
    case "ArrowRight":
      return (currentIndex + 1) % total;
    case "ArrowLeft":
      return (currentIndex - 1 + total) % total;
    case "ArrowDown": {
      const next = currentIndex + cols;
      return next < total ? next : currentIndex;
    }
    case "ArrowUp": {
      const prev = currentIndex - cols;
      return prev >= 0 ? prev : currentIndex;
    }
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return currentIndex;
  }
}
