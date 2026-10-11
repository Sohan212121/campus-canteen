import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  getNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/server/actions/notifications";

describe("notifications server actions", () => {
  const validNotificationId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-1",
      role: "student",
      is_active: true,
    });
  });

  describe("getNotificationsAction", () => {
    it("enforces requireRole(['student'])", async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              id: validNotificationId,
              user_id: "student-1",
              order_id: "order-1",
              title: "Order Ready",
              body: "Your order is ready",
              is_read: false,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        }),
      });

      const res = await getNotificationsAction();
      expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
      expect(res.success).toBe(true);
      expect(res.unreadCount).toBe(1);
    });
  });

  describe("markNotificationReadAction", () => {
    it("enforces requireRole(['student'])", async () => {
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const res = await markNotificationReadAction(validNotificationId);
      expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
      expect(res.success).toBe(true);
    });

    it("rejects non-UUID notification ID", async () => {
      const res = await markNotificationReadAction("invalid-uuid");
      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid notification ID.");
    });
  });

  describe("markAllNotificationsReadAction", () => {
    it("enforces requireRole(['student'])", async () => {
      mockFrom.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const res = await markAllNotificationsReadAction();
      expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
      expect(res.success).toBe(true);
    });
  });
});
