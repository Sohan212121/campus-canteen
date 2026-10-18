import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireRole, mockRpc } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { TERMINAL_STATUSES, getStatusBadgeConfig } from "@/lib/order-status";
import {
  adminUpdateCanteenSettingsAction,
  adminListStudentStrikesAction,
  adminClearStudentStrikesAction,
} from "@/server/actions/admin";
import { getMyAccountStatusAction } from "@/server/actions/order";

describe("NO_SHOW Status & Hold Window Enforcement", () => {
  const validCanteenId = "123e4567-e89b-12d3-a456-426614174000";
  const validStudentId = "123e4567-e89b-12d3-a456-426614174001";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "admin-user-id",
      role: "admin",
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("includes NO_SHOW in TERMINAL_STATUSES", () => {
    expect(TERMINAL_STATUSES).toContain("NO_SHOW");
  });

  it("provides correct badge config for NO_SHOW status", () => {
    const config = getStatusBadgeConfig("NO_SHOW");
    expect(config.label).toBe("Expired / No-Show");
    expect(config.variant).toBe("destructive");
  });

  it("validates hold_minutes bounds between 5 and 120 minutes in adminUpdateCanteenSettingsAction", async () => {
    const baseSettings = {
      opens_at: "08:00:00",
      closes_at: "17:00:00",
      last_order_time: "16:30:00",
      kitchen_capacity: 5,
      min_lead_minutes: 5,
      hold_minutes: 15,
    };

    // Below 5 minutes -> rejected before RPC
    const lowRes = await adminUpdateCanteenSettingsAction(validCanteenId, {
      ...baseSettings,
      hold_minutes: 4,
    });
    expect(lowRes.success).toBe(false);
    if (!lowRes.success) {
      expect(lowRes.error).toContain("between 5 and 120 minutes");
    }
    expect(mockRpc).not.toHaveBeenCalled();

    // Above 120 minutes -> rejected before RPC
    const highRes = await adminUpdateCanteenSettingsAction(validCanteenId, {
      ...baseSettings,
      hold_minutes: 121,
    });
    expect(highRes.success).toBe(false);
    if (!highRes.success) {
      expect(highRes.error).toContain("between 5 and 120 minutes");
    }
    expect(mockRpc).not.toHaveBeenCalled();

    // Valid boundary 5 minutes -> passes to RPC
    const valid5 = await adminUpdateCanteenSettingsAction(validCanteenId, {
      ...baseSettings,
      hold_minutes: 5,
    });
    expect(valid5.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("admin_update_canteen_settings", expect.objectContaining({
      p_hold_minutes: 5,
    }));

    // Valid boundary 120 minutes -> passes to RPC
    const valid120 = await adminUpdateCanteenSettingsAction(validCanteenId, {
      ...baseSettings,
      hold_minutes: 120,
    });
    expect(valid120.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("admin_update_canteen_settings", expect.objectContaining({
      p_hold_minutes: 120,
    }));
  });

  it("fetches student account status with strike limit 3 and active order limit 2", async () => {
    mockRequireRole.mockResolvedValue({ id: validStudentId, role: "student" });
    mockRpc.mockResolvedValue({
      data: {
        strikes: 2,
        is_limited: false,
        active_orders_count: 1,
        active_order_limit: 2,
        can_order: true,
        max_items_allowed: null,
        max_order_paise: null,
      },
      error: null,
    });

    const res = await getMyAccountStatusAction();
    expect(res.success).toBe(true);
    expect(res.data?.strikes).toBe(2);
    expect(res.data?.is_limited).toBe(false);
    expect(res.data?.active_order_limit).toBe(2);
    expect(res.data?.can_order).toBe(true);
  });

  it("adminListStudentStrikesAction returns rows without email", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-id", role: "admin" });
    mockRpc.mockResolvedValue({
      data: [
        {
          student_id: validStudentId,
          student_name: "Test Student",
          college_id_last4: "1234",
          strike_count: 3,
          last_no_show_at: "2026-10-18T10:00:00Z",
          is_limited: true,
        },
      ],
      error: null,
    });

    const res = await adminListStudentStrikesAction();
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data[0]).toEqual({
        student_id: validStudentId,
        student_name: "Test Student",
        college_id_last4: "1234",
        strike_count: 3,
        last_no_show_at: "2026-10-18T10:00:00Z",
        is_limited: true,
      });
      expect(res.data[0]).not.toHaveProperty("email");
    }
  });

  it("adminClearStudentStrikesAction invokes RPC with studentId and reason", async () => {
    mockRequireRole.mockResolvedValue({ id: "admin-id", role: "admin" });
    mockRpc.mockResolvedValue({
      data: { ok: true, student_id: validStudentId },
      error: null,
    });

    const res = await adminClearStudentStrikesAction(validStudentId, "Medical waiver");
    expect(res.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("admin_clear_student_strikes", {
      p_student_id: validStudentId,
      p_reason: "Medical waiver",
    });
  });
});
