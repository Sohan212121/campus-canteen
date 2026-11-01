import type { MenuItemData } from "@/components/student/item-detail-sheet";
import type { FoodCategory } from "./categories";

export const RECENT_SEARCHES_STORAGE_KEY = "cc_recent_searches_v1";
export const VOICE_SEARCH_ACK_STORAGE_KEY = "cc_voice_search_ack_v1";
export const MAX_RECENT_SEARCHES = 8;

/**
 * Escapes regex special characters to prevent regex injection or broken patterns.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tests whether targetText contains the alias as a whole word, case-insensitively.
 * Prevents false positives such as "rice" matching "price", or "tea" matching "steam".
 */
export function matchesAliasWholeWord(targetText: string, alias: string): boolean {
  if (!targetText || !alias) return false;
  const trimmedAlias = alias.trim();
  if (!trimmedAlias) return false;

  const escaped = escapeRegExp(trimmedAlias);
  // Word boundary regex: (?:\b|^) ... (?:\b|$)
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(targetText);
}

/**
 * Pure function: filters active dishes (including unavailable dishes)
 * whose name, description, or assigned canteen category matches any of the tile's aliases.
 */
export function matchCategoryItems(
  items: MenuItemData[],
  category: FoodCategory,
  categoryMap?: Map<string, string>
): MenuItemData[] {
  if (!items || items.length === 0 || !category) return [];

  return items.filter((item) => {
    // Only active menu items are considered (unavailable dishes are still shown as out of stock)
    if (!item.is_active) return false;

    const categoryName = item.category_id && categoryMap ? categoryMap.get(item.category_id) || "" : "";
    const name = item.name || "";
    const desc = item.description || "";

    return category.aliases.some((alias) => {
      return (
        matchesAliasWholeWord(name, alias) ||
        matchesAliasWholeWord(desc, alias) ||
        matchesAliasWholeWord(categoryName, alias)
      );
    });
  });
}

/**
 * Deterministically picks the best representative dish photo from the canteen's real menu.
 * Ranks active matching items: highest rating_avg first, then alphabetical name.
 * Never uses or generates external photos. Returns null if no photo is available.
 */
export function pickCategoryPhoto(
  items: MenuItemData[],
  category: FoodCategory,
  categoryMap?: Map<string, string>
): string | null {
  const matching = matchCategoryItems(items, category, categoryMap).filter(
    (item) => item.image_url && item.image_url.trim().length > 0
  );

  if (matching.length === 0) return null;

  // Stable deterministic sorting
  const sorted = [...matching].sort((a, b) => {
    const ratingA = a.rating_avg ?? 0;
    const ratingB = b.rating_avg ?? 0;
    if (ratingB !== ratingA) {
      return ratingB - ratingA; // Highest rating first
    }
    return a.name.localeCompare(b.name); // Alphabetical secondary tiebreaker
  });

  return sorted[0]?.image_url || null;
}

export interface CategoryTileData {
  category: FoodCategory;
  matchingCount: number;
  photoUrl: string | null;
}

/**
 * Deterministically sorts category tiles so that categories with matching dishes
 * in the canteen's current menu appear first (sorted by matches count, then label),
 * followed by categories without current dishes.
 */
export function getSortedCategoryTiles(
  categories: FoodCategory[],
  items: MenuItemData[],
  categoryMap?: Map<string, string>
): CategoryTileData[] {
  const computed = categories.map((cat) => {
    const matches = matchCategoryItems(items, cat, categoryMap);
    const photo = pickCategoryPhoto(items, cat, categoryMap);
    return {
      category: cat,
      matchingCount: matches.length,
      photoUrl: photo,
    };
  });

  return computed.sort((a, b) => {
    const hasMatchesA = a.matchingCount > 0;
    const hasMatchesB = b.matchingCount > 0;

    if (hasMatchesA && !hasMatchesB) return -1;
    if (!hasMatchesA && hasMatchesB) return 1;

    // Both have matches or neither has matches: preserve stable alphabetical ordering
    return a.category.label.localeCompare(b.category.label);
  });
}

