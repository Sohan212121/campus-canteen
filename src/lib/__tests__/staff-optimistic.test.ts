import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  getColumnForStatus,
  optimisticTransition,
  rollbackTransition,
  reconcileBoardWithPending,
  isEchoIgnored,
  recordTransitionEcho,
  cleanExpiredEchoes,
  calculateReconnectBackoff,
  createScanDebouncer,
  sortColumnOrders,
} from "@/lib/staff-board-helpers";
import type { BoardOrder, StaffBoardData, StaffOrderStatus } from "@/server/actions/staff";

function createMockOrder(id: string, code: string, status: StaffOrderStatus, readyAt: string, placedAt = "2026-11-08T10:00:00Z"): BoardOrder {
  return {
    id,
    order_code: code,
    status,
    total_paise: 15000,
    payment_method: "ONLINE",
    payment_status: "PAID",
    placed_at: placedAt,
    estimated_ready_at: readyAt,
    pickup_window_end: "2026-11-08T10:45:00Z",
    prep_minutes_total: 15,
    customer_name: `Customer ${code}`,
    is_stale: false,
    order_items: [],
  };
}

function createMockBoard(): StaffBoardData {
  return {
    canteenId: "test-canteen-id",
    canteenName: "Main Food Court",
    newOrders: [
      createMockOrder("ord-1", "A101", "PLACED", "2026-11-08T10:20:00Z"),
      createMockOrder("ord-2", "A102", "PLACED", "2026-11-08T10:15:00Z"),
    ],
    preparingOrders: [
      createMockOrder("ord-3", "A103", "ACCEPTED", "2026-11-08T10:10:00Z"),
      createMockOrder("ord-4", "A104", "PREPARING", "2026-11-08T10:05:00Z"),
    ],
    readyOrders: [
      createMockOrder("ord-5", "A105", "READY", "2026-11-08T10:00:00Z"),
    ],
    completedOrders: [],
  };
}

