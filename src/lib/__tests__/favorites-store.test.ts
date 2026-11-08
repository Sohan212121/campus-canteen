import { describe, it, expect, beforeEach, vi } from "vitest";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { useFavoritesStore } from "@/lib/favorites-store";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

const MOCK_ITEM_1: MenuItemData = {
  id: "item-1",
  canteen_id: "canteen-1",
  category_id: "cat-1",
  name: "Paneer Kathi Roll",
  description: "Tender cottage cheese with peppers",
  price_paise: 8000,
  image_url: "/images/paneer.jpg",
  is_veg: true,
  is_available: true,
  stock: 10,
  prep_minutes: 5,
  is_active: true,
  rating_avg: 4.8,
  rating_count: 24,
  calories_kcal: 450,
  protein_g: 24,
};

const MOCK_ITEM_2: MenuItemData = {
  id: "item-2",
  canteen_id: "canteen-1",
  category_id: "cat-1",
  name: "Chicken Kathi Roll",
  description: "Succulent spiced chicken roll",
  price_paise: 9500,
  image_url: "/images/chicken.jpg",
  is_veg: false,
  is_available: true,
  stock: 8,
  prep_minutes: 6,
  is_active: true,
  rating_avg: 4.9,
  rating_count: 42,
  calories_kcal: 480,
  protein_g: 28,
};

describe("useFavoritesStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useFavoritesStore.getState().clearFavorites();
  });

  it("starts with empty favorites", () => {
    const store = useFavoritesStore.getState();
    expect(store.getFavoritesCount()).toBe(0);
    expect(store.getFavoritesList()).toEqual([]);
    expect(store.isFavorite("item-1")).toBe(false);
  });

  it("adds and toggles items in favorites", () => {
    const store = useFavoritesStore.getState();

    // Toggle on
    const added = store.toggleFavorite(MOCK_ITEM_1);
    expect(added).toBe(true);
    expect(useFavoritesStore.getState().isFavorite("item-1")).toBe(true);
    expect(useFavoritesStore.getState().getFavoritesCount()).toBe(1);

    const list = useFavoritesStore.getState().getFavoritesList();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("item-1");
    expect(list[0].name).toBe("Paneer Kathi Roll");

    // Toggle off
    const removed = useFavoritesStore.getState().toggleFavorite(MOCK_ITEM_1);
    expect(removed).toBe(false);
    expect(useFavoritesStore.getState().isFavorite("item-1")).toBe(false);
    expect(useFavoritesStore.getState().getFavoritesCount()).toBe(0);
  });

  it("supports multiple items and maintains order by recent", async () => {
    const store = useFavoritesStore.getState();

    store.addFavorite(MOCK_ITEM_1);
    // Add small delay for timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    store.addFavorite(MOCK_ITEM_2);

    expect(useFavoritesStore.getState().getFavoritesCount()).toBe(2);
    expect(useFavoritesStore.getState().isFavorite("item-1")).toBe(true);
    expect(useFavoritesStore.getState().isFavorite("item-2")).toBe(true);

    const list = useFavoritesStore.getState().getFavoritesList();
    // Item 2 was added later, should appear first
    expect(list[0].id).toBe("item-2");
    expect(list[1].id).toBe("item-1");

    // Explicit remove
    useFavoritesStore.getState().removeFavorite("item-1");
    expect(useFavoritesStore.getState().getFavoritesCount()).toBe(1);
    expect(useFavoritesStore.getState().isFavorite("item-1")).toBe(false);
    expect(useFavoritesStore.getState().isFavorite("item-2")).toBe(true);
  });
});
