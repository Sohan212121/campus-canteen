/**
 * Pure countdown & expiry calculation helpers for rotating TOTP pickup codes.
 * Uses monotonic clock (performance.now) so device time changes cannot break countdown or refresh timers.
 */

/**
 * Computes the monotonic epoch timestamp when the current TOTP code will expire.
 * @param secondsRemaining Seconds remaining in the current window from the server (e.g. 1 to 60)
 * @param currentPerfNow Current monotonic time (defaults to performance.now())
 */
export function computeExpiresAtMonotonic(
  secondsRemaining: number,
  currentPerfNow: number = performance.now()
): number {
  const safeSeconds = Math.max(0, Math.min(60, Number(secondsRemaining) || 0));
  return currentPerfNow + safeSeconds * 1000;
}

/**
 * Calculates remaining integer seconds from a monotonic expiry timestamp.
 * Returns 0 if already expired or if expiresAt is null.
 */
export function calculateSecondsRemaining(
  expiresAtPerf: number | null,
  currentPerfNow: number = performance.now()
): number {
  if (expiresAtPerf === null || typeof expiresAtPerf !== "number") {
    return 0;
  }
  const diffMs = expiresAtPerf - currentPerfNow;
  return Math.max(0, Math.ceil(diffMs / 1000));
}

/**
 * Calculates the millisecond delay until the next refresh.
 *
 * Requirements:
 * - Refresh right AFTER it expires (when seconds_remaining reaches 0, plus ~1 second),
 *   because the server TOTP generator only returns the current active window's code.
 * - Delay clamped strictly between 1,000 ms and 61,000 ms.
 */
export function calculateNextRefreshDelayMs(
  expiresAtPerf: number,
  currentPerfNow: number = performance.now(),
  postExpiryBufferMs: number = 1000
): number {
  const diffMs = expiresAtPerf - currentPerfNow;
  const rawDelay = diffMs + postExpiryBufferMs;
  // Clamp between 1000 ms (1s) and 61000 ms (61s)
  return Math.min(61000, Math.max(1000, Math.round(rawDelay)));
}
