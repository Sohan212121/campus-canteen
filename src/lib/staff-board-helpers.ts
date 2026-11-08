import type { BoardOrder, StaffBoardData, StaffOrderStatus } from "@/server/actions/staff";

/**
 * Pure helper functions for the Staff Kitchen Board and Pickup views.
 * Designed for predictable optimistic updates, rollback, echo suppression,
 * and low-end mobile / WebView performance.
 */

/**
 * Computes the target column bucket for an order status.
 */
export function getColumnForStatus(status: StaffOrderStatus): "new" | "preparing" | "ready" | "completed" {
  switch (status) {
    case "PLACED":
      return "new";
    case "ACCEPTED":
    case "PREPARING":
      return "preparing";
    case "READY":
      return "ready";
    case "COLLECTED":
    case "CANCELLED":
    case "REJECTED":
    case "NO_SHOW":
    default:
      return "completed";
  }
}

/**
 * Finds an order anywhere in the board data.
 */
export function findOrderInBoard(board: StaffBoardData, orderId: string): BoardOrder | null {
  return (
    board.newOrders.find((o) => o.id === orderId) ||
    board.preparingOrders.find((o) => o.id === orderId) ||
    board.readyOrders.find((o) => o.id === orderId) ||
    board.completedOrders.find((o) => o.id === orderId) ||
    null
  );
}

/**
 * Sorts orders within a column stably:
 * - Active columns (new, preparing, ready): earliest estimated_ready_at first.
 * - Completed column: newest placed_at / completed first.
 */
export function sortColumnOrders(orders: BoardOrder[], column: "new" | "preparing" | "ready" | "completed"): BoardOrder[] {
  const copy = [...orders];
  if (column === "completed") {
    return copy.sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime());
  }
  return copy.sort((a, b) => {
    const diff = new Date(a.estimated_ready_at).getTime() - new Date(b.estimated_ready_at).getTime();
    if (diff !== 0) return diff;
    return new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime();
  });
}

/**
 * Optimistically moves an order to its target column and updates its status.
 * Returns the updated board and the original order snapshot for rollback.
 */
export function optimisticTransition(
  board: StaffBoardData,
  orderId: string,
  toStatus: StaffOrderStatus
): { nextBoard: StaffBoardData; previousOrder: BoardOrder | null } {
  const currentOrder = findOrderInBoard(board, orderId);
  if (!currentOrder) {
    return { nextBoard: board, previousOrder: null };
  }

  const updatedOrder: BoardOrder = {
    ...currentOrder,
    status: toStatus,
  };

  const targetCol = getColumnForStatus(toStatus);

  // Remove from all existing columns
  const nextNew = board.newOrders.filter((o) => o.id !== orderId);
  const nextPrep = board.preparingOrders.filter((o) => o.id !== orderId);
  const nextReady = board.readyOrders.filter((o) => o.id !== orderId);
  const nextCompleted = board.completedOrders.filter((o) => o.id !== orderId);

  // Add to target column
  if (targetCol === "new") {
    nextNew.push(updatedOrder);
  } else if (targetCol === "preparing") {
    nextPrep.push(updatedOrder);
  } else if (targetCol === "ready") {
    nextReady.push(updatedOrder);
  } else {
    nextCompleted.unshift(updatedOrder);
  }

  return {
    nextBoard: {
      ...board,
      newOrders: sortColumnOrders(nextNew, "new"),
      preparingOrders: sortColumnOrders(nextPrep, "preparing"),
      readyOrders: sortColumnOrders(nextReady, "ready"),
      completedOrders: sortColumnOrders(nextCompleted, "completed"),
    },
    previousOrder: currentOrder,
  };
}

/**
 * Rolls back an optimistic transition to the exact previous order state.
 */
