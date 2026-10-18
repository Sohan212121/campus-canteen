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

    it("maps SQL collection error codes cleanly", async () => {
      const errorCases = [
        { code: "RATE_LIMITED_STAFF", expected: "Staff collection rate limit reached" },
        { code: "RATE_LIMITED_ORDER", expected: "Order collection rate limit reached" },
        { code: "AMBER_REQUIRES_BOTH", expected: "require both the rotating QR code and PIN" },
        { code: "PIN_LOCKED", expected: "Order PIN is locked" },
        { code: "NO_PICKUP_SECRET", expected: "No security credentials found" },
        { code: "ORDER_NOT_READY", expected: "Order is not marked ready yet" },
        { code: "INVALID_CODE", expected: "Invalid or expired pickup code" },
      ];

      for (const { code, expected } of errorCases) {
        mockRpc.mockResolvedValueOnce({
          data: { ok: false, error: code },
          error: null,
        });

        const res = await previewCollectionAction({
          orderRef: "CN10001",
          code: "123456",
        });

        expect(res.success).toBe(false);
        expect(res.code).toBe(code);
        expect(res.error).toContain(expected);
      }
    });

    it("returns formatted scan card on preview match with items without id", async () => {
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          order_id: validOrderId,
          order_code: "CN10001",
          first_name: "Rahul",
          college_id_last4: "8899",
          pickup_for_name: "Anita",
          total_paise: 12000,
          total_items: 2,
          is_amber: false,
          items: [
            { name: "Dosa", quantity: 2, unit_price_paise: 6000 },
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
      expect(result.data?.total_items).toBe(2);
      expect(result.data?.items[0].name).toBe("Dosa");
      expect(result.data?.items[0]).not.toHaveProperty("id");
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

    it("maps ok:false AMBER_REQUIRES_BOTH and WRONG_PIN from SQL", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, error: "AMBER_REQUIRES_BOTH" },
        error: null,
      });

      const resAmber = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "PIN",
        pin: "1234",
      });

      expect(resAmber.success).toBe(false);
      expect(resAmber.code).toBe("AMBER_REQUIRES_BOTH");
      expect(resAmber.error).toContain("require both the rotating QR code and PIN");

      mockRpc.mockResolvedValueOnce({
        data: { ok: false, error: "WRONG_PIN" },
        error: null,
      });

      const resPin = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "PIN",
        pin: "9999",
      });

      expect(resPin.success).toBe(false);
      expect(resPin.code).toBe("WRONG_PIN");
      expect(resPin.error).toContain("Incorrect 4-digit PIN");
    });

    it("maps manual limits and already collected error codes cleanly", async () => {
      mockRpc.mockResolvedValueOnce({
        data: { ok: false, error: "ALREADY_COLLECTED" },
        error: null,
      });

      const resAlready = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "SCAN",
        code: "123456",
      });
      expect(resAlready.success).toBe(false);
      expect(resAlready.code).toBe("ALREADY_COLLECTED");
      expect(resAlready.error).toContain("already been collected");

      mockRpc.mockResolvedValueOnce({
        data: { ok: false, error: "MANUAL_LIMIT" },
        error: null,
      });

      const resManual = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "CASH",
        method: "MANUAL",
        reason: "Valid override reason",
      });
      expect(resManual.success).toBe(false);
      expect(resManual.code).toBe("MANUAL_LIMIT");
      expect(resManual.error).toContain("Manual collection limit reached");
    });

    it("successfully collects order and returns SQL shape (status and collected_at)", async () => {
      const nowIso = new Date().toISOString();
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          order_id: validOrderId,
          order_code: "CN10001",
          status: "COLLECTED",
          collected_at: nowIso,
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
      expect(result.data?.order_id).toBe(validOrderId);
      expect(result.data?.order_code).toBe("CN10001");
      expect(result.data?.status).toBe("COLLECTED");
      expect(result.data?.collected_at).toBe(nowIso);
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
