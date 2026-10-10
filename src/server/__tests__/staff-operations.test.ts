import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockGetActiveCanteenId = vi.fn();
vi.mock("@/server/canteen", () => ({
  getActiveCanteenId: () => mockGetActiveCanteenId(),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  transitionOrderAction,
  verifyPickupAction,
  setItemAvailabilityAction,
} from "@/server/actions/staff";
import { calculateStartPreparingBy } from "@/lib/order-status";

describe("Phase 7 Staff Operations", () => {
  const validOrderId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22";
  const validCanteenId = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c33";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "staff-1",
      role: "staff",
      canteen_id: validCanteenId,
      is_active: true,
    });
  });

  describe("transitionOrderAction", () => {
    it("enforces staff or admin role check", async () => {
      mockRpc.mockResolvedValue({
        data: {
          order_id: validOrderId,
          status: "ACCEPTED",
          was_noop: false,
        },
        error: null,
      });

      await transitionOrderAction(validOrderId, "ACCEPTED");
      expect(mockRequireRole).toHaveBeenCalledWith(["staff", "admin"]);
      expect(mockRpc).toHaveBeenCalledWith("transition_order", {
        p_order_id: validOrderId,
        p_to_status: "ACCEPTED",
      });
    });

    it("rejects invalid UUID input", async () => {
      const result = await transitionOrderAction("not-a-valid-uuid", "ACCEPTED");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects invalid status transitions not in enum", async () => {
      // @ts-expect-error testing invalid status string
      const result = await transitionOrderAction(validOrderId, "NON_EXISTENT");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps FORBIDDEN error when staff operates on wrong canteen", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "FORBIDDEN: Staff not authorized for this canteen" },
      });

      const result = await transitionOrderAction(validOrderId, "PREPARING");
      expect(result.success).toBe(false);
      expect(result.code).toBe("FORBIDDEN");
      expect(result.error).toContain("authorized");
    });

    it("maps INVALID_TRANSITION error", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: "INVALID_TRANSITION: Cannot transition order from PLACED to COLLECTED",
        },
      });

      const result = await transitionOrderAction(validOrderId, "COLLECTED");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_TRANSITION");
      expect(result.error).toContain("Cannot transition");
    });

    it("handles idempotent no-op returns gracefully", async () => {
      mockRpc.mockResolvedValue({
        data: {
          order_id: validOrderId,
          status: "PREPARING",
          was_noop: true,
        },
        error: null,
      });

      const result = await transitionOrderAction(validOrderId, "PREPARING");
      expect(result.success).toBe(true);
      expect(result.was_noop).toBe(true);
      expect(result.data?.was_noop).toBe(true);
    });
  });

  describe("verifyPickupAction", () => {
    it("rejects non-6-digit tokens before querying database", async () => {
      const result = await verifyPickupAction("12345"); // 5 digits
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_TOKEN");
      expect(mockRpc).not.toHaveBeenCalled();

      const nonNumeric = await verifyPickupAction("abcdef");
      expect(nonNumeric.success).toBe(false);
      expect(nonNumeric.code).toBe("INVALID_TOKEN");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects if staff has no canteen assigned", async () => {
      mockRequireRole.mockResolvedValue({
        id: "staff-no-canteen",
        role: "staff",
        canteen_id: null,
        is_active: true,
      });

      const result = await verifyPickupAction("123456");
      expect(result.success).toBe(false);
      expect(result.code).toBe("NO_CANTEEN_ASSIGNED");
      expect(result.error).toContain("No canteen assigned");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps found:false to NOT_FOUND error message", async () => {
      mockRpc.mockResolvedValue({
        data: { found: false },
        error: null,
      });

      const result = await verifyPickupAction("999999");
      expect(result.success).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.error).toContain("No ready order found");
    });

    it("maps RATE_LIMITED error when 10+ failed attempts occurred", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message:
            "RATE_LIMITED: Too many failed pickup verification attempts. Please wait 5 minutes.",
        },
      });

      const result = await verifyPickupAction("999999");
      expect(result.success).toBe(false);
      expect(result.code).toBe("RATE_LIMITED");
      expect(result.error).toContain("Too many failed pickup attempts");
    });

    it("returns formatted order details on token match", async () => {
      mockRpc.mockResolvedValue({
        data: {
          found: true,
          order_id: validOrderId,
          order_code: "ORD1042",
          status: "READY",
          student_name: "Aarav Sharma",
          total_paise: 14000,
          payment_method: "PAY_AT_PICKUP",
          payment_status: "PENDING",
          items: [
            { id: "item-1", name_snapshot: "Masala Dosa", quantity: 2, unit_price_paise: 6000 },
            { id: "item-2", name_snapshot: "Filter Coffee", quantity: 1, unit_price_paise: 2000 },
          ],
        },
        error: null,
      });

      const result = await verifyPickupAction("482910");
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        order_id: validOrderId,
        order_code: "ORD1042",
        status: "READY",
        student_name: "Aarav Sharma",
        total_paise: 14000,
        payment_method: "PAY_AT_PICKUP",
        payment_status: "PENDING",
        items: [
          { id: "item-1", name_snapshot: "Masala Dosa", quantity: 2, unit_price_paise: 6000 },
          { id: "item-2", name_snapshot: "Filter Coffee", quantity: 1, unit_price_paise: 2000 },
        ],
      });
    });
  });

  describe("setItemAvailabilityAction", () => {
    it("validates input and calls set_item_availability RPC", async () => {
      mockRpc.mockResolvedValue({
        data: { item_id: "item-1", is_available: false },
        error: null,
      });

      const result = await setItemAvailabilityAction(
        "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380d44",
        false
      );
      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("set_item_availability", {
        p_item_id: "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380d44",
        p_is_available: false,
      });
    });
  });

  describe("calculateStartPreparingBy helper", () => {
    it("calculates start time by subtracting preparation lead minutes", () => {
      // 12:30 UTC is 18:00 (6:00 PM) IST. Subtracting 15m gives 17:45 (5:45 PM) IST.
      const pickupTime = "2026-10-10T12:30:00Z";
      const leadMinutes = 15;
      const startTime = calculateStartPreparingBy(pickupTime, leadMinutes);
      expect(startTime).toMatch(/5:45\s*(pm|PM)/i);
    });

    it("returns placeholder if pickup time is not set", () => {
      expect(calculateStartPreparingBy(null, 15)).toBe("--:--");
      expect(calculateStartPreparingBy(undefined, 15)).toBe("--:--");
    });
  });

  describe("Staff Query Security Invariant (Requirement 6)", () => {
    it("asserts that staff server action queries NEVER select pickup_token", () => {
      const staffActionsPath = path.resolve(__dirname, "../actions/staff.ts");
      const staffActionsContent = fs.readFileSync(staffActionsPath, "utf-8");

      // Extract all .select(...) calls across staff.ts
      const selectMatches = staffActionsContent.match(
        /\.select\(\s*[`'"][^`'"]*[`'"]\s*\)/g
      );

      expect(selectMatches).not.toBeNull();
      expect(selectMatches!.length).toBeGreaterThan(0);

      // Verify no select string contains pickup_token
      for (const match of selectMatches!) {
        expect(match).not.toContain("pickup_token");
      }
    });
  });
});