export function rollbackTransition(board: StaffBoardData, previousOrder: BoardOrder): StaffBoardData {
  const orderId = previousOrder.id;
  const targetCol = getColumnForStatus(previousOrder.status);

  // Remove current position
  const nextNew = board.newOrders.filter((o) => o.id !== orderId);
  const nextPrep = board.preparingOrders.filter((o) => o.id !== orderId);
  const nextReady = board.readyOrders.filter((o) => o.id !== orderId);
  const nextCompleted = board.completedOrders.filter((o) => o.id !== orderId);

  // Re-insert into original column
  if (targetCol === "new") {
    nextNew.push(previousOrder);
  } else if (targetCol === "preparing") {
    nextPrep.push(previousOrder);
  } else if (targetCol === "ready") {
    nextReady.push(previousOrder);
  } else {
    nextCompleted.push(previousOrder);
  }

  return {
    ...board,
    newOrders: sortColumnOrders(nextNew, "new"),
    preparingOrders: sortColumnOrders(nextPrep, "preparing"),
    readyOrders: sortColumnOrders(nextReady, "ready"),
    completedOrders: sortColumnOrders(nextCompleted, "completed"),
  };
}

/**
 * Merges freshly fetched board data from the server while protecting any in-flight
 * pending optimistic orders from being reverted to their pre-action status or column.
 */
export function reconcileBoardWithPending(
  fetchedBoard: StaffBoardData,
  pendingOrders: Record<string, { toStatus: StaffOrderStatus; order: BoardOrder }>
): StaffBoardData {
  const pendingKeys = Object.keys(pendingOrders);
  if (pendingKeys.length === 0) {
    return fetchedBoard;
  }

  let reconciled = { ...fetchedBoard };

  for (const orderId of pendingKeys) {
    const pending = pendingOrders[orderId];
    if (!pending) continue;

    // Apply the pending optimistic state onto the fetched board
    const { nextBoard } = optimisticTransition(reconciled, orderId, pending.toStatus);
    reconciled = nextBoard;
  }

  return reconciled;
}

/**
 * Checks whether an incoming realtime event is a recent echo of a local staff action.
 */
export function isEchoIgnored(
  orderId: string,
  recentTransitions: Record<string, number>,
  windowMs = 1500,
  now = Date.now()
): boolean {
  const timestamp = recentTransitions[orderId];
  if (!timestamp) return false;
  return now - timestamp < windowMs;
}

/**
 * Records a timestamp for a transition to suppress immediate realtime echoes.
 */
export function recordTransitionEcho(
  orderId: string,
  recentTransitions: Record<string, number>,
  now = Date.now()
): Record<string, number> {
  return {
    ...recentTransitions,
    [orderId]: now,
  };
}

/**
 * Cleans out expired echo suppression timestamps.
 */
export function cleanExpiredEchoes(
  recentTransitions: Record<string, number>,
  windowMs = 1500,
  now = Date.now()
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [id, time] of Object.entries(recentTransitions)) {
    if (now - time < windowMs) {
      next[id] = time;
    }
  }
  return next;
}

/**
 * Exponential backoff calculation for realtime reconnection attempts.
 * Returns delay in milliseconds with a specified cap.
 */
export function calculateReconnectBackoff(attempt: number, baseMs = 1000, maxMs = 16000): number {
  if (attempt <= 0) return baseMs;
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add a small jitter (±10%) to prevent lockstep stampedes
  const jitter = exp * (0.9 + Math.random() * 0.2);
  return Math.min(Math.round(jitter), maxMs);
}

/**
 * Factory for a QR scan payload debouncer. Prevents 30fps camera feeds from
 * submitting identical payloads repeatedly within the debounce window.
 */
export function createScanDebouncer(windowMs = 1500) {
  let lastPayload = "";
  let lastTime = 0;

  return {
    shouldProcess(payload: string, now = Date.now()): boolean {
      const clean = payload.trim();
      if (!clean) return false;
      if (clean === lastPayload && now - lastTime < windowMs) {
        return false;
      }
      lastPayload = clean;
      lastTime = now;
      return true;
    },
    reset() {
      lastPayload = "";
      lastTime = 0;
    },
  };
}
