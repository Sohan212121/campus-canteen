import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
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
  cancelOrderAction,
  getReorderItemsAction,
} from "@/server/actions/order";
import {
  isOrderCancellable,
  canShowPickupToken,
  isOrderActive,
  getStatusBadgeConfig,
  formatIstTime,
  formatIstDateTime,
  CANCELLABLE_STATUSES,
} from "@/lib/order-status";

describe("Phase 6 Order Tracking & Cancellation", () => {
  const validOrderId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-1",
      role: "student",
      is_active: true,
    });
  });

  describe("cancelOrderAction", () => {
    it("enforces requireRole before cancelling", async () => {
      mockRpc.mockResolvedValue({
        data: {
          order_id: validOrderId,
          order_code: "CN10001",
          status: "CANCELLED",
          was_already_cancelled: false,
        },
        error: null,
      });

      await cancelOrderAction(validOrderId);
      expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
    });

    it("fails validation when orderId is not a valid UUID", async () => {
      const result = await cancelOrderAction("not-a-uuid");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps NOT_FOUND error when order does not belong to caller", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "NOT_FOUND: Order not found or not owned by user" },
      });

      const result = await cancelOrderAction(validOrderId);
      expect(result.success).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.error).toContain("Order not found");
    });

    it("maps NOT_CANCELLABLE error when order is in preparation or beyond", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "NOT_CANCELLABLE: Order cannot be cancelled in status PREPARING" },
      });

      const result = await cancelOrderAction(validOrderId);
      expect(result.success).toBe(false);
      expect(result.code).toBe("NOT_CANCELLABLE");
      expect(result.error).toContain("Only orders in PLACED stage can be cancelled");
    });

    it("returns successful idempotent cancellation payload", async () => {
      mockRpc.mockResolvedValue({
        data: {
          order_id: validOrderId,
          order_code: "CN10001",
          status: "CANCELLED",
          was_already_cancelled: true,
        },
        error: null,
      });

      const result = await cancelOrderAction(validOrderId);
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("CANCELLED");
      expect(result.data?.was_already_cancelled).toBe(true);
    });

    it("detects missing migration or stale schema cache", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "Could not find the function public.cancel_order in schema cache" },
      });

      const result = await cancelOrderAction(validOrderId);
      expect(result.success).toBe(false);
      expect(result.code).toBe("DATABASE_MIGRATION_REQUIRED");
    });
  });

  describe("getReorderItemsAction", () => {
    it("skips unavailable/inactive items and clamps quantities", async () => {
      const mockOrderItems = [
        {
          menu_item_id: "item-1",
          name_snapshot: "Masala Dosa",
          quantity: 2,
          menu_items: {
            id: "item-1",
            name: "Masala Dosa",
            is_active: true,
            is_available: true,
            stock: 1, // Only 1 in stock, original was 2 -> clamp to 1
          },
        },
        {
          menu_item_id: "item-2",
          name_snapshot: "Cold Coffee",
          quantity: 1,
          menu_items: {
            id: "item-2",
            name: "Cold Coffee",
            is_active: true,
            is_available: false, // Unavailable -> skip
            stock: 10,
          },
        },
        {
          menu_item_id: "item-3",
          name_snapshot: "Samosa",
          quantity: 15, // original quantity 15 -> clamp to 10
          menu_items: {
            id: "item-3",
            name: "Samosa",
            is_active: true,
            is_available: true,
            stock: 20,
          },
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: mockOrderItems,
            error: null,
          }),
        }),
      });

      const result = await getReorderItemsAction(validOrderId);
      expect(result.success).toBe(true);

      // Skipped item-2
      expect(result.skippedItems).toHaveLength(1);
      expect(result.skippedItems[0].name).toBe("Cold Coffee");
      expect(result.skippedItems[0].reason).toBe("unavailable");

      // item-1 clamped to 1, item-3 clamped to 10
      expect(result.itemsToReorder).toHaveLength(2);
      expect(result.itemsToReorder[0]).toEqual({
        menu_item_id: "item-1",
        name: "Masala Dosa",
        quantity: 1,
      });
      expect(result.itemsToReorder[1]).toEqual({
        menu_item_id: "item-3",
        name: "Samosa",
        quantity: 10,
      });
    });
  });

  describe("Order Status & Token Visibility Rules", () => {
    it("enforces CANCELLABLE_STATUSES strictly for PLACED only", () => {
      expect(CANCELLABLE_STATUSES).toEqual(["PLACED"]);
      expect(isOrderCancellable("PLACED")).toBe(true);
      expect(isOrderCancellable("ACCEPTED")).toBe(false);
      expect(isOrderCancellable("PREPARING")).toBe(false);
      expect(isOrderCancellable("READY")).toBe(false);
      expect(isOrderCancellable("COLLECTED")).toBe(false);
      expect(isOrderCancellable("CANCELLED")).toBe(false);
    });

    it("enforces token visibility rule: hides immediately for CANCELLED, REJECTED, COLLECTED", () => {
      // Visible during active lifecycle
      expect(canShowPickupToken("PLACED")).toBe(true);
      expect(canShowPickupToken("ACCEPTED")).toBe(true);
      expect(canShowPickupToken("PREPARING")).toBe(true);
      expect(canShowPickupToken("READY")).toBe(true);

      // Hidden immediately when status becomes terminal
      expect(canShowPickupToken("CANCELLED")).toBe(false);
      expect(canShowPickupToken("REJECTED")).toBe(false);
      expect(canShowPickupToken("COLLECTED")).toBe(false);
    });

    it("correctly identifies active vs past orders", () => {
      expect(isOrderActive("PLACED")).toBe(true);
      expect(isOrderActive("ACCEPTED")).toBe(true);
      expect(isOrderActive("PREPARING")).toBe(true);
      expect(isOrderActive("READY")).toBe(true);

      expect(isOrderActive("COLLECTED")).toBe(false);
      expect(isOrderActive("CANCELLED")).toBe(false);
      expect(isOrderActive("REJECTED")).toBe(false);
    });

    it("maps status to correct UI badge configuration", () => {
      expect(getStatusBadgeConfig("PLACED").label).toBe("Placed");
      expect(getStatusBadgeConfig("ACCEPTED").label).toBe("Accepted");
      expect(getStatusBadgeConfig("PREPARING").label).toBe("Preparing");
      expect(getStatusBadgeConfig("READY").label).toBe("Ready for Pickup");
      expect(getStatusBadgeConfig("CANCELLED").label).toBe("Cancelled");
    });

    it("formats times strictly in Asia/Kolkata timezone", () => {
      // 10:00:00 UTC is 15:30:00 IST (3:30 PM)
      const isoUtc = "2026-10-10T10:00:00Z";
      const formatted = formatIstTime(isoUtc);
      expect(formatted).toMatch(/3:30\s*(pm|PM)/i);

      const dateTimeFormatted = formatIstDateTime(isoUtc);
      expect(dateTimeFormatted).toMatch(/10\s*Oct.*3:30/i);
    });
  });
});
