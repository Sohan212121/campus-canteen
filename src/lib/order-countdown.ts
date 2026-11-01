import { formatIstTime } from "./order-status";

export interface HoldWindowCountdown {
  totalSeconds: number;
  remainingSeconds: number;
  percentRemaining: number;
  isExpired: boolean;
  isUrgent: boolean;
  isWarning: boolean;
  formattedTime: string;
}

/**
 * Returns a human-friendly relative readiness string for in-progress orders.
 * Always clamps to a positive/graceful message (never negative numbers).
 */
export function formatRelativeReadyCountdown(
  estimatedReadyAt: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!estimatedReadyAt) return "Preparing shortly";

  const targetMs = new Date(estimatedReadyAt).getTime();
  if (Number.isNaN(targetMs)) return "Preparing shortly";

  const diffMs = targetMs - nowMs;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes > 1) {
    return `in ~${diffMinutes} min`;
  }
  if (diffMinutes === 1) {
    return "in ~1 min";
  }
  return "any moment now";
}

/**
 * Calculates remaining hold window time, percentage, and urgency thresholds for READY orders.
 */
export function calculateHoldWindowProgress(
  readyAt: string | null | undefined,
  pickupWindowEnd: string | null | undefined,
  holdMinutes: number = 15,
  nowMs: number = Date.now()
): HoldWindowCountdown {
  const safeHoldMinutes = Math.max(1, holdMinutes);
  const totalSeconds = safeHoldMinutes * 60;

  let expiryMs: number;
  if (readyAt) {
    const readyMs = new Date(readyAt).getTime();
    expiryMs = Number.isNaN(readyMs) ? nowMs : readyMs + safeHoldMinutes * 60 * 1000;
  } else if (pickupWindowEnd) {
    const endMs = new Date(pickupWindowEnd).getTime();
    expiryMs = Number.isNaN(endMs) ? nowMs : endMs;
  } else {
    expiryMs = nowMs + totalSeconds * 1000;
  }

  const rawRemainingSeconds = Math.floor((expiryMs - nowMs) / 1000);
  const remainingSeconds = Math.max(0, rawRemainingSeconds);
  const percentRemaining = Math.min(100, Math.max(0, (remainingSeconds / totalSeconds) * 100));

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const formattedTime = remainingSeconds > 0
    ? `${mins}m ${String(secs).padStart(2, "0")}s`
    : "Expired";

  return {
    totalSeconds,
    remainingSeconds,
    percentRemaining,
    isExpired: remainingSeconds === 0,
    isUrgent: remainingSeconds > 0 && remainingSeconds <= 120, // <= 2 mins
    isWarning: remainingSeconds > 0 && remainingSeconds <= 300, // <= 5 mins
    formattedTime,
  };
}

/**
 * Calculates stroke-dashoffset for circular SVG countdown rings.
 */
export function calculateProgressOffset(
  percentRemaining: number,
  circumference: number
): number {
  const clamped = Math.max(0, Math.min(100, percentRemaining));
  return circumference * (1 - clamped / 100);
}

/**
 * Extracts friendly step timestamps from order details.
 */
export function getStepTimestampText(
  status: string,
  order: {
    placed_at: string;
    ready_at?: string | null;
    collected_at?: string | null;
  }
): string | null {
  switch (status) {
    case "PLACED":
      return order.placed_at ? formatIstTime(order.placed_at) : null;
    case "READY":
      return order.ready_at ? formatIstTime(order.ready_at) : null;
    case "COLLECTED":
      return order.collected_at ? formatIstTime(order.collected_at) : null;
    default:
      return null;
  }
}

