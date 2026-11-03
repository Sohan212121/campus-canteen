import { describe, it, expect } from "vitest";
import {
  normalizeNavPath,
  isBottomNavActive,
  getActiveBottomNavTab,
  isProfileHeaderActive,
} from "@/lib/student-nav";

describe("normalizeNavPath", () => {
  it("handles null, undefined, and empty string", () => {
    expect(normalizeNavPath(null)).toBe("");
    expect(normalizeNavPath(undefined)).toBe("");
    expect(normalizeNavPath("")).toBe("");
    expect(normalizeNavPath("   ")).toBe("");
  });

  it("normalizes root path", () => {
    expect(normalizeNavPath("/")).toBe("/");
    expect(normalizeNavPath("///")).toBe("/");
    expect(normalizeNavPath("/?foo=bar")).toBe("/");
    expect(normalizeNavPath("/#top")).toBe("/");
  });

  it("strips trailing slashes, query params, and hashes", () => {
    expect(normalizeNavPath("/menu/")).toBe("/menu");
    expect(normalizeNavPath("/menu///")).toBe("/menu");
    expect(normalizeNavPath("/menu?category=hot")).toBe("/menu");
    expect(normalizeNavPath("/menu/?category=hot#section")).toBe("/menu");
    expect(normalizeNavPath("/healthy/score/")).toBe("/healthy/score");
  });

  it("ensures leading slash if missing", () => {
    expect(normalizeNavPath("menu")).toBe("/menu");
    expect(normalizeNavPath("healthy/score")).toBe("/healthy/score");
  });
});

describe("isBottomNavActive - Strict Boundary Matching", () => {
  describe("Home tab (/)", () => {
    it("is active strictly on root /", () => {
      expect(isBottomNavActive("/", "/")).toBe(true);
      expect(isBottomNavActive("/", "/?guest=true")).toBe(true);
      expect(isBottomNavActive("/", "/#hero")).toBe(true);
    });

    it("is not active on any sub-routes", () => {
      expect(isBottomNavActive("/", "/menu")).toBe(false);
      expect(isBottomNavActive("/", "/healthy")).toBe(false);
      expect(isBottomNavActive("/", "/cart")).toBe(false);
      expect(isBottomNavActive("/", "/orders")).toBe(false);
      expect(isBottomNavActive("/", "/profile")).toBe(false);
    });
  });

  describe("Menu tab (/menu)", () => {
    it("is active on exact /menu and subpaths /menu/*", () => {
      expect(isBottomNavActive("/menu", "/menu")).toBe(true);
      expect(isBottomNavActive("/menu", "/menu/")).toBe(true);
      expect(isBottomNavActive("/menu", "/menu/samosa")).toBe(true);
      expect(isBottomNavActive("/menu", "/menu/category/snacks")).toBe(true);
    });

    it("does not match prefix false positives (/menus, /menu-items)", () => {
      expect(isBottomNavActive("/menu", "/menus")).toBe(false);
      expect(isBottomNavActive("/menu", "/menu-items")).toBe(false);
      expect(isBottomNavActive("/menu", "/menucard")).toBe(false);
    });
  });

  describe("Healthy tab (/healthy)", () => {
    it("is active on exact /healthy, /healthy/, and /healthy/score", () => {
      expect(isBottomNavActive("/healthy", "/healthy")).toBe(true);
      expect(isBottomNavActive("/healthy", "/healthy/")).toBe(true);
      expect(isBottomNavActive("/healthy", "/healthy/score")).toBe(true);
      expect(isBottomNavActive("/healthy", "/healthy/score/")).toBe(true);
      expect(isBottomNavActive("/healthy", "/healthy/nutrition/123")).toBe(true);
    });

    it("does not match prefix false positives (/healthy-x, /healthyfuel)", () => {
      expect(isBottomNavActive("/healthy", "/healthy-x")).toBe(false);
      expect(isBottomNavActive("/healthy", "/healthyfuel")).toBe(false);
      expect(isBottomNavActive("/healthy", "/healthydiet")).toBe(false);
    });
  });

  describe("Cart tab (/cart)", () => {
    it("is active on /cart and /cart/*", () => {
      expect(isBottomNavActive("/cart", "/cart")).toBe(true);
      expect(isBottomNavActive("/cart", "/cart/")).toBe(true);
      expect(isBottomNavActive("/cart", "/cart/review")).toBe(true);
    });

    it("does not match /cart-items or /checkout", () => {
      expect(isBottomNavActive("/cart", "/cart-items")).toBe(false);
      expect(isBottomNavActive("/cart", "/checkout")).toBe(false);
    });
  });

  describe("Orders tab (/orders)", () => {
    it("is active on /orders and /orders/123", () => {
      expect(isBottomNavActive("/orders", "/orders")).toBe(true);
      expect(isBottomNavActive("/orders", "/orders/")).toBe(true);
      expect(isBottomNavActive("/orders", "/orders/123")).toBe(true);
      expect(isBottomNavActive("/orders", "/orders/token-xyz")).toBe(true);
    });

    it("does not match prefix false positives (/orders-history)", () => {
      expect(isBottomNavActive("/orders", "/orders-history")).toBe(false);
      expect(isBottomNavActive("/orders", "/orderslist")).toBe(false);
    });
  });

  describe("Unhighlighted Boundary Routes", () => {
    it("/profile highlights NO bottom tab", () => {
      expect(isBottomNavActive("/", "/profile")).toBe(false);
      expect(isBottomNavActive("/menu", "/profile")).toBe(false);
      expect(isBottomNavActive("/healthy", "/profile")).toBe(false);
      expect(isBottomNavActive("/cart", "/profile")).toBe(false);
      expect(isBottomNavActive("/orders", "/profile")).toBe(false);

      expect(isBottomNavActive("/orders", "/profile/edit")).toBe(false);
    });

    it("/notifications highlights NO bottom tab", () => {
      expect(isBottomNavActive("/", "/notifications")).toBe(false);
      expect(isBottomNavActive("/menu", "/notifications")).toBe(false);
      expect(isBottomNavActive("/healthy", "/notifications")).toBe(false);
      expect(isBottomNavActive("/cart", "/notifications")).toBe(false);
      expect(isBottomNavActive("/orders", "/notifications")).toBe(false);
    });

    it("/checkout highlights NO bottom tab", () => {
      expect(isBottomNavActive("/", "/checkout")).toBe(false);
      expect(isBottomNavActive("/menu", "/checkout")).toBe(false);
      expect(isBottomNavActive("/healthy", "/checkout")).toBe(false);
      expect(isBottomNavActive("/cart", "/checkout")).toBe(false);
      expect(isBottomNavActive("/orders", "/checkout")).toBe(false);
    });

    it("null or empty path highlights NO bottom tab", () => {
      expect(isBottomNavActive("/", null)).toBe(false);
      expect(isBottomNavActive("/", "")).toBe(false);
      expect(isBottomNavActive("/menu", undefined)).toBe(false);
    });
  });
});

