import { describe, it, expect, beforeEach, vi } from "vitest";

// Set up localStorage mock before importing store
const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    mockStorage[key] = val;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import {
  useCartStore,
  MAX_ITEM_QUANTITY,
  CART_STORAGE_KEY,
} from "@/lib/cart-store";

describe("useCartStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useCartStore.setState({
      userId: null,
      items: [],
      hasHydrated: true,
    });
  });

  it("adds an item to empty cart", () => {
    const { addItem } = useCartStore.getState();
    addItem("item-1", 2);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual({
      menu_item_id: "item-1",
      quantity: 2,
    });
    expect(state.getTotalItemCount()).toBe(2);
  });

  it("merges quantities when adding an existing item", () => {
    const { addItem } = useCartStore.getState();
    addItem("item-1", 2);
    addItem("item-1", 3);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(5);
    expect(state.getTotalItemCount()).toBe(5);
  });

  it("enforces MAX_ITEM_QUANTITY limit (10) when adding items", () => {
    const { addItem } = useCartStore.getState();
    addItem("item-1", 8);
    addItem("item-1", 5); // 8 + 5 = 13 -> caps at 10

    const state = useCartStore.getState();
    expect(state.items[0].quantity).toBe(MAX_ITEM_QUANTITY);
    expect(state.items[0].quantity).toBe(10);
  });

  it("updates item quantity and clamps to MAX_ITEM_QUANTITY", () => {
    const { addItem, updateQuantity } = useCartStore.getState();
    addItem("item-1", 2);
    updateQuantity("item-1", 7);

    expect(useCartStore.getState().items[0].quantity).toBe(7);

    updateQuantity("item-1", 15);
    expect(useCartStore.getState().items[0].quantity).toBe(10);
  });

  it("removes an item if quantity is set to 0 or negative", () => {
    const { addItem, updateQuantity } = useCartStore.getState();
    addItem("item-1", 2);
    addItem("item-2", 3);

    updateQuantity("item-1", 0);
    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].menu_item_id).toBe("item-2");
  });

  it("removes an item via removeItem", () => {
    const { addItem, removeItem } = useCartStore.getState();
    addItem("item-1", 2);
    addItem("item-2", 1);

    removeItem("item-1");
    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].menu_item_id).toBe("item-2");
  });

  it("clears all items in the cart", () => {
    const { addItem, clearCart } = useCartStore.getState();
    addItem("item-1", 2);
    addItem("item-2", 3);

    clearCart();
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().getTotalItemCount()).toBe(0);
  });

  it("resets cart when switching to a different user", () => {
    const { syncUser, addItem } = useCartStore.getState();
    syncUser("user-a");
    addItem("item-1", 2);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().userId).toBe("user-a");

    // Switch user
    syncUser("user-b");
    expect(useCartStore.getState().userId).toBe("user-b");
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("clears cart when user logs out (null user)", () => {
    const { syncUser, addItem } = useCartStore.getState();
    syncUser("user-a");
    addItem("item-1", 3);

    syncUser(null);
    expect(useCartStore.getState().userId).toBeNull();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it("uses the specified CART_STORAGE_KEY constant", () => {
    expect(CART_STORAGE_KEY).toBe("campus-canteen-cart");
  });

  it("correctly reports item quantity via getItemQuantity", () => {
    const { addItem, getItemQuantity } = useCartStore.getState();
    addItem("item-1", 4);

    expect(getItemQuantity("item-1")).toBe(4);
    expect(getItemQuantity("non-existent")).toBe(0);
  });
});
