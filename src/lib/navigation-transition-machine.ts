/**
 * Pure state machine and navigation helpers for Phase 2: Logo Transition Re-Design.
 * Handles fast-route skipping (60ms), minimum hold (350ms), hard upper limit (1200ms),
 * optimistic tab highlights, rapid tap replacement, and failsafe resets.
 */

import { normalizeNavPath } from "@/lib/student-nav";

export const FAST_ROUTE_THRESHOLD_MS = 60;
export const MIN_HOLD_MS = 350;
export const MAX_FAILSAFE_MS = 1200;
export const EXIT_FADE_MS = 180;

export type TransitionStatus = "idle" | "pending_fast_check" | "visible" | "exiting";
export type TransitionTheme = "standard" | "healthy";

export interface TransitionState {
  status: TransitionStatus;
  overlayVisible: boolean;
  isExiting: boolean;
  optimisticPath: string | null;
  targetPath: string | null;
  destinationLabel: string;
  theme: TransitionTheme;
  startTimestamp: number;
}

export const INITIAL_TRANSITION_STATE: TransitionState = {
  status: "idle",
  overlayVisible: false,
  isExiting: false,
  optimisticPath: null,
  targetPath: null,
  destinationLabel: "Campus Dining",
  theme: "standard",
  startTimestamp: 0,
};

export const SECTION_TITLES: Record<string, string> = {
  "/": "Campus Dining",
  "/menu": "Canteen Menu",
  "/cart": "Your Cart",
  "/orders": "Active Orders",
  "/profile": "Student Profile",
  "/checkout": "Secure Checkout",
  "/notifications": "Notifications",
  "/healthy": "Healthy Mode",
  "/healthy/score": "Healthy Score Guide",
};

export function getSectionTitle(path: string): string {
  const clean = normalizeNavPath(path);
  if (SECTION_TITLES[clean]) return SECTION_TITLES[clean];
  if (clean.startsWith("/healthy/score")) return "Healthy Score Guide";
  if (clean.startsWith("/healthy")) return "Healthy Mode";
  if (clean.startsWith("/orders/")) return "Order Token Tracker";
  if (clean.startsWith("/admin")) return "Staff & Canteen Admin";
  if (clean.startsWith("/staff")) return "Canteen Staff Board";
  return "Campus Dining";
}

/**
 * Checks whether an href should trigger a section transition:
 * - Skips external protocols, anchor hashes, query-only changes, same route re-taps
 * - Skips modified clicks, middle-clicks, target="_blank", downloads
 */
export function shouldTriggerTransition(params: {
  targetHref: string;
  currentPath: string;
  isReducedMotion?: boolean;
}): { shouldTrigger: boolean; cleanTarget: string; reason?: string } {
  const { targetHref, currentPath, isReducedMotion } = params;

  if (!targetHref) {
    return { shouldTrigger: false, cleanTarget: "", reason: "empty_href" };
  }

  // Ignore external or protocol links
  if (
    targetHref.startsWith("http://") ||
    targetHref.startsWith("https://") ||
    targetHref.startsWith("#") ||
    targetHref.startsWith("mailto:") ||
    targetHref.startsWith("tel:")
  ) {
    return { shouldTrigger: false, cleanTarget: "", reason: "external_or_hash" };
  }

  const cleanTarget = normalizeNavPath(targetHref);
  const cleanCurrent = normalizeNavPath(currentPath);

  if (!cleanTarget) {
    return { shouldTrigger: false, cleanTarget: "", reason: "invalid_path" };
  }

  // Same route re-tap or query-only change on the same route
  if (cleanTarget === cleanCurrent) {
    return { shouldTrigger: false, cleanTarget, reason: "same_route" };
  }

  if (isReducedMotion) {
    return { shouldTrigger: false, cleanTarget, reason: "reduced_motion" };
  }

  return { shouldTrigger: true, cleanTarget };
}

/**
 * Pure transition engine managing state updates.
 */
export class NavigationTransitionMachine {
  private state: TransitionState;
  private lastTapTimestamp: number = 0;
  private lastTapTarget: string | null = null;

  constructor(initialState: Partial<TransitionState> = {}) {
    this.state = { ...INITIAL_TRANSITION_STATE, ...initialState };
  }

  public getState(): Readonly<TransitionState> {
    return this.state;
  }

  /**
   * Guards against duplicate trigger on a single tap (e.g. bottom-nav onClick + document click listener)
   */
  public isDuplicateTap(targetPath: string, now: number): boolean {
    const cleanTarget = normalizeNavPath(targetPath);
    if (this.lastTapTarget === cleanTarget && now - this.lastTapTimestamp < 50) {
      return true;
    }
    return false;
  }

