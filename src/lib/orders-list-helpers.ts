import { ACTIVE_STATUSES, type ActiveStatus } from "@/lib/order-status";
import type { OrderSummaryItem } from "@/components/student/orders-list-view";

/**
 * Shared active statuses matching page.tsx and order-status.ts.
 */
export const ACTIVE_ORDER_STATUSES = ACTIVE_STATUSES;

export function isStatusActive(status: string): status is ActiveStatus {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Merges and deduplicates active orders, keeping newest placed_at first.
 */
export function mergeActiveOrders(
  current: OrderSummaryItem[],
  incoming: OrderSummaryItem[]
): OrderSummaryItem[] {
  const map = new Map<string, OrderSummaryItem>();
  for (const o of current) {
    if (isStatusActive(o.status)) {
      map.set(o.id, o);
    }
  }
  for (const o of incoming) {
    if (isStatusActive(o.status)) {
      map.set(o.id, o);
    } else {
      map.delete(o.id);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime()
  );
}

/**
 * Merges past orders by order ID:
 * - Updates existing past items with fresh server data
 * - Prepends newly terminal orders
 * - Strictly retains any older past orders loaded via "Load More"
 * - Maintains placed_at descending sort order
 */
export function mergePastOrders(
  existingPast: OrderSummaryItem[],
  incomingPast: OrderSummaryItem[]
): OrderSummaryItem[] {
  const map = new Map<string, OrderSummaryItem>();
  // 1. Seed with existing past orders (so older pages are preserved)
  for (const o of existingPast) {
    map.set(o.id, o);
  }
  // 2. Upsert incoming past orders (freshest server state)
  for (const o of incomingPast) {
    map.set(o.id, o);
  }
  // 3. Sort descending by placed_at
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime()
  );
}

/**
 * Pure reducer to handle realtime changes (INSERT, UPDATE, DELETE) on the client list.
 */
export function reduceOrderRealtimeEvent(
  currentActive: OrderSummaryItem[],
  currentPast: OrderSummaryItem[],
  order: OrderSummaryItem,
  eventType: "INSERT" | "UPDATE" | "DELETE"
): { nextActive: OrderSummaryItem[]; nextPast: OrderSummaryItem[] } {
  if (eventType === "DELETE") {
    return {
      nextActive: currentActive.filter((o) => o.id !== order.id),
      nextPast: currentPast.filter((o) => o.id !== order.id),
    };
  }

  const isActive = isStatusActive(order.status);

  if (isActive) {
    // Upsert into active orders, remove from past if it was there
    const nextActive = mergeActiveOrders(currentActive, [order]);
    const nextPast = currentPast.filter((o) => o.id !== order.id);
    return { nextActive, nextPast };
  } else {
    // Order is terminal (COLLECTED, CANCELLED, REJECTED, NO_SHOW)
    // Remove from active orders and merge into past orders
    const nextActive = currentActive.filter((o) => o.id !== order.id);
    const nextPast = mergePastOrders(currentPast, [order]);
    return { nextActive, nextPast };
  }
}

/**
 * Leading-plus-trailing debounce helper for app resume events.
 * Coalesces bursts of visibilitychange, pageshow, focus, and online into a single execution.
 */
export function createResumeDebouncer(fn: () => void, delayMs = 750) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCall = 0;

  return {
    trigger() {
      const now = Date.now();
      // Leading edge trigger if cool-down period has elapsed
      if (now - lastCall > delayMs) {
        lastCall = now;
        fn();
        return;
      }

      // Trailing edge trigger for subsequent events in the burst
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastCall = Date.now();
        fn();
        timer = null;
      }, delayMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
