export const CANCELLABLE_STATUSES = ["PLACED"] as const;
export type CancellableStatus = (typeof CANCELLABLE_STATUSES)[number];

export const TERMINAL_STATUSES = ["CANCELLED", "REJECTED", "COLLECTED"] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const ACTIVE_STATUSES = ["PLACED", "ACCEPTED", "PREPARING", "READY"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const ORDER_LIFECYCLE_STEPS = [
  { status: "PLACED", label: "Placed", description: "Sent to canteen" },
  { status: "ACCEPTED", label: "Accepted", description: "Kitchen acknowledged" },
  { status: "PREPARING", label: "Preparing", description: "Cooking meal" },
  { status: "READY", label: "Ready", description: "Ready at counter" },
  { status: "COLLECTED", label: "Collected", description: "Picked up" },
] as const;

/**
 * Returns whether an order with the given status can be cancelled by the student.
 */
export function isOrderCancellable(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Determines whether the pickup token / QR code should be rendered.
 * Renders only while the status is not terminal (CANCELLED, REJECTED, COLLECTED).
 * Must hide immediately when a status becomes terminal.
 */
export function canShowPickupToken(status: string): boolean {
  return !(TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Determines whether an order is actively in flight.
 */
export function isOrderActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Formats a timestamp into an IST time string (e.g. 1:15 PM) with Asia/Kolkata timezone.
 */
export function formatIstTime(isoString: string | null | undefined): string {
  if (!isoString) return "--:--";
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

/**
 * Formats a timestamp into an IST date and time string (e.g. 10 Oct, 1:15 PM) with Asia/Kolkata timezone.
 */
export function formatIstDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "--";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

/**
 * Returns badge styling and human readable label for order status.
 */
export function getStatusBadgeConfig(status: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
} {
  switch (status) {
    case "PLACED":
      return {
        label: "Placed",
        variant: "secondary",
        className: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
      };
    case "ACCEPTED":
      return {
        label: "Accepted",
        variant: "secondary",
        className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
      };
    case "PREPARING":
      return {
        label: "Preparing",
        variant: "secondary",
        className: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 animate-pulse",
      };
    case "READY":
      return {
        label: "Ready for Pickup",
        variant: "default",
        className: "bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs",
      };
    case "COLLECTED":
      return {
        label: "Collected",
        variant: "outline",
        className: "bg-muted text-muted-foreground border-border",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        variant: "destructive",
        className: "bg-destructive/10 text-destructive border-destructive/20",
      };
    case "REJECTED":
      return {
        label: "Rejected",
        variant: "destructive",
        className: "bg-destructive/10 text-destructive border-destructive/20",
      };
    default:
      return {
        label: status,
        variant: "outline",
        className: "text-muted-foreground",
      };
  }
}

/**
 * Calculates the time by which the kitchen must start preparing an order.
 * Defined as estimated_ready_at minus (prep_minutes_total in milliseconds).
 */
export function calculateStartPreparingBy(
  estimatedReadyAt: string | null | undefined,
  prepMinutesTotal: number
): string {
  if (!estimatedReadyAt) return "--:--";
  try {
    const readyMs = new Date(estimatedReadyAt).getTime();
    const startMs = readyMs - Math.max(0, prepMinutesTotal) * 60 * 1000;
    return formatIstTime(new Date(startMs).toISOString());
  } catch {
    return "--:--";
  }
}

