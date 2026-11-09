import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  ACTIVE_ORDER_STATUSES,
  isStatusActive,
  mergeActiveOrders,
  mergePastOrders,
  reduceOrderRealtimeEvent,
  createResumeDebouncer,
} from "@/lib/orders-list-helpers";
import type { OrderSummaryItem } from "@/components/student/orders-list-view";

function createMockOrder(id: string, code: string, status: string, placedAt: string): OrderSummaryItem {
  return {
    id,
    order_code: code,
    status,
    total_paise: 12000,
    placed_at: placedAt,
    estimated_ready_at: "2026-11-09T10:15:00Z",
    pickup_window_end: "2026-11-09T10:30:00Z",
    canteens: { name: "Main Canteen", location: "Block A" },
    order_items: [
      { id: "item-1", name_snapshot: "Veg Biryani", quantity: 1, unit_price_paise: 12000 },
    ],
  };
}

describe("Orders List Reducer & Helpers", () => {
  describe("ACTIVE_ORDER_STATUSES & isStatusActive", () => {
    it("matches exact active statuses used in page.tsx", () => {
      expect(ACTIVE_ORDER_STATUSES).toEqual(["PLACED", "ACCEPTED", "PREPARING", "READY"]);
      expect(isStatusActive("PLACED")).toBe(true);
      expect(isStatusActive("ACCEPTED")).toBe(true);
      expect(isStatusActive("PREPARING")).toBe(true);
      expect(isStatusActive("READY")).toBe(true);
      expect(isStatusActive("COLLECTED")).toBe(false);
      expect(isStatusActive("CANCELLED")).toBe(false);
      expect(isStatusActive("REJECTED")).toBe(false);
      expect(isStatusActive("NO_SHOW")).toBe(false);
    });
  });

  describe("mergeActiveOrders", () => {
    it("merges active orders, deduplicates by ID, and sorts descending by placed_at", () => {
      const o1 = createMockOrder("1", "A1", "PLACED", "2026-11-09T08:00:00Z");
      const o2 = createMockOrder("2", "A2", "ACCEPTED", "2026-11-09T09:00:00Z");
      const o2Updated = createMockOrder("2", "A2", "PREPARING", "2026-11-09T09:00:00Z");
      const o3 = createMockOrder("3", "A3", "READY", "2026-11-09T09:30:00Z");

      const merged = mergeActiveOrders([o1, o2], [o2Updated, o3]);
      expect(merged).toHaveLength(3);
      expect(merged.map((o) => o.id)).toEqual(["3", "2", "1"]); // 09:30, 09:00, 08:00
      expect(merged.find((o) => o.id === "2")?.status).toBe("PREPARING");
    });
  });

  describe("mergePastOrders", () => {
    it("preserves older loaded past orders while prepending / updating latest past orders", () => {
      // Simulating a student who previously tapped "Load More" and has older orders
      const olderOrder = createMockOrder("old-1", "O10", "COLLECTED", "2026-11-08T12:00:00Z");
      const existingRecent = createMockOrder("rec-1", "R10", "COLLECTED", "2026-11-09T07:00:00Z");
      const existingPast = [existingRecent, olderOrder];

      // A newly collected order arrives in the latest past query
      const newlyCollected = createMockOrder("newly-coll", "NC1", "COLLECTED", "2026-11-09T09:45:00Z");
      const updatedRecent = { ...existingRecent, total_paise: 15000 };

      const merged = mergePastOrders(existingPast, [newlyCollected, updatedRecent]);

      // All 3 orders must be present (older past order preserved!)
      expect(merged).toHaveLength(3);
      expect(merged.map((o) => o.id)).toEqual(["newly-coll", "rec-1", "old-1"]);
      expect(merged.find((o) => o.id === "rec-1")?.total_paise).toBe(15000);
      expect(merged.find((o) => o.id === "old-1")).toBeDefined();
    });
  });

  describe("reduceOrderRealtimeEvent", () => {
    it("handles INSERT of a new active order: prepends to active orders without duplicates", () => {
      const existingActive = [createMockOrder("1", "A1", "ACCEPTED", "2026-11-09T08:00:00Z")];
      const existingPast: OrderSummaryItem[] = [];

      const newOrder = createMockOrder("2", "A2", "PLACED", "2026-11-09T09:00:00Z");
      const result = reduceOrderRealtimeEvent(existingActive, existingPast, newOrder, "INSERT");

      expect(result.nextActive).toHaveLength(2);
      expect(result.nextActive[0].id).toBe("2"); // Newest on top
      expect(result.nextPast).toHaveLength(0);
    });

    it("handles UPDATE from active to terminal (COLLECTED): moves order from active to past", () => {
      const activeOrder = createMockOrder("1", "A1", "READY", "2026-11-09T08:00:00Z");
      const activeList = [activeOrder];
      const pastList = [createMockOrder("prev", "P1", "COLLECTED", "2026-11-09T07:00:00Z")];

      const collectedOrder = { ...activeOrder, status: "COLLECTED" };
      const result = reduceOrderRealtimeEvent(activeList, pastList, collectedOrder, "UPDATE");

      // Must be removed from active
      expect(result.nextActive.some((o) => o.id === "1")).toBe(false);
      expect(result.nextActive).toHaveLength(0);

      // Must be merged into past at the proper sort position
      expect(result.nextPast.some((o) => o.id === "1")).toBe(true);
      expect(result.nextPast[0].id).toBe("1"); // 08:00 before 07:00
      expect(result.nextPast[0].status).toBe("COLLECTED");
    });

    it("handles DELETE: removes order from both lists", () => {
      const active = [createMockOrder("1", "A1", "PLACED", "2026-11-09T08:00:00Z")];
      const past = [createMockOrder("2", "A2", "COLLECTED", "2026-11-09T07:00:00Z")];

      const res1 = reduceOrderRealtimeEvent(active, past, active[0], "DELETE");
      expect(res1.nextActive).toHaveLength(0);

      const res2 = reduceOrderRealtimeEvent(active, past, past[0], "DELETE");
      expect(res2.nextPast).toHaveLength(0);
    });
  });

  describe("createResumeDebouncer (leading + trailing debounce)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("executes leading edge immediately, then trailing edge once after burst", () => {
      const mockFn = vi.fn();
      const debouncer = createResumeDebouncer(mockFn, 750);

      // Event 1 (leading edge: visibilitychange)
      debouncer.trigger();
      expect(mockFn).toHaveBeenCalledTimes(1);

      // Burst of subsequent events within 750ms: pageshow, focus, online
      vi.advanceTimersByTime(50);
      debouncer.trigger();
      vi.advanceTimersByTime(50);
      debouncer.trigger();
      vi.advanceTimersByTime(50);
      debouncer.trigger();

      // Still only 1 call during the burst
      expect(mockFn).toHaveBeenCalledTimes(1);

      // Settle timer
      vi.advanceTimersByTime(750);

      // Trailing edge fired once
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("Static Architectural Check: OrdersListView single channel & cleanup", () => {
    it("ensures OrdersListView uses a single channel and cleans it up on unmount", () => {
      const filePath = path.resolve(__dirname, "../../components/student/orders-list-view.tsx");
      const content = fs.readFileSync(filePath, "utf-8");

      // Verify channel creation
      expect(content).toContain("supabase.channel(");

      // Verify removal on unmount
      expect(content).toContain("supabase.removeChannel(");

      // Verify NO multiple channel registrations inside the effect
      const channelMatches = content.match(/supabase\.channel\(/g);
      expect(channelMatches).toHaveLength(1);
    });
  });
});