/**
 * Safe localStorage recent searches reader.
 * Handles corrupt or empty storage gracefully.
 */
export function loadRecentSearches(storage?: Storage): string[] {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!store) return [];

    const raw = store.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((term): term is string => typeof term === "string" && term.trim().length > 0)
      .map((term) => term.trim())
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * Saves a search query to recent searches:
 * - Trims text
 * - Dedupes case-insensitively (moves existing match to the front)
 * - Caps at 8 items
 * - Wrapped in try/catch to protect against private browsing quota errors
 */
export function saveRecentSearch(term: string, storage?: Storage): string[] {
  const trimmed = term.trim();
  if (!trimmed) return loadRecentSearches(storage);

  try {
    const current = loadRecentSearches(storage);
    const lower = trimmed.toLowerCase();

    // Remove any case-insensitive existing duplicates
    const filtered = current.filter((item) => item.toLowerCase() !== lower);

    // Add new term to the beginning
    const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);

    const store = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (store) {
      store.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
    }

    return updated;
  } catch {
    return [];
  }
}

/**
 * Clears recent searches from localStorage.
 */
export function clearRecentSearches(storage?: Storage): void {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (store) {
      store.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export type SearchSuggestionType = "dish" | "category";

export interface SearchSuggestion {
  id: string;
  type: SearchSuggestionType;
  title: string;
  subtitle?: string;
  category?: FoodCategory;
  dish?: MenuItemData;
}

/**
 * Computes live search suggestions (up to limit, default 6) matching query text.
 * Prioritizes prefix matches over contains matches.
 */
export function getSearchSuggestions(
  items: MenuItemData[],
  categories: FoodCategory[],
  rawQuery: string,
  limit = 6
): SearchSuggestion[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: SearchSuggestion[] = [];
  const seenTitles = new Set<string>();

  // 1. Check matching category labels
  for (const cat of categories) {
    const labelLower = cat.label.toLowerCase();
    const isPrefix = labelLower.startsWith(query);
    const hasAliasMatch = cat.aliases.some((a) => a.toLowerCase().includes(query));

    if (isPrefix || hasAliasMatch) {
      results.push({
        id: `cat-${cat.id}`,
        type: "category",
        title: cat.label,
        subtitle: "Food Category",
        category: cat,
      });
      seenTitles.add(labelLower);
    }
  }

  // 2. Check matching active dish names
  const matchingDishes = items.filter((item) => {
    if (!item.is_active) return false;
    const nameLower = item.name.toLowerCase();
    return nameLower.includes(query) || (item.description && item.description.toLowerCase().includes(query));
  });

  // Sort dishes: prefix matches first, then rating
  matchingDishes.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(query);
    const bPrefix = b.name.toLowerCase().startsWith(query);
    if (aPrefix && !bPrefix) return -1;
    if (!aPrefix && bPrefix) return 1;
    return (b.rating_avg ?? 0) - (a.rating_avg ?? 0);
  });

  for (const dish of matchingDishes) {
    const lower = dish.name.toLowerCase();
    if (!seenTitles.has(lower)) {
      results.push({
        id: `dish-${dish.id}`,
        type: "dish",
        title: dish.name,
        subtitle: dish.is_veg ? "Vegetarian" : "Non-Veg",
        dish,
      });
      seenTitles.add(lower);
    }
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

/**
 * Checks whether the voice search browser service notice has already been acknowledged.
 */
export function hasAcknowledgedVoiceNotice(storage?: Storage): boolean {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!store) return false;
    return store.getItem(VOICE_SEARCH_ACK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Marks the voice search browser service notice as acknowledged.
 */
export function acknowledgeVoiceNotice(storage?: Storage): void {
  try {
    const store = storage || (typeof window !== "undefined" ? window.localStorage : undefined);
    if (store) {
      store.setItem(VOICE_SEARCH_ACK_STORAGE_KEY, "1");
    }
  } catch {
    // Ignore storage errors
  }
}