describe("getActiveBottomNavTab", () => {
  it("resolves active tab href correctly", () => {
    expect(getActiveBottomNavTab("/")).toBe("/");
    expect(getActiveBottomNavTab("/menu")).toBe("/menu");
    expect(getActiveBottomNavTab("/menu/items")).toBe("/menu");
    expect(getActiveBottomNavTab("/healthy")).toBe("/healthy");
    expect(getActiveBottomNavTab("/healthy/score")).toBe("/healthy");
    expect(getActiveBottomNavTab("/cart")).toBe("/cart");
    expect(getActiveBottomNavTab("/orders")).toBe("/orders");
    expect(getActiveBottomNavTab("/orders/123")).toBe("/orders");
  });

  it("returns null for routes with no bottom nav highlight", () => {
    expect(getActiveBottomNavTab("/profile")).toBeNull();
    expect(getActiveBottomNavTab("/profile/settings")).toBeNull();
    expect(getActiveBottomNavTab("/notifications")).toBeNull();
    expect(getActiveBottomNavTab("/checkout")).toBeNull();
    expect(getActiveBottomNavTab("/checkout/payment")).toBeNull();
    expect(getActiveBottomNavTab("/unknown-page")).toBeNull();
    expect(getActiveBottomNavTab(null)).toBeNull();
  });
});

describe("isProfileHeaderActive", () => {
  it("returns true on /profile and sub-routes", () => {
    expect(isProfileHeaderActive("/profile")).toBe(true);
    expect(isProfileHeaderActive("/profile/")).toBe(true);
    expect(isProfileHeaderActive("/profile/settings")).toBe(true);
  });

  it("returns false on other routes", () => {
    expect(isProfileHeaderActive("/")).toBe(false);
    expect(isProfileHeaderActive("/menu")).toBe(false);
    expect(isProfileHeaderActive("/healthy")).toBe(false);
    expect(isProfileHeaderActive("/cart")).toBe(false);
    expect(isProfileHeaderActive("/orders")).toBe(false);
    expect(isProfileHeaderActive("/profile-public")).toBe(false);
    expect(isProfileHeaderActive(null)).toBe(false);
  });
});

