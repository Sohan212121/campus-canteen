import { useSyncExternalStore } from "react";

export const ORDER_PLACED_SESSION_PREFIX = "cc_order_placed_";
export const ORDER_COLLECTED_STORAGE_PREFIX = "cc_order_collected_";
export const MAX_CELEBRATION_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function getPlacedSessionKey(orderId: string): string {
  return `${ORDER_PLACED_SESSION_PREFIX}${orderId}`;
}

export function getCollectedStorageKey(orderId: string): string {
  return `${ORDER_COLLECTED_STORAGE_PREFIX}${orderId}`;
}

/**
 * Checks if a given ISO timestamp occurred within recent minutes (accounting for minor clock skew).
 */
export function isWithinRecentWindow(
  timestampIso: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = MAX_CELEBRATION_AGE_MS
): boolean {
  if (!timestampIso) return false;
  const time = new Date(timestampIso).getTime();
  if (Number.isNaN(time)) return false;
  const diff = nowMs - time;
  // Allow up to 30s future clock skew
  return diff >= -30000 && diff <= maxAgeMs;
}

export interface ShouldShowPlacedCelebrationInput {
  status: string;
  placedAt: string;
  hasSessionFlag: boolean;
  isDev?: boolean;
  previewPlacedParam?: boolean;
  nowMs?: number;
  maxAgeMs?: number;
}

/**
 * Pure decision function: determines if the order placed celebration overlay should be displayed.
 * Requires:
 * 1. Status strictly PLACED (or dev preview param in development)
 * 2. SessionStorage flag set at checkout
 * 3. Placed within the last few minutes
 */
export function shouldShowPlacedCelebration({
  status,
  placedAt,
  hasSessionFlag,
  isDev = false,
  previewPlacedParam = false,
  nowMs = Date.now(),
  maxAgeMs = MAX_CELEBRATION_AGE_MS,
}: ShouldShowPlacedCelebrationInput): boolean {
  // Dev preview allowed ONLY when isDev is true (compiled out / ignored in production)
  if (isDev && previewPlacedParam) {
    return true;
  }

  if (status !== "PLACED") {
    return false;
  }

  if (!hasSessionFlag) {
    return false;
  }

  return isWithinRecentWindow(placedAt, nowMs, maxAgeMs);
}

export interface ShouldShowCollectedCelebrationInput {
  currentStatus: string;
  prevStatus?: string | null;
  collectedAt?: string | null;
  hasSeenCollected: boolean;
  isDev?: boolean;
  previewCollectedParam?: boolean;
  nowMs?: number;
  maxAgeMs?: number;
}

/**
 * Pure decision function: determines if the collected celebration moment should be displayed.
 * Requires:
 * 1. Current status strictly COLLECTED (never NO_SHOW, CANCELLED, REJECTED)
 * 2. Not previously seen for this order (persisted in localStorage)
 * 3. Either status changed to COLLECTED while page is open OR collected within the last few minutes
 */
export function shouldShowCollectedCelebration({
  currentStatus,
  prevStatus,
  collectedAt,
  hasSeenCollected,
  isDev = false,
  previewCollectedParam = false,
  nowMs = Date.now(),
  maxAgeMs = MAX_CELEBRATION_AGE_MS,
}: ShouldShowCollectedCelebrationInput): boolean {
  // Never show for terminal negative states
  if (["NO_SHOW", "CANCELLED", "REJECTED"].includes(currentStatus)) {
    return false;
  }

  // Dev preview allowed ONLY when isDev is true
  if (isDev && previewCollectedParam) {
    return true;
  }

  if (currentStatus !== "COLLECTED") {
    return false;
  }

  if (hasSeenCollected) {
    return false;
  }

  // Case 1: Status transitioned to COLLECTED while page was open
  const transitionedOnPage = Boolean(
    prevStatus && prevStatus !== "COLLECTED" && currentStatus === "COLLECTED"
  );
  if (transitionedOnPage) {
    return true;
  }

  // Case 2: Opened recently collected order within window
  if (collectedAt && isWithinRecentWindow(collectedAt, nowMs, maxAgeMs)) {
    return true;
  }

  return false;
}

function subscribeReducedMotion(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    () => false
  );
}

export interface ShouldRedirectEmptyCartInput {
  hasHydrated: boolean;
  itemsLength: number;
  hasPlacedOrder: boolean;
}

/**
 * Pure decision function: determines if an empty cart should trigger redirect to /menu.
 * Returns false when cart is still hydrating or when an order was just successfully placed.
 */
export function shouldRedirectEmptyCart({
  hasHydrated,
  itemsLength,
  hasPlacedOrder,
}: ShouldRedirectEmptyCartInput): boolean {
  if (!hasHydrated) return false;
  if (hasPlacedOrder) return false;
  return itemsLength === 0;
}

export interface RawPlacedOrderData {
  order_id: string;
  order_code: string;
  estimated_ready_at: string;
  total_paise: number;
}

export interface PlacedOrderSummary {
  order_id: string;
  order_code: string;
  estimated_ready_at: string;
  total_paise: number;
}

/**
 * Pure extractor: builds a validated placed order summary from the placement result.
 */
export function buildPlacedOrder(
  data: RawPlacedOrderData | null | undefined
): PlacedOrderSummary | null {
  if (!data || !data.order_id || !data.order_code) {
    return null;
  }
  return {
    order_id: data.order_id,
    order_code: data.order_code,
    estimated_ready_at: data.estimated_ready_at,
    total_paise: data.total_paise,
  };
}

/**
 * Returns the canonical order tracker route without celebration replay query params.
 */
export function getTrackOrderPath(orderId: string): string {
  return `/orders/${orderId}`;
}

/**
 * Decision rule: checkout handles celebration inline, so the placed session flag must not be written.
 */
export function shouldWritePlacedFlag(): boolean {
  return false;
}

/**
 * Pure validation: determines if the place order submission button can be clicked.
 */
export function canSubmitOrder({
  isSubmitting,
  hasPlacedOrder,
  itemsLength,
}: {
  isSubmitting: boolean;
  hasPlacedOrder: boolean;
  itemsLength: number;
}): boolean {
  if (isSubmitting) return false;
  if (hasPlacedOrder) return false;
  return itemsLength > 0;
}

/**
 * Returns the appropriate button label based on navigation transition state.
 */
export function getNavigationButtonLabel({
  isNavigating,
  defaultLabel,
}: {
  isNavigating: boolean;
  defaultLabel: string;
}): string {
  return isNavigating ? "Opening..." : defaultLabel;
}
