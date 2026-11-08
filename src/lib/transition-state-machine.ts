/**
 * Transition Readiness State Machine
 * Pure functions governing transition triggers, duration boundaries, and lifecycle states.
 */

export interface TransitionState {
  isTransitioning: boolean;
  isExiting: boolean;
  targetPath: string | null;
  startedAt: number | null;
}

export interface TransitionTriggerOptions {
  currentPath: string;
  destinationHref: string;
  isModifiedClick?: boolean;
  prefersReducedMotion?: boolean;
}

export const TRANSITION_CONFIG = {
  MIN_DISPLAY_MS: 350,
  MAX_FAILSAFE_MS: 1200,
  EXIT_FADE_MS: 240,
} as const;

/**
 * Determines whether a navigation event should trigger a transition.
 * Returns false on same route, query-only changes, hash-only, modified clicks, or reduced motion.
 */
export function shouldTriggerTransition(options: TransitionTriggerOptions): boolean {
  const {
    currentPath,
    destinationHref,
    isModifiedClick = false,
    prefersReducedMotion = false,
  } = options;

  if (isModifiedClick || prefersReducedMotion) {
    return false;
  }

  // Ignore external or non-http protocols
  if (
    destinationHref.startsWith("http://") ||
    destinationHref.startsWith("https://") ||
    destinationHref.startsWith("mailto:") ||
    destinationHref.startsWith("tel:")
  ) {
    return false;
  }

  // Hash-only links
  if (destinationHref.startsWith("#")) {
    return false;
  }

  const currentCleanPath = currentPath.split("?")[0].split("#")[0];
  const targetCleanPath = destinationHref.split("?")[0].split("#")[0];

  // No target or not an internal root path
  if (!targetCleanPath || !targetCleanPath.startsWith("/")) {
    return false;
  }

  // Same route or query-only / hash-only changes
  if (targetCleanPath === currentCleanPath) {
    return false;
  }

  return true;
}

/**
 * Pure transition state machine reducer for tracking navigation transitions.
 */
export type TransitionAction =
  | { type: "START"; targetPath: string; timestamp: number }
  | { type: "RAPID_TAP"; newTargetPath: string; timestamp: number }
  | { type: "ROUTE_MOUNTED"; timestamp: number }
  | { type: "FAILSAFE_TIMEOUT" }
  | { type: "FAILURE" }
  | { type: "REDIRECT"; redirectPath: string }
  | { type: "FINISH" }
  | { type: "CANCEL" };

export const INITIAL_TRANSITION_STATE: TransitionState = {
  isTransitioning: false,
  isExiting: false,
  targetPath: null,
  startedAt: null,
};

export function transitionReducer(
  state: TransitionState,
  action: TransitionAction
): TransitionState {
  switch (action.type) {
    case "START":
      return {
        isTransitioning: true,
        isExiting: false,
        targetPath: action.targetPath,
        startedAt: action.timestamp,
      };

    case "RAPID_TAP":
      // Replaces pending target and resets start timestamp for seamless rapid tapping
      return {
        ...state,
        targetPath: action.newTargetPath,
        startedAt: action.timestamp,
      };

    case "ROUTE_MOUNTED":
      // When route mounts, transition enters exit phase
      return {
        ...state,
        isExiting: true,
      };

    case "REDIRECT":
      // Redirect handling: updates pending target path to redirect destination
      return {
        ...state,
        targetPath: action.redirectPath,
      };

    case "FAILURE":
    case "FAILSAFE_TIMEOUT":
    case "CANCEL":
    case "FINISH":
      // Removes the overlay and resets all transition state
      return {
        isTransitioning: false,
        isExiting: false,
        targetPath: null,
        startedAt: null,
      };

    default:
      return state;
  }
}

/**
 * Calculates remaining hold time enforcing the minimum hold (e.g. 350ms) and maximum failsafe bounds.
 */
export function calculateRemainingHoldTime(
  startTime: number,
  currentTime: number,
  minHoldMs: number = TRANSITION_CONFIG.MIN_DISPLAY_MS
): number {
  const elapsed = Math.max(0, currentTime - startTime);
  return Math.max(0, minHoldMs - elapsed);
}
