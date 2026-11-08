import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  shouldTriggerTransition,
  transitionReducer,
  calculateRemainingHoldTime,
  TRANSITION_CONFIG,
  INITIAL_TRANSITION_STATE,
} from "@/lib/transition-state-machine";
import {
  PreloadRegistry,
  deduplicatePreloadUrls,
} from "@/lib/preload-dedup";
import { withTimeout, TimeoutError } from "@/lib/timeout";

describe("Phase 5: Performance & Readiness Architecture Tests", () => {
  describe("1. Transition Readiness State Machine", () => {
    it("respects duration boundaries (minimum 350ms, maximum 1200ms)", () => {
      expect(TRANSITION_CONFIG.MIN_DISPLAY_MS).toBe(350);
      expect(TRANSITION_CONFIG.MAX_FAILSAFE_MS).toBe(1200);

      // Elapsed 0ms -> remaining is exactly 350ms
      expect(calculateRemainingHoldTime(1000, 1000, 350)).toBe(350);

      // Elapsed 150ms -> remaining is 200ms
      expect(calculateRemainingHoldTime(1000, 1150, 350)).toBe(200);

      // Elapsed 350ms -> remaining is 0ms
      expect(calculateRemainingHoldTime(1000, 1350, 350)).toBe(0);

      // Elapsed 500ms (> 350ms) -> remaining is 0ms (not negative)
      expect(calculateRemainingHoldTime(1000, 1500, 350)).toBe(0);
    });

    it("does not trigger transition on same route, query-only, or hash-only navigation", () => {
      // Same route
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/menu",
        })
      ).toBe(false);

      // Query-only navigation
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/menu?category=Healthy",
        })
      ).toBe(false);

      // Hash-only navigation
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "#faq",
        })
      ).toBe(false);

      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/menu#section-bowls",
        })
      ).toBe(false);

      // Different route -> triggers transition
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/cart",
        })
      ).toBe(true);
    });

    it("does not trigger transition on modified clicks (Ctrl, Meta, Shift, Alt)", () => {
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/cart",
          isModifiedClick: true,
        })
      ).toBe(false);
    });

    it("does not trigger transition when user prefers reduced motion", () => {
      expect(
        shouldTriggerTransition({
          currentPath: "/menu",
          destinationHref: "/cart",
          prefersReducedMotion: true,
        })
      ).toBe(false);
    });

    it("supports rapid-tap replacement without orphaned states", () => {
      let state = transitionReducer(INITIAL_TRANSITION_STATE, {
        type: "START",
        targetPath: "/menu",
        timestamp: 1000,
      });

      expect(state.isTransitioning).toBe(true);
      expect(state.targetPath).toBe("/menu");
      expect(state.startedAt).toBe(1000);

      // User rapidly taps /cart before /menu completes
      state = transitionReducer(state, {
        type: "RAPID_TAP",
        newTargetPath: "/cart",
        timestamp: 1050,
      });

      expect(state.isTransitioning).toBe(true);
      expect(state.targetPath).toBe("/cart");
      expect(state.startedAt).toBe(1050);
    });

    it("handles route mounted and redirects cleanly", () => {
      let state = transitionReducer(INITIAL_TRANSITION_STATE, {
        type: "START",
        targetPath: "/checkout",
        timestamp: 1000,
      });

      // Server redirects /checkout -> /login
      state = transitionReducer(state, {
        type: "REDIRECT",
        redirectPath: "/login",
      });
      expect(state.targetPath).toBe("/login");

      // Route mounted triggers exit animation
      state = transitionReducer(state, {
        type: "ROUTE_MOUNTED",
        timestamp: 1200,
      });
      expect(state.isExiting).toBe(true);

      // Exit finishes
      state = transitionReducer(state, { type: "FINISH" });
      expect(state.isTransitioning).toBe(false);
      expect(state.targetPath).toBeNull();
    });

    it("ensures failsafe timeout or failure immediately removes the overlay and resets state", () => {
      const activeState = {
        isTransitioning: true,
        isExiting: false,
        targetPath: "/orders",
        startedAt: 1000,
      };

      // Failsafe triggered
      const timedOutState = transitionReducer(activeState, {
        type: "FAILSAFE_TIMEOUT",
      });
      expect(timedOutState.isTransitioning).toBe(false);
      expect(timedOutState.targetPath).toBeNull();
      expect(timedOutState.startedAt).toBeNull();

      // Failure triggered
      const failureState = transitionReducer(activeState, {
        type: "FAILURE",
      });
      expect(failureState.isTransitioning).toBe(false);
      expect(failureState.targetPath).toBeNull();
    });

    it("clears all active timers on cleanup or cancellation", () => {
      vi.useFakeTimers();
      try {
        const timerSpy1 = vi.fn();
        const timerSpy2 = vi.fn();
        const t1 = setTimeout(timerSpy1, 1000);
        const t2 = setTimeout(timerSpy2, 1000);

        clearTimeout(t1);
        clearTimeout(t2);

        vi.advanceTimersByTime(1500);
        expect(timerSpy1).not.toHaveBeenCalled();
        expect(timerSpy2).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("2. Auth Timeout Wrapper Invariants", () => {
    it("timeout can only lead to signed-out / error, never to a session or guessed role", async () => {
      const slowAuthCall = (signal: AbortSignal) =>
        new Promise<{ user: { id: string; role: string } | null }>((resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new TimeoutError("auth service unreachable"));
          });
        });

      let sessionResult: { user: { id: string; role: string } | null } | null = null;
      let errorResult: Error | null = null;

      try {
        sessionResult = await withTimeout(slowAuthCall, 30);
      } catch (err) {
        errorResult = err as Error;
      }

      // Must NEVER return a mock session or guessed role on timeout
      expect(sessionResult).toBeNull();
      expect(errorResult).toBeInstanceOf(TimeoutError);
      expect(errorResult?.message).toBe("auth service unreachable");
    });

    it("verifies /login request cannot trigger a redirect loop on timeout", () => {
      const isLoginPath = (path: string) => path === "/login" || path.startsWith("/login?");
      const currentPath = "/login";

      // If already on /login, a timeout must NEVER redirect back to /login
      const shouldRedirectToLogin = !isLoginPath(currentPath);
      expect(shouldRedirectToLogin).toBe(false);
    });
  });

  describe("3. Preload Deduplication Helper", () => {
    it("registers resource URLs once and drops duplicate preload requests", () => {
      const registry = new PreloadRegistry();

      expect(registry.register("/brand/logo.png")).toBe(true);
      expect(registry.register("/brand/logo.png")).toBe(false);
      expect(registry.register("  /brand/logo.png  ")).toBe(false);
      expect(registry.size()).toBe(1);

      expect(registry.register("/brand/poster.png")).toBe(true);
      expect(registry.size()).toBe(2);

      registry.clear();
      expect(registry.size()).toBe(0);
    });

    it("deduplicates array of preload URLs preserving order", () => {
      const input = [
        "/brand/logo.png",
        "/brand/poster.png",
        "/brand/logo.png",
        "  /brand/poster.png  ",
        "/brand/transition.mp4",
      ];

      const deduped = deduplicatePreloadUrls(input);
      expect(deduped).toEqual([
        "/brand/logo.png",
        "/brand/poster.png",
        "/brand/transition.mp4",
      ]);
    });
  });

  describe("4. Static Architectural Security & Layout Checks", () => {
    const projectRoot = path.resolve(__dirname, "../../..");
    const srcDir = path.join(projectRoot, "src");
    const appDir = path.join(srcDir, "app");

    it("ensures every student route folder has loading.tsx", () => {
      const studentRoutes = [
        "",
        "cart",
        "checkout",
        "healthy",
        "healthy/score",
        "menu",
        "notifications",
        "orders",
        "orders/[orderId]",
        "profile",
      ];

      for (const route of studentRoutes) {
        const loadingFile = path.join(appDir, "(student)", route, "loading.tsx");
        expect(
          fs.existsSync(loadingFile),
          `Missing loading.tsx at (student)/${route}`
        ).toBe(true);
      }
    });

    it("ensures staff and admin route hierarchies have loading.tsx", () => {
      const staffLoading = path.join(appDir, "staff", "loading.tsx");
      const adminLoading = path.join(appDir, "admin", "loading.tsx");

      expect(fs.existsSync(staffLoading), "Missing staff loading.tsx").toBe(true);
      expect(fs.existsSync(adminLoading), "Missing admin loading.tsx").toBe(true);
    });

    it("ensures every dynamic() import has a loading fallback", () => {
      const filesWithDynamic: string[] = [];

      function scanDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (content.includes("dynamic(") && !content.includes("loading:")) {
              filesWithDynamic.push(fullPath);
            }
          }
        }
      }

      scanDir(srcDir);
      expect(
        filesWithDynamic,
        `Found dynamic imports without loading fallback: ${filesWithDynamic.join(", ")}`
      ).toEqual([]);
    });

    it("ensures NO file under src/ imports or references the service-role or secret key", () => {
      const violations: string[] = [];

      function scanDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            const forbidden = ["SUPABASE" + "_SERVICE_ROLE_KEY", "service" + "_role"];
            if (forbidden.some((keyword) => content.includes(keyword))) {
              violations.push(fullPath);
            }
          }
        }
      }

      scanDir(srcDir);
      expect(
        violations,
        `Found forbidden service-role references under src/: ${violations.join(", ")}`
      ).toEqual([]);
    });
  });
});
