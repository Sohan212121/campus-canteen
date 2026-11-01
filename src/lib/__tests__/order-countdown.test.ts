import { describe, it, expect } from "vitest";
import {
  formatRelativeReadyCountdown,
  calculateHoldWindowProgress,
  calculateProgressOffset,
  getStepTimestampText,
} from "../order-countdown";

describe("order-countdown helpers", () => {
  describe("formatRelativeReadyCountdown", () => {
    it("handles null or undefined correctly", () => {
      expect(formatRelativeReadyCountdown(null)).toBe("Preparing shortly");
      expect(formatRelativeReadyCountdown(undefined)).toBe("Preparing shortly");
      expect(formatRelativeReadyCountdown("invalid-date")).toBe("Preparing shortly");
    });

    it("formats future times (> 1 min) cleanly", () => {
      const now = new Date("2026-10-30T12:00:00Z").getTime();
      const target = new Date("2026-10-30T12:06:00Z").toISOString();
      expect(formatRelativeReadyCountdown(target, now)).toBe("in ~6 min");
    });

    it("formats 1 min remaining cleanly", () => {
      const now = new Date("2026-10-30T12:00:00Z").getTime();
      const target = new Date("2026-10-30T12:01:00Z").toISOString();
      expect(formatRelativeReadyCountdown(target, now)).toBe("in ~1 min");
    });

    it("gracefully displays 'any moment now' when time has arrived or slightly passed", () => {
      const now = new Date("2026-10-30T12:00:00Z").getTime();
      const targetPast = new Date("2026-10-30T11:58:00Z").toISOString();
      expect(formatRelativeReadyCountdown(targetPast, now)).toBe("any moment now");
    });
  });

  describe("calculateHoldWindowProgress", () => {
    it("computes hold window progress correctly for normal window", () => {
      const now = new Date("2026-10-30T12:05:00Z").getTime();
      const readyAt = new Date("2026-10-30T12:00:00Z").toISOString();
      // 15 min hold => total 900s, 5 min passed (300s), 10 min remaining (600s)
      const res = calculateHoldWindowProgress(readyAt, null, 15, now);

      expect(res.totalSeconds).toBe(900);
      expect(res.remainingSeconds).toBe(600);
      expect(Math.round(res.percentRemaining)).toBe(67);
      expect(res.isExpired).toBe(false);
      expect(res.isWarning).toBe(false);
      expect(res.isUrgent).toBe(false);
      expect(res.formattedTime).toBe("10m 00s");
    });

    it("flags isWarning when remaining time is <= 5 mins (300s)", () => {
      const now = new Date("2026-10-30T12:11:00Z").getTime();
      const readyAt = new Date("2026-10-30T12:00:00Z").toISOString();
      // 4 mins remaining (240s)
      const res = calculateHoldWindowProgress(readyAt, null, 15, now);

      expect(res.remainingSeconds).toBe(240);
      expect(res.isWarning).toBe(true);
      expect(res.isUrgent).toBe(false);
      expect(res.formattedTime).toBe("4m 00s");
    });

    it("flags isUrgent when remaining time is <= 2 mins (120s)", () => {
      const now = new Date("2026-10-30T12:13:30Z").getTime();
      const readyAt = new Date("2026-10-30T12:00:00Z").toISOString();
      // 90s remaining (1m 30s)
      const res = calculateHoldWindowProgress(readyAt, null, 15, now);

      expect(res.remainingSeconds).toBe(90);
      expect(res.isWarning).toBe(true);
      expect(res.isUrgent).toBe(true);
      expect(res.formattedTime).toBe("1m 30s");
    });

    it("clamps to 0 and flags isExpired when hold window has elapsed", () => {
      const now = new Date("2026-10-30T12:20:00Z").getTime();
      const readyAt = new Date("2026-10-30T12:00:00Z").toISOString();
      const res = calculateHoldWindowProgress(readyAt, null, 15, now);

      expect(res.remainingSeconds).toBe(0);
      expect(res.percentRemaining).toBe(0);
      expect(res.isExpired).toBe(true);
      expect(res.isWarning).toBe(false);
      expect(res.isUrgent).toBe(false);
      expect(res.formattedTime).toBe("Expired");
    });

    it("falls back to pickupWindowEnd when readyAt is not yet set", () => {
      const now = new Date("2026-10-30T12:00:00Z").getTime();
      const pickupWindowEnd = new Date("2026-10-30T12:10:00Z").toISOString();
      const res = calculateHoldWindowProgress(null, pickupWindowEnd, 15, now);

      expect(res.remainingSeconds).toBe(600);
      expect(res.isExpired).toBe(false);
    });
  });

  describe("calculateProgressOffset", () => {
    it("returns correct stroke-dashoffset for various percentages", () => {
      const circumference = 100;
      expect(calculateProgressOffset(100, circumference)).toBe(0);
      expect(calculateProgressOffset(50, circumference)).toBe(50);
      expect(calculateProgressOffset(0, circumference)).toBe(100);
      expect(calculateProgressOffset(120, circumference)).toBe(0); // clamped
      expect(calculateProgressOffset(-20, circumference)).toBe(100); // clamped
    });
  });

  describe("getStepTimestampText", () => {
    it("returns formatted IST time for known steps with dates", () => {
      const order = {
        placed_at: "2026-10-30T12:00:00Z",
        ready_at: "2026-10-30T12:15:00Z",
        collected_at: "2026-10-30T12:20:00Z",
      };

      expect(getStepTimestampText("PLACED", order)).toBeTruthy();
      expect(getStepTimestampText("READY", order)).toBeTruthy();
      expect(getStepTimestampText("COLLECTED", order)).toBeTruthy();
      expect(getStepTimestampText("PREPARING", order)).toBeNull();
    });
  });
});

