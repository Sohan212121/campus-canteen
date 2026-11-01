import { describe, it, expect, beforeEach } from "vitest";
import type { MenuItemData } from "@/components/student/item-detail-sheet";
import {
  FOOD_CATEGORIES,
} from "@/lib/search/categories";
import {
  matchesAliasWholeWord,
  matchCategoryItems,
  pickCategoryPhoto,
  getSortedCategoryTiles,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  getSearchSuggestions,
  hasAcknowledgedVoiceNotice,
  acknowledgeVoiceNotice,
  RECENT_SEARCHES_STORAGE_KEY,
  VOICE_SEARCH_ACK_STORAGE_KEY,
} from "@/lib/search/search-helpers";

// In-memory mock storage for isolated testing
class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] || null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

// Sample test dishes
const mockDishes: MenuItemData[] = [
  {
    id: "dish-1",
    canteen_id: "canteen-1",
    category_id: "cat-lunch",
    name: "Hyderabadi Dum Biryani",
    description: "Slow cooked basmati rice with fragrant saffron",
    price_paise: 12000,
    image_url: "https://example.com/biryani.jpg",
    is_veg: true,
    is_available: true,
    stock: 20,
    prep_minutes: 10,
    is_active: true,
    rating_avg: 4.8,
    rating_count: 50,
  },
  {
    id: "dish-2",
    canteen_id: "canteen-1",
    category_id: "cat-breakfast",
    name: "Masala Dosa",
    description: "Crisp golden crepe with spiced potato filling",
    price_paise: 5000,
    image_url: "https://example.com/dosa.jpg",
    is_veg: true,
    is_available: true,
    stock: 30,
    prep_minutes: 5,
    is_active: true,
    rating_avg: 4.6,
    rating_count: 40,
  },
  {
    id: "dish-3",
    canteen_id: "canteen-1",
    category_id: "cat-breakfast",
    name: "Plain Dosa Special",
    description: "Simple crepe served with sambar",
    price_paise: 4000,
    image_url: "https://example.com/plain-dosa.jpg",
    is_veg: true,
    is_available: true,
    stock: 15,
    prep_minutes: 5,
    is_active: true,
    rating_avg: 4.9, // Higher rating than Masala Dosa
    rating_count: 80,
  },
  {
    id: "dish-4",
    canteen_id: "canteen-1",
    category_id: "cat-snacks",
    name: "Crispy Samosa (2 pcs)",
    description: "Deep fried pastry with potatoes and peas",
    price_paise: 3000,
    image_url: null, // No image
    is_veg: true,
    is_available: false, // Out of stock
    stock: 0,
    prep_minutes: 3,
    is_active: true,
    rating_avg: 4.5,
    rating_count: 30,
  },
  {
    id: "dish-inactive",
    canteen_id: "canteen-1",
    category_id: "cat-lunch",
    name: "Inactive Biryani",
    description: "Should never be matched",
    price_paise: 10000,
    image_url: "https://example.com/inactive.jpg",
    is_veg: true,
    is_available: true,
    stock: 10,
    prep_minutes: 5,
    is_active: false, // Inactive
    rating_avg: 5.0,
    rating_count: 10,
  },
];

const mockCategoryMap = new Map<string, string>([
  ["cat-lunch", "Lunch & Thali"],
  ["cat-breakfast", "Breakfast"],
  ["cat-snacks", "Snacks & Chaat"],
]);

describe("Search Takeover Helpers: Alias & Whole Word Matching", () => {
  it("matches whole words case-insensitively", () => {
    expect(matchesAliasWholeWord("Veg Fried Rice", "rice")).toBe(true);
    expect(matchesAliasWholeWord("STEAMED RICE BOWL", "rice")).toBe(true);
    expect(matchesAliasWholeWord("Masala Dosa", "dosa")).toBe(true);
  });

  it("prevents false-positive substring matches (e.g., 'rice' in 'price')", () => {
    expect(matchesAliasWholeWord("Special Price Combo", "rice")).toBe(false);
    expect(matchesAliasWholeWord("Steaming Hot Chai", "tea")).toBe(false);
    expect(matchesAliasWholeWord("Apples and Pears", "apple")).toBe(false);
  });

  it("handles punctuation and edge boundaries gracefully", () => {
    expect(matchesAliasWholeWord("Samosa (2 pcs)", "samosa")).toBe(true);
    expect(matchesAliasWholeWord("Chai, Coffee & Snacks", "chai")).toBe(true);
    expect(matchesAliasWholeWord("Chai, Coffee & Snacks", "coffee")).toBe(true);
    expect(matchesAliasWholeWord("", "dosa")).toBe(false);
    expect(matchesAliasWholeWord("Dosa", "")).toBe(false);
  });
});

describe("Search Takeover Helpers: matchCategoryItems", () => {
  const biryaniCategory = FOOD_CATEGORIES.find((c) => c.id === "biryani")!;
  const dosaCategory = FOOD_CATEGORIES.find((c) => c.id === "dosa")!;
  const samosaCategory = FOOD_CATEGORIES.find((c) => c.id === "samosa")!;
  const pizzaCategory = FOOD_CATEGORIES.find((c) => c.id === "pizza")!;

  it("returns matching active items including unavailable/out of stock items", () => {
    // Samosa is is_available=false, but is_active=true -> must be included so student sees it
    const matches = matchCategoryItems(mockDishes, samosaCategory, mockCategoryMap);
    expect(matches.length).toBe(1);
    expect(matches[0].name).toBe("Crispy Samosa (2 pcs)");
    expect(matches[0].is_available).toBe(false);
  });

  it("excludes inactive items (is_active=false)", () => {
    const matches = matchCategoryItems(mockDishes, biryaniCategory, mockCategoryMap);
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe("dish-1");
    expect(matches.some((d) => d.id === "dish-inactive")).toBe(false);
  });

  it("returns multiple matches for categories like Dosa", () => {
    const matches = matchCategoryItems(mockDishes, dosaCategory, mockCategoryMap);
    expect(matches.length).toBe(2);
    expect(matches.map((d) => d.id)).toEqual(["dish-2", "dish-3"]);
  });

  it("returns empty array for categories with no matching dishes", () => {
    const matches = matchCategoryItems(mockDishes, pizzaCategory, mockCategoryMap);
    expect(matches).toEqual([]);
  });
});

