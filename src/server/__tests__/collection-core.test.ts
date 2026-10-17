import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
  resolveStaffCanteen: vi.fn().mockImplementation((profile) => profile?.canteen_id || null),
}));

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  reportUnauthorizedCollectionAction,
} from "@/server/actions/order";
import {
  previewCollectionAction,
  collectOrderAction,
} from "@/server/actions/staff";

describe("Collection Core Unit & Action Tests", () => {
  const validOrderId = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "user-1",
      role: "student",
      is_active: true,
    });
  });

  describe("reportUnauthorizedCollectionAction", () => {
    it("enforces reason length >= 5 characters", async () => {
      const result = await reportUnauthorizedCollectionAction(validOrderId, "no");
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_INPUT");
      expect(result.error).toContain("at least 5 characters");
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps REPORT_WINDOW_EXPIRED to friendly error", async () => {
      mockRpc.mockResolvedValue({
        data: { ok: false, error: "REPORT_WINDOW_EXPIRED" },
        error: null,
      });

      const result = await reportUnauthorizedCollectionAction(validOrderId, "I was away from campus");
      expect(result.success).toBe(false);
      expect(result.code).toBe("REPORT_WINDOW_EXPIRED");
      expect(result.error).toContain("within 24 hours");
    });

    it("maps REPORT_LIMIT_EXCEEDED to friendly error", async () => {
      mockRpc.mockResolvedValue({
        data: { ok: false, error: "REPORT_LIMIT_EXCEEDED" },
        error: null,
      });

      const result = await reportUnauthorizedCollectionAction(validOrderId, "I was away from campus");
      expect(result.success).toBe(false);
      expect(result.code).toBe("REPORT_LIMIT_EXCEEDED");
      expect(result.error).toContain("Monthly limit reached");
    });

    it("successfully submits dispute report", async () => {
      mockRpc.mockResolvedValue({
        data: { ok: true, report_id: "rep-1" },
        error: null,
      });

      const result = await reportUnauthorizedCollectionAction(validOrderId, "I did not collect this food");
      expect(result.success).toBe(true);
    });
  });

  describe("previewCollectionAction rate limiting and lockout", () => {
    it("maps PIN_LOCKED when 3 failed PIN attempts have occurred", async () => {
      mockRequireRole.mockResolvedValue({
        id: "staff-1",
        role: "staff",
        canteen_id: "c1",
        is_active: true,
      });

      mockRpc.mockResolvedValue({
        data: { ok: false, error: "PIN_LOCKED" },
        error: null,
      });

      const result = await previewCollectionAction({
        orderRef: "CN10001",
        pin: "9999",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("PIN_LOCKED");
      expect(result.error).toContain("PIN is locked");
    });

    it("maps INVALID_CODE without throwing exception", async () => {
      mockRequireRole.mockResolvedValue({
        id: "staff-1",
        role: "staff",
        canteen_id: "c1",
        is_active: true,
      });

      mockRpc.mockResolvedValue({
        data: { ok: false, error: "INVALID_CODE" },
        error: null,
      });

      const result = await previewCollectionAction({
        orderRef: "CN10001",
        code: "000000",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_CODE");
      expect(result.error).toContain("Invalid or expired");
    });
  });

  describe("collectOrderAction manual limits and payment methods", () => {
    it("maps MANUAL_LIMIT error when staff exceeds 10 manual collections", async () => {
      mockRequireRole.mockResolvedValue({
        id: "staff-1",
        role: "staff",
        canteen_id: "c1",
        is_active: true,
      });

      mockRpc.mockResolvedValue({
        data: { ok: false, error: "MANUAL_LIMIT" },
        error: null,
      });

      const result = await collectOrderAction({
        orderId: validOrderId,
        collectedWith: "UPI",
        method: "MANUAL",
        reason: "Student phone battery died",
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("MANUAL_LIMIT");
      expect(result.error).toContain("maximum 10 per 24 hours");
    });
  });
});
