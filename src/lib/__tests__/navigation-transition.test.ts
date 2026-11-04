import { describe, it, expect } from "vitest";
import { getSectionTitle } from "@/components/navigation/navigation-transition-provider";
import { normalizeNavPath, isBottomNavActive } from "@/lib/student-nav";

describe("Navigation Transition & Tab Highlighting (Phase 2)", () => {
  describe("Section Title Mapping", () => {
    it("maps all student section paths to their correct titles", () => {
      expect(getSectionTitle("/")).toBe("Campus Dining");
      expect(getSectionTitle("/menu")).toBe("Canteen Menu");
      expect(getSectionTitle("/cart")).toBe("Your Cart");
      expect(getSectionTitle("/orders")).toBe("Active Orders");
      expect(getSectionTitle("/orders/123-uuid")).toBe("Order Token Tracker");
      expect(getSectionTitle("/profile")).toBe("Student Profile");
      expect(getSectionTitle("/checkout")).toBe("Secure Checkout");
      expect(getSectionTitle("/notifications")).toBe("Notifications");
      expect(getSectionTitle("/healthy")).toBe("Healthy Mode");
      expect(getSectionTitle("/healthy/score")).toBe("Healthy Score Guide");
    });
  });

  describe("Instant Optimistic Tab Activation", () => {
    it("activates the clicked section immediately via activeNavPath", () => {
      const realPathname = "/";
      const optimisticPath = "/menu";
      const activeNavPath = optimisticPath || realPathname;

      // Old pathname was /, but optimistic is /menu
      expect(isBottomNavActive("/", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/menu", activeNavPath)).toBe(true);
      expect(isBottomNavActive("/orders", activeNavPath)).toBe(false);
    });

    it("shifts immediately to new target during rapid taps", () => {
      let activeNavPath = "/menu";
      expect(isBottomNavActive("/menu", activeNavPath)).toBe(true);

      // User immediately taps Orders
      activeNavPath = "/orders";
      expect(isBottomNavActive("/menu", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/orders", activeNavPath)).toBe(true);

      // User immediately taps Cart
      activeNavPath = "/cart";
      expect(isBottomNavActive("/orders", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/cart", activeNavPath)).toBe(true);
    });

    it("resets back to real pathname on redirect (e.g. to /login)", () => {
      const realPathname = "/login";
      const optimisticPath = null; // Cleared on redirect
      const activeNavPath = optimisticPath || realPathname;

      // No student bottom nav tabs are active on /login
      expect(isBottomNavActive("/", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/menu", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/cart", activeNavPath)).toBe(false);
      expect(isBottomNavActive("/orders", activeNavPath)).toBe(false);
    });
  });

  describe("Normalization & Duplicate Guards", () => {
    it("normalizes path with query strings and trailing slashes", () => {
      expect(normalizeNavPath("/menu?category=drinks")).toBe("/menu");
      expect(normalizeNavPath("/orders/#active")).toBe("/orders");
      expect(normalizeNavPath("/healthy/")).toBe("/healthy");
    });
  });
});