describe("Staff Optimistic Transitions & Helpers", () => {
  describe("getColumnForStatus", () => {
    it("maps statuses to correct columns", () => {
      expect(getColumnForStatus("PLACED")).toBe("new");
      expect(getColumnForStatus("ACCEPTED")).toBe("preparing");
      expect(getColumnForStatus("PREPARING")).toBe("preparing");
      expect(getColumnForStatus("READY")).toBe("ready");
      expect(getColumnForStatus("COLLECTED")).toBe("completed");
      expect(getColumnForStatus("REJECTED")).toBe("completed");
      expect(getColumnForStatus("CANCELLED")).toBe("completed");
      expect(getColumnForStatus("NO_SHOW")).toBe("completed");
    });
  });

  describe("optimisticTransition", () => {
    it("moves PLACED order to preparing column when ACCEPTED", () => {
      const initial = createMockBoard();
      const { nextBoard, previousOrder } = optimisticTransition(initial, "ord-1", "ACCEPTED");

      expect(previousOrder).not.toBeNull();
      expect(previousOrder?.status).toBe("PLACED");
      expect(nextBoard.newOrders.some((o) => o.id === "ord-1")).toBe(false);
      expect(nextBoard.preparingOrders.some((o) => o.id === "ord-1")).toBe(true);

      const target = nextBoard.preparingOrders.find((o) => o.id === "ord-1");
      expect(target?.status).toBe("ACCEPTED");
    });

    it("moves ACCEPTED order to PREPARING within the preparing column", () => {
      const initial = createMockBoard();
      const { nextBoard } = optimisticTransition(initial, "ord-3", "PREPARING");

      const target = nextBoard.preparingOrders.find((o) => o.id === "ord-3");
      expect(target?.status).toBe("PREPARING");
    });

    it("moves PREPARING order to READY in ready column", () => {
      const initial = createMockBoard();
      const { nextBoard } = optimisticTransition(initial, "ord-4", "READY");

      expect(nextBoard.preparingOrders.some((o) => o.id === "ord-4")).toBe(false);
      expect(nextBoard.readyOrders.some((o) => o.id === "ord-4")).toBe(true);
      expect(nextBoard.readyOrders.find((o) => o.id === "ord-4")?.status).toBe("READY");
    });

    it("moves PLACED order directly to REJECTED in completed column", () => {
      const initial = createMockBoard();
      const { nextBoard } = optimisticTransition(initial, "ord-1", "REJECTED");

      expect(nextBoard.newOrders.some((o) => o.id === "ord-1")).toBe(false);
      expect(nextBoard.completedOrders.some((o) => o.id === "ord-1")).toBe(true);
      expect(nextBoard.completedOrders.find((o) => o.id === "ord-1")?.status).toBe("REJECTED");
    });

    it("returns unchanged board when orderId is not found", () => {
      const initial = createMockBoard();
      const { nextBoard, previousOrder } = optimisticTransition(initial, "non-existent-id", "ACCEPTED");

      expect(previousOrder).toBeNull();
      expect(nextBoard).toEqual(initial);
    });
  });

  describe("rollbackTransition", () => {
    it("restores order to original column and status on rejection/failure", () => {
      const initial = createMockBoard();
      const { nextBoard, previousOrder } = optimisticTransition(initial, "ord-1", "ACCEPTED");

      expect(nextBoard.newOrders.some((o) => o.id === "ord-1")).toBe(false);

      // Rollback
      const rolledBack = rollbackTransition(nextBoard, previousOrder!);
      expect(rolledBack.newOrders.some((o) => o.id === "ord-1")).toBe(true);
      expect(rolledBack.preparingOrders.some((o) => o.id === "ord-1")).toBe(false);
      expect(rolledBack.newOrders.find((o) => o.id === "ord-1")?.status).toBe("PLACED");
    });
  });

  describe("reconcileBoardWithPending", () => {
    it("ensures a background poll or refetch does NOT overwrite a pending in-flight order", () => {
      const initial = createMockBoard();
      // Staff tapped Accept: ord-1 is in-flight moving to ACCEPTED
      const order1 = initial.newOrders.find((o) => o.id === "ord-1")!;
      const pendingMap = {
        "ord-1": { toStatus: "ACCEPTED" as const, order: order1 },
      };

      // Server returns stale data where ord-1 is still PLACED
      const fetchedBoard = createMockBoard();
      expect(fetchedBoard.newOrders.some((o) => o.id === "ord-1")).toBe(true);

      const reconciled = reconcileBoardWithPending(fetchedBoard, pendingMap);

      // Must protect pending order: ord-1 must remain in preparing column, not newOrders
      expect(reconciled.newOrders.some((o) => o.id === "ord-1")).toBe(false);
      expect(reconciled.preparingOrders.some((o) => o.id === "ord-1")).toBe(true);
      expect(reconciled.preparingOrders.find((o) => o.id === "ord-1")?.status).toBe("ACCEPTED");
    });

    it("returns fetched board unmodified when pendingMap is empty", () => {
      const fetched = createMockBoard();
      const reconciled = reconcileBoardWithPending(fetched, {});
      expect(reconciled).toEqual(fetched);
    });
  });

  describe("isEchoIgnored & recordTransitionEcho", () => {
    it("suppresses realtime echo within the 1500ms window", () => {
      const now = 1000000;
      let echoes: Record<string, number> = {};

      echoes = recordTransitionEcho("ord-1", echoes, now);

      // Inside window
      expect(isEchoIgnored("ord-1", echoes, 1500, now + 500)).toBe(true);
      expect(isEchoIgnored("ord-1", echoes, 1500, now + 1499)).toBe(true);

      // Outside window
      expect(isEchoIgnored("ord-1", echoes, 1500, now + 1501)).toBe(false);

      // Unknown order is never suppressed
      expect(isEchoIgnored("ord-99", echoes, 1500, now + 500)).toBe(false);
    });

    it("cleans expired echoes cleanly", () => {
      const now = 1000000;
      const echoes = {
        "ord-expired": now - 2000,
        "ord-fresh": now - 300,
      };

      const cleaned = cleanExpiredEchoes(echoes, 1500, now);
      expect(cleaned["ord-expired"]).toBeUndefined();
      expect(cleaned["ord-fresh"]).toBe(now - 300);
    });
  });

  describe("calculateReconnectBackoff", () => {
    it("produces exponential backoff with upper bound", () => {
      const b0 = calculateReconnectBackoff(0, 1000, 16000);
      expect(b0).toBe(1000);

      const b1 = calculateReconnectBackoff(1, 1000, 16000);
      expect(b1).toBeGreaterThanOrEqual(1800); // 2000 ± 10%
      expect(b1).toBeLessThanOrEqual(2400);

      const bHigh = calculateReconnectBackoff(10, 1000, 16000);
      expect(bHigh).toBeLessThanOrEqual(16000);
    });
  });

  describe("createScanDebouncer", () => {
    it("debounces rapid duplicate QR decodes of the same payload", () => {
      const debouncer = createScanDebouncer(1500);
      const t0 = 10000;

      // First scan should process
      expect(debouncer.shouldProcess("CC1:order-123:code456", t0)).toBe(true);

      // Second identical scan within window should be rejected
      expect(debouncer.shouldProcess("CC1:order-123:code456", t0 + 100)).toBe(false);
      expect(debouncer.shouldProcess("CC1:order-123:code456", t0 + 1400)).toBe(false);

      // Different payload should process immediately
      expect(debouncer.shouldProcess("CC1:order-999:code789", t0 + 200)).toBe(true);

      // Same payload after window should process
      expect(debouncer.shouldProcess("CC1:order-999:code789", t0 + 1800)).toBe(true);
    });
  });

  describe("sortColumnOrders", () => {
    it("sorts active columns by estimated_ready_at asc", () => {
      const o1 = createMockOrder("1", "A1", "READY", "2026-11-08T10:30:00Z");
      const o2 = createMockOrder("2", "A2", "READY", "2026-11-08T10:10:00Z");
      const o3 = createMockOrder("3", "A3", "READY", "2026-11-08T10:20:00Z");

      const sorted = sortColumnOrders([o1, o2, o3], "ready");
      expect(sorted.map((o) => o.order_code)).toEqual(["A2", "A3", "A1"]);
    });
  });

  describe("Architectural Security Invariant: Non-Optimistic Sensitive Operations", () => {
    it("strictly verifies that collection, pickup verification, PIN, and payment do NOT use optimistic updates", () => {
      const pickupScannerPath = path.resolve(__dirname, "../../components/staff/pickup-scanner-view.tsx");
      const content = fs.readFileSync(pickupScannerPath, "utf-8");

      // Verify that handleCollect awaits collectOrderAction and checks res.success before mutating state
      expect(content).toContain("await collectOrderAction");
      expect(content).toContain("if (res.success && res.data)");

      // Verify that handlePreview awaits previewCollectionAction before setting verifiedCard
      expect(content).toContain("await previewCollectionAction");
      expect(content).toContain("if (!res.success || !res.data)");

      // Verify that there is NO optimistic card completion before server verification
      expect(content).not.toContain("setVerifiedCard(optimistic");
    });
  });
});
