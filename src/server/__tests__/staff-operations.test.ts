import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Mock server auth
const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
  resolveStaffCanteen: vi.fn().mockImplementation((profile) => profile?.canteen_id || null),
}));

// Mock Supabase Server Client
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
  previewCollectionAction,
  collectOrderAction,
  setItemAvailabilityAction,
} from "@/server/actions/staff";
import { calculateStartPreparingBy } from "@/lib/order-status";

describe("Staff Operations & Collection Core", () => {
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
    it("successfully calls transition_order for kitchen transitions", async () => {
      mockRpc.mockResolvedValue({
        data: {
          order_id: validOrderId,
          status: "ACCEPTED",
          was_noop: false,
        },
        error: null,
      });

      const result = await transitionOrderAction(validOrderId, "ACCEPTED");
      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("transition_order", {
        p_order_id: validOrderId,
        p_to_status: "ACCEPTED",
      });
    });

    it("strictly refuses direct transition to COLLECTED", async () => {
      const result = await transitionOrderAction(validOrderId, "COLLECTED");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_TRANSITION");
      expect(result.error).toContain("Use collectOrderAction instead");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects invalid UUID format before calling RPC", async () => {
      const result = await transitionOrderAction("not-a-valid-uuid", "ACCEPTED");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects non-existent status", async () => {
      // @ts-expect-error Testing runtime invalid input
      const result = await transitionOrderAction(validOrderId, "NON_EXISTENT");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps database errors cleanly", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: "INVALID_TRANSITION: Cannot transition order from PLACED to READY",
        },
      });

      const result = await transitionOrderAction(validOrderId, "READY");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_TRANSITION");
      expect(result.error).toContain("Cannot transition");
    });
  });

  describe("previewCollectionAction", () => {
    it("rejects empty order reference", async () => {
      const result = await previewCollectionAction({ orderRef: "" });
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps ok:false RATE_LIMITED without throwing", async () => {
      mockRpc.mockResolvedValue({
        data: { ok: false, error: "RATE_LIMITED" },
        error: null,
      });

      const result = await previewCollectionAction({
        orderRef: "CN10001",
        code: "123456",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("RATE_LIMITED");
      expect(result.error).toContain("Too many failed attempts");
    });

    it("returns formatted scan card on preview match", async () => {
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          order_id: validOrderId,
          order_code: "CN10001",
          first_name: "Rahul",
          college_id_last4: "8899",
          pickup_for_name: "Anita",
          total_paise: 12000,
          is_amber: false,
          items: [
            { id: "i1", name: "Dosa", quantity: 2, unit_price_paise: 6000 },
          ],
        },
        error: null,
      });

      const result = await previewCollectionAction({
        orderRef: "CN10001",
        code: "123456",
      });

      expect(result.success).toBe(true);
      expect(result.data?.first_name).toBe("Rahul");
      expect(result.data?.college_id_last4).toBe("8899");
      expect(result.data?.is_amber).toBe(false);
    });
  });

  describe("collectOrderAction", () => {
    it("rejects invalid payment method", async () => {
      const result = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "BITCOIN" as unknown as "CASH",
        method: "SCAN",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
    });

    it("enforces minimum 5 characters reason for MANUAL collection", async () => {
      const result = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "MANUAL",
        reason: "bad",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(result.error).toContain("at least 5 characters");
    });

    it("maps ok:false AMBER_REQUIRES_CODE_AND_PIN", async () => {
      mockRpc.mockResolvedValue({
        data: { ok: false, error: "AMBER_REQUIRES_CODE_AND_PIN" },
        error: null,
      });

      const result = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "PIN",
        pin: "1234",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("AMBER_REQUIRES_CODE_AND_PIN");
    });

    it("successfully collects order and revalidates paths", async () => {
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          order_id: validOrderId,
          order_code: "CN10001",
          first_name: "Rahul",
          college_id_last4: "8899",
          total_paise: 12000,
          collected_with: "CASH",
          collection_method: "SCAN",
          items: [],
        },
        error: null,
      });

      const result = await collectOrderAction({
        orderId: validOrderId,
        code: "123456",
        collectedWith: "CASH",
        method: "SCAN",
      });

      expect(result.success).toBe(true);
      expect(result.data?.collected_with).toBe("CASH");
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

  describe("Staff Query Security Invariant", () => {
    it("asserts that staff server action queries NEVER select pickup_token", () => {
      const staffActionsPath = path.resolve(__dirname, "../actions/staff.ts");
      const staffActionsContent = fs.readFileSync(staffActionsPath, "utf-8");

      const selectMatches = staffActionsContent.match(
        /\.select\(\s*[`'"][^`'"]*[`'"]\s*\)/g
      );

      expect(selectMatches).not.toBeNull();
      expect(selectMatches!.length).toBeGreaterThan(0);

      for (const match of selectMatches!) {
        expect(match).not.toContain("pickup_token");
      }
    });
  });
});