describe("Search Takeover Helpers: pickCategoryPhoto (Deterministic Canteen Photo Selection)", () => {
  const dosaCategory = FOOD_CATEGORIES.find((c) => c.id === "dosa")!;
  const samosaCategory = FOOD_CATEGORIES.find((c) => c.id === "samosa")!;
  const pizzaCategory = FOOD_CATEGORIES.find((c) => c.id === "pizza")!;

  it("deterministically picks the photo of the highest rated matching dish", () => {
    // Plain Dosa Special has rating 4.9, Masala Dosa has rating 4.6
    const photo = pickCategoryPhoto(mockDishes, dosaCategory, mockCategoryMap);
    expect(photo).toBe("https://example.com/plain-dosa.jpg");
  });

  it("returns null if all matching dishes have null image_url", () => {
    // Samosa has image_url: null
    const photo = pickCategoryPhoto(mockDishes, samosaCategory, mockCategoryMap);
    expect(photo).toBeNull();
  });

  it("returns null if category has zero matching dishes", () => {
    const photo = pickCategoryPhoto(mockDishes, pizzaCategory, mockCategoryMap);
    expect(photo).toBeNull();
  });
});

describe("Search Takeover Helpers: getSortedCategoryTiles (Matching Real Dishes First)", () => {
  it("sorts categories with available real canteen dishes first", () => {
    const sorted = getSortedCategoryTiles(FOOD_CATEGORIES, mockDishes, mockCategoryMap);

    // Biryani, Dosa, Samosa have matches in mockDishes -> they must appear before Pizza, Burger, etc.
    const matchingTiles = sorted.filter((t) => t.matchingCount > 0);
    const nonMatchingTiles = sorted.filter((t) => t.matchingCount === 0);

    expect(matchingTiles.length).toBeGreaterThan(0);
    expect(nonMatchingTiles.length).toBeGreaterThan(0);

    // Verify all matching tiles precede all non-matching tiles
    const firstNonMatchingIdx = sorted.findIndex((t) => t.matchingCount === 0);
    const lastMatchingIdx = sorted.findLastIndex((t) => t.matchingCount > 0);

    expect(lastMatchingIdx).toBeLessThan(firstNonMatchingIdx);
  });
});

describe("Search Takeover Helpers: Recent Searches Storage Operations", () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it("returns empty array when storage is empty or corrupted", () => {
    expect(loadRecentSearches(mockStorage)).toEqual([]);

    mockStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, "{ broken json ]");
    expect(loadRecentSearches(mockStorage)).toEqual([]);
  });

  it("saves, trims and dedupes searches case-insensitively", () => {
    saveRecentSearch("  Biryani  ", mockStorage);
    saveRecentSearch("Dosa", mockStorage);
    const result = saveRecentSearch("BIRYANI", mockStorage);

    // BIRYANI was moved to the front and deduped
    expect(result).toEqual(["BIRYANI", "Dosa"]);
  });

  it("caps recent searches at 8 entries", () => {
    for (let i = 1; i <= 12; i++) {
      saveRecentSearch(`Item ${i}`, mockStorage);
    }
    const stored = loadRecentSearches(mockStorage);
    expect(stored.length).toBe(8);
    expect(stored[0]).toBe("Item 12");
  });

  it("clears recent searches", () => {
    saveRecentSearch("Samosa", mockStorage);
    expect(loadRecentSearches(mockStorage).length).toBe(1);

    clearRecentSearches(mockStorage);
    expect(loadRecentSearches(mockStorage)).toEqual([]);
  });
});

describe("Search Takeover Helpers: Live Suggestions", () => {
  it("suggests matching categories and dish names", () => {
    const suggestions = getSearchSuggestions(mockDishes, FOOD_CATEGORIES, "do", 6);
    expect(suggestions.length).toBeGreaterThan(0);

    // Category "Dosa" should be suggested
    const catSuggestion = suggestions.find((s) => s.type === "category");
    expect(catSuggestion?.title).toBe("Dosa");

    // Dishes starting with or containing "do" should be suggested
    const dishSuggestions = suggestions.filter((s) => s.type === "dish");
    expect(dishSuggestions.some((s) => s.title.includes("Dosa"))).toBe(true);
  });

  it("returns empty suggestions for empty or whitespace query", () => {
    expect(getSearchSuggestions(mockDishes, FOOD_CATEGORIES, "", 6)).toEqual([]);
    expect(getSearchSuggestions(mockDishes, FOOD_CATEGORIES, "   ", 6)).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const suggestions = getSearchSuggestions(mockDishes, FOOD_CATEGORIES, "a", 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });
});

describe("Search Takeover Helpers: Voice Search Acknowledgement", () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it("initially returns false when not acknowledged", () => {
    expect(hasAcknowledgedVoiceNotice(mockStorage)).toBe(false);
  });

  it("records acknowledgement and returns true", () => {
    acknowledgeVoiceNotice(mockStorage);
    expect(hasAcknowledgedVoiceNotice(mockStorage)).toBe(true);
    expect(mockStorage.getItem(VOICE_SEARCH_ACK_STORAGE_KEY)).toBe("1");
  });
});
