import { describe, it, expect } from "vitest";

import {
  getPlacedSessionKey,
  getCollectedStorageKey,
  isWithinRecentWindow,
  shouldShowPlacedCelebration,
  shouldShowCollectedCelebration,
  shouldRedirectEmptyCart,
  buildPlacedOrder,
  getTrackOrderPath,
  shouldWritePlacedFlag,
  canSubmitOrder,
  getNavigationButtonLabel,
  MAX_CELEBRATION_AGE_MS,
} from "../celebration";

describe("Celebration Logic & Behavioral Pure Decision Functions", () => {
  const fixedNow = 1700000000000;

  describe("Storage Keys", () => {
    it("generates correct per-order keys", () => {
      expect(getPlacedSessionKey("ord-123")).toBe("cc_order_placed_ord-123");
      expect(getCollectedStorageKey("ord-123")).toBe("cc_order_collected_ord-123");
    });
  });

  describe("Empty-Cart Redirect Guard (shouldRedirectEmptyCart)", () => {
    it("does not redirect when store has not hydrated yet", () => {
      expect(
        shouldRedirectEmptyCart({
          hasHydrated: false,
          itemsLength: 0,
          hasPlacedOrder: false,
        })
      ).toBe(false);
    });

    it("redirects when hydrated, cart is empty, and NO order has been placed", () => {
      expect(
        shouldRedirectEmptyCart({
          hasHydrated: true,
          itemsLength: 0,
          hasPlacedOrder: false,
        })
      ).toBe(true);
    });

    it("NEVER redirects when an order was placed, even though cart is now empty", () => {
      expect(
        shouldRedirectEmptyCart({
          hasHydrated: true,
          itemsLength: 0,
          hasPlacedOrder: true,
        })
      ).toBe(false);
    });

    it("does not redirect when items are present", () => {
      expect(
        shouldRedirectEmptyCart({
          hasHydrated: true,
          itemsLength: 2,
          hasPlacedOrder: false,
        })
      ).toBe(false);
    });
  });

  describe("Placed Order Builder (buildPlacedOrder)", () => {
    it("extracts real order code, ready time, and total paise from success result", () => {
      const summary = buildPlacedOrder({
        order_id: "ord-456",
        order_code: "B-42",
        estimated_ready_at: "2026-10-30T15:30:00+05:30",
        total_paise: 18500,
      });

      expect(summary).toEqual({
        order_id: "ord-456",
        order_code: "B-42",
        estimated_ready_at: "2026-10-30T15:30:00+05:30",
        total_paise: 18500,
      });
    });

    it("handles was_duplicate payload consistently", () => {
      const duplicateData = {
        order_id: "ord-dup",
        order_code: "D-99",
        estimated_ready_at: "2026-10-30T15:45:00+05:30",
        total_paise: 25000,
        was_duplicate: true,
      };

      const summary = buildPlacedOrder(duplicateData);
      expect(summary).toEqual({
        order_id: "ord-dup",
        order_code: "D-99",
        estimated_ready_at: "2026-10-30T15:45:00+05:30",
        total_paise: 25000,
      });
    });

    it("returns null for invalid or nullish inputs", () => {
      expect(buildPlacedOrder(null)).toBeNull();
      expect(buildPlacedOrder(undefined)).toBeNull();
      expect(
        buildPlacedOrder({
          order_id: "",
          order_code: "",
          estimated_ready_at: "",
          total_paise: 0,
        })
      ).toBeNull();
    });
  });

  describe("Navigation & Path Rules", () => {
    it("returns canonical track order route without celebration query params", () => {
      const path = getTrackOrderPath("ord-789");
      expect(path).toBe("/orders/ord-789");
      expect(path).not.toContain("?placed=");
      expect(path).not.toContain("&placed=");
    });

    it("enforces that checkout should NOT write the placed session flag", () => {
      expect(shouldWritePlacedFlag()).toBe(false);
    });

    it("updates button labels to 'Opening...' during navigation transitions", () => {
      expect(
        getNavigationButtonLabel({
          isNavigating: true,
          defaultLabel: "Track order",
        })
      ).toBe("Opening...");

      expect(
        getNavigationButtonLabel({
          isNavigating: true,
          defaultLabel: "Back to menu",
        })
      ).toBe("Opening...");

      expect(
        getNavigationButtonLabel({
          isNavigating: false,
          defaultLabel: "Track order",
        })
      ).toBe("Track order");
    });
  });

  describe("Submission & Double-Placement Prevention (canSubmitOrder)", () => {
    it("allows submission when not submitting, no order placed, and cart has items", () => {
      expect(
        canSubmitOrder({
          isSubmitting: false,
          hasPlacedOrder: false,
          itemsLength: 2,
        })
      ).toBe(true);
    });

    it("strictly prevents submission while already submitting", () => {
      expect(
        canSubmitOrder({
          isSubmitting: true,
          hasPlacedOrder: false,
          itemsLength: 2,
        })
      ).toBe(false);
    });

    it("strictly prevents submission after an order has succeeded", () => {
      expect(
        canSubmitOrder({
          isSubmitting: false,
          hasPlacedOrder: true,
          itemsLength: 2,
        })
      ).toBe(false);
    });

    it("prevents submission when cart is empty", () => {
      expect(
        canSubmitOrder({
          isSubmitting: false,
          hasPlacedOrder: false,
          itemsLength: 0,
        })
      ).toBe(false);
    });
  });

  describe("Recency Window (isWithinRecentWindow)", () => {
    it("returns true for timestamps within 5 minutes", () => {
      const recent = new Date(fixedNow - 60 * 1000).toISOString();
      expect(isWithinRecentWindow(recent, fixedNow)).toBe(true);
    });

    it("returns false for timestamps older than 5 minutes", () => {
      const stale = new Date(fixedNow - (MAX_CELEBRATION_AGE_MS + 1000)).toISOString();
      expect(isWithinRecentWindow(stale, fixedNow)).toBe(false);
    });

    it("allows up to 30s future clock skew", () => {
      const futureNear = new Date(fixedNow + 15 * 1000).toISOString();
      expect(isWithinRecentWindow(futureNear, fixedNow)).toBe(true);

      const futureFar = new Date(fixedNow + 45 * 1000).toISOString();
      expect(isWithinRecentWindow(futureFar, fixedNow)).toBe(false);
    });

    it("handles null, undefined, or invalid timestamps gracefully", () => {
      expect(isWithinRecentWindow(null, fixedNow)).toBe(false);
      expect(isWithinRecentWindow(undefined, fixedNow)).toBe(false);
      expect(isWithinRecentWindow("not-a-date", fixedNow)).toBe(false);
    });
  });

  describe("Placed Overlay Tracker Gate (shouldShowPlacedCelebration)", () => {
    const recentPlacedAt = new Date(fixedNow - 30 * 1000).toISOString();

    it("returns true when PLACED, session flag is present, and order is recent", () => {
      const shouldShow = shouldShowPlacedCelebration({
        status: "PLACED",
        placedAt: recentPlacedAt,
        hasSessionFlag: true,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(true);
    });

    it("returns false when session flag is missing (e.g. checkout showed celebration inline)", () => {
      const shouldShow = shouldShowPlacedCelebration({
        status: "PLACED",
        placedAt: recentPlacedAt,
        hasSessionFlag: false,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(false);
    });

    it("returns false when status is not PLACED (e.g. ACCEPTED or READY)", () => {
      expect(
        shouldShowPlacedCelebration({
          status: "ACCEPTED",
          placedAt: recentPlacedAt,
          hasSessionFlag: true,
          nowMs: fixedNow,
        })
      ).toBe(false);

      expect(
        shouldShowPlacedCelebration({
          status: "READY",
          placedAt: recentPlacedAt,
          hasSessionFlag: true,
          nowMs: fixedNow,
        })
      ).toBe(false);
    });

    it("returns false when order placed timestamp is older than maxAgeMs", () => {
      const oldPlacedAt = new Date(fixedNow - 10 * 60 * 1000).toISOString();
      const shouldShow = shouldShowPlacedCelebration({
        status: "PLACED",
        placedAt: oldPlacedAt,
        hasSessionFlag: true,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(false);
    });

    it("enforces that dev preview parameters work only when isDev is true", () => {
      expect(
        shouldShowPlacedCelebration({
          status: "READY",
          placedAt: recentPlacedAt,
          hasSessionFlag: false,
          isDev: true,
          previewPlacedParam: true,
          nowMs: fixedNow,
        })
      ).toBe(true);

      expect(
        shouldShowPlacedCelebration({
          status: "READY",
          placedAt: recentPlacedAt,
          hasSessionFlag: false,
          isDev: false,
          previewPlacedParam: true,
          nowMs: fixedNow,
        })
      ).toBe(false);
    });
  });

  describe("Collected Celebration Gate (shouldShowCollectedCelebration)", () => {
    const recentCollectedAt = new Date(fixedNow - 20 * 1000).toISOString();

    it("returns true when order status changes to COLLECTED while page is open", () => {
      const shouldShow = shouldShowCollectedCelebration({
        currentStatus: "COLLECTED",
        prevStatus: "READY",
        collectedAt: recentCollectedAt,
        hasSeenCollected: false,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(true);
    });

    it("returns true when opening a recently collected order for the first time", () => {
      const shouldShow = shouldShowCollectedCelebration({
        currentStatus: "COLLECTED",
        prevStatus: null,
        collectedAt: recentCollectedAt,
        hasSeenCollected: false,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(true);
    });

    it("returns false if already seen and stored in localStorage", () => {
      const shouldShow = shouldShowCollectedCelebration({
        currentStatus: "COLLECTED",
        prevStatus: "READY",
        collectedAt: recentCollectedAt,
        hasSeenCollected: true,
        nowMs: fixedNow,
      });
      expect(shouldShow).toBe(false);
    });

    it("never shows for NO_SHOW, CANCELLED, or REJECTED", () => {
      for (const terminalStatus of ["NO_SHOW", "CANCELLED", "REJECTED"]) {
        expect(
          shouldShowCollectedCelebration({
            currentStatus: terminalStatus,
            prevStatus: "READY",
            collectedAt: recentCollectedAt,
            hasSeenCollected: false,
            nowMs: fixedNow,
          })
        ).toBe(false);
      }
    });

    it("returns false if status is not COLLECTED", () => {
      expect(
        shouldShowCollectedCelebration({
          currentStatus: "READY",
          prevStatus: "PREPARING",
          hasSeenCollected: false,
          nowMs: fixedNow,
        })
      ).toBe(false);
    });

    it("enforces that dev preview parameters work only when isDev is true", () => {
      expect(
        shouldShowCollectedCelebration({
          currentStatus: "READY",
          hasSeenCollected: true,
          isDev: true,
          previewCollectedParam: true,
          nowMs: fixedNow,
        })
      ).toBe(true);

      expect(
        shouldShowCollectedCelebration({
          currentStatus: "READY",
          hasSeenCollected: true,
          isDev: false,
          previewCollectedParam: true,
          nowMs: fixedNow,
        })
      ).toBe(false);
    });
  });
});