  /**
   * Start a transition toward targetPath.
   * Immediately sets optimisticPath for instant tab highlight.
   * If reducedMotion is true, updates optimisticPath without showing overlay.
   */
  public start(params: {
    targetPath: string;
    customLabel?: string;
    now: number;
    isReducedMotion?: boolean;
  }): { action: "schedule_fast_check" | "optimistic_only" | "ignored" } {
    const { targetPath, customLabel, now, isReducedMotion } = params;
    const cleanTarget = normalizeNavPath(targetPath);

    if (this.isDuplicateTap(cleanTarget, now)) {
      return { action: "ignored" };
    }

    this.lastTapTimestamp = now;
    this.lastTapTarget = cleanTarget;

    const isHealthy = cleanTarget.startsWith("/healthy");
    const theme: TransitionTheme = isHealthy ? "healthy" : "standard";
    const label =
      customLabel ||
      (isHealthy
        ? cleanTarget === "/healthy/score"
          ? "Healthy Score Guide"
          : "Healthy Mode"
        : getSectionTitle(cleanTarget));

    if (isReducedMotion) {
      this.state = {
        ...INITIAL_TRANSITION_STATE,
        optimisticPath: cleanTarget,
      };
      return { action: "optimistic_only" };
    }

    // Replace any active transition with the newest target (rapid tap handling)
    this.state = {
      status: "pending_fast_check",
      overlayVisible: false,
      isExiting: false,
      optimisticPath: cleanTarget,
      targetPath: cleanTarget,
      destinationLabel: label,
      theme,
      startTimestamp: now,
    };

    return { action: "schedule_fast_check" };
  }

  /**
   * Called when 60ms fast route threshold elapses.
   * If the route has not already completed, show the overlay.
   */
  public onFastCheckElapsed(): boolean {
    if (this.state.status === "pending_fast_check") {
      this.state = {
        ...this.state,
        status: "visible",
        overlayVisible: true,
      };
      return true;
    }
    return false;
  }

  /**
   * Called when the browser pathname changes.
   * Evaluates if destination is reached, if it's a redirect, and triggers exit timing.
   */
  public onPathnameChange(params: {
    newPathname: string;
    now: number;
  }): {
    action: "skip_overlay" | "schedule_exit" | "exit_immediately" | "redirect_reset" | "noop";
    delayMs?: number;
  } {
    const { newPathname, now } = params;
    const cleanNew = normalizeNavPath(newPathname);

    if (this.state.status === "idle") {
      return { action: "noop" };
    }

    const target = this.state.targetPath;

    // Condition 1: Fast route (< 60ms) - skip overlay entirely
    if (this.state.status === "pending_fast_check") {
      const elapsed = now - this.state.startTimestamp;
      if (elapsed <= FAST_ROUTE_THRESHOLD_MS) {
        this.reset();
        return { action: "skip_overlay" };
      }
    }

    // Condition 2: Redirected to a route different from the tapped target
    if (target && cleanNew !== target) {
      this.reset();
      return { action: "redirect_reset" };
    }

    // Condition 3: Reached target route - check minimum 350ms hold
    const elapsed = now - this.state.startTimestamp;
    if (elapsed >= MIN_HOLD_MS) {
      this.state = {
        ...this.state,
        status: "exiting",
        isExiting: true,
        optimisticPath: null, // Destination reached: clear optimistic path so real pathname takes over
      };
      return { action: "exit_immediately" };
    } else {
      const remainingDelay = MIN_HOLD_MS - elapsed;
      return { action: "schedule_exit", delayMs: remainingDelay };
    }
  }

  /**
   * Trigger exit fade once the minimum 350ms hold has completed.
   */
  public onMinHoldElapsed(): void {
    if (this.state.status === "visible" || this.state.status === "pending_fast_check") {
      this.state = {
        ...this.state,
        status: "exiting",
        isExiting: true,
        optimisticPath: null,
      };
    }
  }

  /**
   * Called when the 1200ms hard upper cap fires.
   * Unconditionally starts exit fade and resets optimistic path.
   */
  public onFailsafeCap(): void {
    if (this.state.status !== "idle") {
      this.state = {
        ...this.state,
        status: "exiting",
        isExiting: true,
        optimisticPath: null,
      };
    }
  }

  /**
   * Called when 180ms exit fade completes.
   * Cleans up state back to idle.
   */
  public onExitFadeComplete(): void {
    this.reset();
  }

  /**
   * Cancels transition and resets optimistic path back to real pathname.
   * Used on popstate (Back/Forward), visibilitychange (hidden), pagehide, or failure.
   */
  public cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.state = { ...INITIAL_TRANSITION_STATE };
    this.lastTapTarget = null;
  }
}

