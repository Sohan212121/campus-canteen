import { describe, it, expect } from "vitest";
import {
  computeExpiresAtMonotonic,
  calculateSecondsRemaining,
  calculateNextRefreshDelayMs,
} from "@/lib/pickup-countdown";

describe("pickup-countdown pure helpers", () => {
  describe("computeExpiresAtMonotonic", () => {
    it("adds seconds * 1000 to current monotonic time", () => {
      const now = 10000;
      expect(computeExpiresAtMonotonic(30, now)).toBe(40000);
      expect(computeExpiresAtMonotonic(60, now)).toBe(70000);
      expect(computeExpiresAtMonotonic(1, now)).toBe(11000);
    });

    it("clamps invalid or out of bound values safely", () => {
      const now = 5000;
      expect(computeExpiresAtMonotonic(-5, now)).toBe(5000);
      expect(computeExpiresAtMonotonic(120, now)).toBe(65000); // clamped to 60s
      expect(computeExpiresAtMonotonic(NaN, now)).toBe(5000);
    });
  });

  describe("calculateSecondsRemaining", () => {
    it("calculates remaining integer seconds accurately", () => {
      const expiresAt = 50000;
      expect(calculateSecondsRemaining(expiresAt, 20000)).toBe(30);
      expect(calculateSecondsRemaining(expiresAt, 49100)).toBe(1);
      expect(calculateSecondsRemaining(expiresAt, 49999)).toBe(1);
      expect(calculateSecondsRemaining(expiresAt, 50000)).toBe(0);
      expect(calculateSecondsRemaining(expiresAt, 50500)).toBe(0);
    });

    it("returns 0 for null or non-number expiresAt", () => {
      expect(calculateSecondsRemaining(null, 20000)).toBe(0);
    });
  });

  describe("calculateNextRefreshDelayMs", () => {
    it("calculates delay with post-expiry buffer (+1000ms after expiry)", () => {
      const now = 10000;
      const expiresAt = 40000; // 30s away
      // (40000 - 10000) + 1000 = 31000ms
      expect(calculateNextRefreshDelayMs(expiresAt, now, 1000)).toBe(31000);
    });

    it("clamps minimum delay to 1000ms when already expired or expiring within <0ms", () => {
      const now = 50000;
      const expiredAt = 45000; // expired 5s ago
      expect(calculateNextRefreshDelayMs(expiredAt, now)).toBe(1000);

      const almostExpiredAt = 49500; // 500ms before now + 1000ms buffer = 500ms -> clamped to 1000ms
      expect(calculateNextRefreshDelayMs(almostExpiredAt, now)).toBe(1000);
    });

    it("clamps maximum delay to 61000ms", () => {
      const now = 10000;
      const expiresFarFuture = 90000; // 80s away
      expect(calculateNextRefreshDelayMs(expiresFarFuture, now)).toBe(61000);
    });
  });
});
