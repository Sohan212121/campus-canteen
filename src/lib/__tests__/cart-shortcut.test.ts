import { describe, it, expect } from "vitest";
import {
  calculateEstimatedCartTotal,
  calculateEstimatedCartTotalFromRegistry,
  registerMenuItemPrices,
  clearRegisteredMenuItemPrices,
  formatCartShortcutVisibleLabel,
  getCartShortcutAriaLabel,
  getCartShortcutAnnouncement,
  shouldShowCartShortcut,
} from "@/lib/cart-shortcut";

describe("calculateEstimatedCartTotal", () => {
  const menuItems = [
    { id: "item-1", price_paise: 2500 }, // ₹25
    { id: "item-2", price_paise: 4000 }, // ₹40
    { id: "item-3", price_paise: 1500 }, // ₹15
  ];

  it("returns 0 for empty cart or empty menu", () => {
    expect(calculateEstimatedCartTotal([], menuItems)).toBe(0);
    expect(calculateEstimatedCartTotal([{ menu_item_id: "item-1", quantity: 2 }], [])).toBe(0);
  });

  it("computes estimated sum accurately for single item", () => {
    const cart = [{ menu_item_id: "item-1", quantity: 2 }];
    expect(calculateEstimatedCartTotal(cart, menuItems)).toBe(5000);
  });

  it("computes estimated sum for multiple items", () => {
    const cart = [
      { menu_item_id: "item-1", quantity: 2 }, // 5000
      { menu_item_id: "item-2", quantity: 1 }, // 4000
      { menu_item_id: "item-3", quantity: 3 }, // 4500
    ];
    expect(calculateEstimatedCartTotal(cart, menuItems)).toBe(13500); // ₹135
  });

  it("skips unknown menu items safely", () => {
    const cart = [
      { menu_item_id: "item-1", quantity: 1 }, // 2500
      { menu_item_id: "unknown-id", quantity: 5 }, // skipped
    ];
    expect(calculateEstimatedCartTotal(cart, menuItems)).toBe(2500);
  });

  it("ignores zero or negative quantities", () => {
    const cart = [
      { menu_item_id: "item-1", quantity: 0 },
      { menu_item_id: "item-2", quantity: -2 },
      { menu_item_id: "item-3", quantity: 1 }, // 1500
    ];
    expect(calculateEstimatedCartTotal(cart, menuItems)).toBe(1500);
  });
});

describe("formatCartShortcutVisibleLabel", () => {
  it("formats single item visible label accurately", () => {
    expect(formatCartShortcutVisibleLabel(1, 2500)).toBe("Go to Cart · 1 item · ₹25");
  });

  it("formats multiple items visible label accurately", () => {
    expect(formatCartShortcutVisibleLabel(3, 12000)).toBe("Go to Cart · 3 items · ₹120");
  });
});

describe("getCartShortcutAriaLabel", () => {
  it("formats single item with estimated total", () => {
    expect(getCartShortcutAriaLabel(1, 2500)).toBe("View cart, 1 item, estimated total ₹25");
  });

  it("formats multiple items with estimated total", () => {
    expect(getCartShortcutAriaLabel(4, 12000)).toBe("View cart, 4 items, estimated total ₹120");
  });
});

describe("getCartShortcutAnnouncement", () => {
  it("returns empty string if count is <= 0", () => {
    expect(getCartShortcutAnnouncement(0)).toBe("");
  });

  it("announces 1 item in cart", () => {
    expect(getCartShortcutAnnouncement(1)).toBe("Added to cart. 1 item in cart.");
  });

  it("announces multiple items in cart", () => {
    expect(getCartShortcutAnnouncement(3)).toBe("Added to cart. 3 items in cart.");
  });
});

describe("shouldShowCartShortcut", () => {
  it("hides when not hydrated", () => {
    expect(
      shouldShowCartShortcut({
        hasHydrated: false,
        totalCount: 3,
        pathname: "/menu",
      })
    ).toBe(false);
  });

  it("hides when cart count is 0", () => {
    expect(
      shouldShowCartShortcut({
        hasHydrated: true,
        totalCount: 0,
        pathname: "/menu",
      })
    ).toBe(false);
  });

  it("hides on /cart and /checkout routes", () => {
    expect(
      shouldShowCartShortcut({
        hasHydrated: true,
        totalCount: 2,
        pathname: "/cart",
      })
    ).toBe(false);

    expect(
      shouldShowCartShortcut({
        hasHydrated: true,
        totalCount: 2,
        pathname: "/checkout",
      })
    ).toBe(false);
  });

  it("hides when item detail sheet is open", () => {
    expect(
      shouldShowCartShortcut({
        hasHydrated: true,
        totalCount: 2,
        pathname: "/menu",
        isDetailSheetOpen: true,
      })
    ).toBe(false);
  });

  it("shows when hydrated, count > 0, sheet is closed, and on /menu", () => {
    expect(
      shouldShowCartShortcut({
        hasHydrated: true,
        totalCount: 2,
        pathname: "/menu",
        isDetailSheetOpen: false,
      })
    ).toBe(true);
  });
});

describe("In-Memory Menu Item Price Registry", () => {
  it("computes estimated total from registered prices when menuItems prop is omitted", () => {
    clearRegisteredMenuItemPrices();
    registerMenuItemPrices([
      { id: "samosa-id", price_paise: 4000 },
      { id: "roll-id", price_paise: 9500 },
    ]);

    const cart = [
      { menu_item_id: "samosa-id", quantity: 1 },
      { menu_item_id: "roll-id", quantity: 2 },
    ];

    expect(calculateEstimatedCartTotalFromRegistry(cart)).toBe(23000); // 4000 + 2*9500 = 23000 (₹230)
  });

  it("safely returns 0 when cart item is not in registry", () => {
    clearRegisteredMenuItemPrices();
    const cart = [{ menu_item_id: "unregistered-id", quantity: 1 }];
    expect(calculateEstimatedCartTotalFromRegistry(cart)).toBe(0);
  });
});
