/**
 * Lightweight reachability controller, route allow-list, and storage helper.
 *
 * Loaded on the root layout. Contains ZERO game physics, ZERO spawner,
 * and ZERO canvas constants so that pages never download game code upfront.
 */

// ============================================================================
// 1. HIGH-SCORE LOCALSTORAGE HELPER
// ============================================================================

export const HIGH_SCORE_STORAGE_KEY = "cc_offline_highscore_v1";

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function getOfflineHighScore(): number {
  const storage = getStorage();
  if (!storage) return 0;
  try {
    const raw = storage.getItem(HIGH_SCORE_STORAGE_KEY);
    if (!raw) return 0;
    const val = parseInt(raw, 10);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  } catch {
    return 0;
  }
}

export function saveOfflineHighScore(score: number): number {
  const storage = getStorage();
  if (!storage) return score;
  try {
    const currentHigh = getOfflineHighScore();
    const newHigh = Math.max(currentHigh, Math.max(0, Math.floor(score)));
    storage.setItem(HIGH_SCORE_STORAGE_KEY, String(newHigh));
    return newHigh;
  } catch {
    return score;
  }
}

// ============================================================================
// 2. ROUTE SCOPING HELPER (Strict Student Route Allow-list)
// ============================================================================

/**
 * Strict allow-list of student routes that may show the full-screen offline layer.
 * All other routes (staff, admin, auth, /offline, unknown) receive ONLY the non-blocking banner.
 */
export function isStudentRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalized = pathname.trim();

  // Root customer home
  if (normalized === "/" || normalized === "") return true;

  // Exact student routes
  if (
    normalized === "/menu" ||
    normalized === "/cart" ||
    normalized === "/checkout" ||
    normalized === "/profile" ||
    normalized === "/notifications"
  ) {
    return true;
  }

  // Prefix routes belonging to student app
  if (normalized.startsWith("/orders") || normalized.startsWith("/healthy")) {
    return true;
  }

  return false;
}

// ============================================================================
// 3. REACHABILITY PROBE & STATE MACHINE
// ============================================================================

export type ReachabilityStatus =
  | "online"
  | "checking"
  | "offline_pending"
  | "offline_confirmed";

export interface ProbeOptions {
  probeUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Probes connectivity with HEAD (fallback to GET on method rejection)
 * to `/icons/icon-192.png` with cache-busting and timeout via AbortController.
 */
export async function performReachabilityProbe(options?: ProbeOptions): Promise<boolean> {
  const fetchFn = options?.fetchFn ?? fetch;
  const probeUrl = options?.probeUrl ?? "/icons/icon-192.png";
  const timeoutMs = options?.timeoutMs ?? 4000;
  const urlWithBust = `${probeUrl}?_probe=${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // AbortController with setTimeout for older Android WebViews
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    // 1. Try HEAD request first
    let res: Response;
    try {
      res = await fetchFn(urlWithBust, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (headErr: unknown) {
      // If HEAD threw because method is not allowed, try GET
      if (
        headErr instanceof Error &&
        (headErr.name === "AbortError" || headErr.message.toLowerCase().includes("abort"))
      ) {
        throw headErr;
      }
      res = await fetchFn(urlWithBust, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    }

    clearTimeout(timer);
    return res.ok || res.status < 400;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/**
 * Controller enforcing the double-probe false-offline rule:
 * - Requires 2 consecutive failed probes (~4s total) before transitioning to "offline_confirmed".
 * - A single successful probe immediately returns to "online".
 * - Never probes while document.hidden is true.
 */
export class ReachabilityController {
  private status: ReachabilityStatus = "online";
  private isProbing: boolean = false;
  private failedProbeCount: number = 0;
  private listeners: Set<(status: ReachabilityStatus) => void> = new Set();
  private probeFn: () => Promise<boolean>;

  constructor(customProbeFn?: () => Promise<boolean>) {
    this.probeFn = customProbeFn ?? (() => performReachabilityProbe());
  }

  public getStatus(): ReachabilityStatus {
    return this.status;
  }

  public subscribe(listener: (status: ReachabilityStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(newStatus: ReachabilityStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      for (const listener of this.listeners) {
        listener(newStatus);
      }
    }
  }

  public async checkReachability(isExplicitRetry: boolean = false): Promise<boolean> {
    // If hidden, do not probe unless user explicitly hit retry
    const isDocHidden =
      typeof document !== "undefined"
        ? Boolean(document.hidden)
        : typeof globalThis !== "undefined" && (globalThis as unknown as { document?: { hidden?: boolean } }).document
        ? Boolean((globalThis as unknown as { document?: { hidden?: boolean } }).document?.hidden)
        : false;

    if (isDocHidden && !isExplicitRetry) {
      return this.status === "online";
    }

    if (this.isProbing) {
      return this.status === "online";
    }

    this.isProbing = true;
    this.setStatus("checking");

    try {
      const probe1 = await this.probeFn();
      if (probe1) {
        this.failedProbeCount = 0;
        this.setStatus("online");
        return true;
      }

      // Probe 1 failed. Increment fail counter.
      this.failedProbeCount++;
      this.setStatus("offline_pending");

      // Run second verification probe
      const probe2 = await this.probeFn();
      if (probe2) {
        this.failedProbeCount = 0;
        this.setStatus("online");
        return true;
      }

      // Probe 2 also failed: enter confirmed offline state!
      this.failedProbeCount++;
      this.setStatus("offline_confirmed");
      return false;
    } finally {
      this.isProbing = false;
    }
  }

  public handleOnlineEvent(): void {
    void this.checkReachability(true);
  }

  public handleOfflineEvent(): void {
    void this.checkReachability(false);
  }

  public handleVisibilityResume(): void {
    if (typeof document !== "undefined" && !document.hidden && this.status !== "online") {
      void this.checkReachability(false);
    }
  }
}

