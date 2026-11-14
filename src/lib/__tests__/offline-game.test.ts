import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineGameErrorBoundary } from "../../components/offline/offline-game-boundary";
import {
  createInitialGameState,
  updateGameState,
  checkCollision,
  createSeededRandom,
  spawnNextObstacle,
  getObstacleDimensions,
  GROUND_Y,
  BURGER_HEIGHT_NORMAL,
  BURGER_HEIGHT_DUCK,
} from "../offline-game";
import {
  getOfflineHighScore,
  saveOfflineHighScore,
  HIGH_SCORE_STORAGE_KEY,
  isStudentRoute,
  ReachabilityController,
  performReachabilityProbe,
  shouldPrefetchOfflineGame,
} from "../offline-reachability";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

describe("Offline Game Physics & Collision Engine", () => {
  it("initializes player on the ground with zero vertical velocity", () => {
    const state = createInitialGameState(100);
    expect(state.player.y).toBe(GROUND_Y - BURGER_HEIGHT_NORMAL);
    expect(state.player.vy).toBe(0);
    expect(state.player.isGrounded).toBe(true);
    expect(state.highScore).toBe(100);
  });

  it("handles jumping physics with gravity and ground landing", () => {
    let state = createInitialGameState(0);
    state.isPlaying = true;
    const rng = createSeededRandom(12345);

    // Frame 1: Jump input applied
    state = updateGameState(state, rng, { jump: true, duck: false });
    expect(state.player.isGrounded).toBe(false);
    expect(state.player.vy).toBeLessThan(0); // Upward velocity
    expect(state.player.y).toBeLessThan(GROUND_Y - BURGER_HEIGHT_NORMAL);

    // Simulate airborne frames until player lands back on ground
    for (let i = 0; i < 40; i++) {
      state = updateGameState(state, rng, { jump: false, duck: false });
      if (state.player.isGrounded) break;
    }

    expect(state.player.isGrounded).toBe(true);
    expect(state.player.y).toBe(GROUND_Y - BURGER_HEIGHT_NORMAL);
    expect(state.player.vy).toBe(0);
  });

  it("handles ducking physics by reducing hitbox height", () => {
    let state = createInitialGameState(0);
    state.isPlaying = true;
    const rng = createSeededRandom(12345);

    // Duck input applied while on ground
    state = updateGameState(state, rng, { jump: false, duck: true });
    expect(state.player.isDucking).toBe(true);
    expect(state.player.height).toBe(BURGER_HEIGHT_DUCK);
    expect(state.player.y).toBe(GROUND_Y - BURGER_HEIGHT_DUCK);

    // Release duck
    state = updateGameState(state, rng, { jump: false, duck: false });
    expect(state.player.isDucking).toBe(false);
    expect(state.player.height).toBe(BURGER_HEIGHT_NORMAL);
  });

  it("detects AABB collision accurately and triggers game over", () => {
    const player = {
      x: 50,
      y: 110,
      vy: 0,
      width: 34,
      height: 34,
      isGrounded: true,
      isDucking: false,
    };

    // Obstacle directly overlapping player
    const directHit = {
      id: 1,
      type: "drink" as const,
      size: "medium" as const,
      x: 55,
      y: 110,
      width: 22,
      height: 32,
    };
    expect(checkCollision(player, directHit)).toBe(true);

    // Obstacle far ahead (no collision)
    const farAhead = {
      id: 2,
      type: "trays" as const,
      size: "large" as const,
      x: 250,
      y: 110,
      width: 38,
      height: 34,
    };
    expect(checkCollision(player, farAhead)).toBe(false);

    // Player jumps over obstacle
    const jumpingPlayer = {
      ...player,
      y: 40, // High in the air
      isGrounded: false,
    };
    expect(checkCollision(jumpingPlayer, directHit)).toBe(false);
  });
});

describe("Deterministic Spawner & Obstacle Dimensions", () => {
  it("produces identical sequences of obstacles with the same seed", () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);

    const obs1 = spawnNextObstacle(rng1, 375, 1);
    const obs2 = spawnNextObstacle(rng2, 375, 1);

    expect(obs1.obstacle.type).toBe(obs2.obstacle.type);
    expect(obs1.obstacle.size).toBe(obs2.obstacle.size);
    expect(obs1.obstacle.width).toBe(obs2.obstacle.width);
    expect(obs1.obstacle.height).toBe(obs2.obstacle.height);
    expect(obs1.nextGap).toBe(obs2.nextGap);

    const obs1b = spawnNextObstacle(rng1, 375, 2);
    const obs2b = spawnNextObstacle(rng2, 375, 2);

    expect(obs1b.obstacle.type).toBe(obs2b.obstacle.type);
    expect(obs1b.nextGap).toBe(obs2b.nextGap);
  });

  it("returns correct dimensions for all obstacle types and sizes", () => {
    expect(getObstacleDimensions("drink", "small")).toEqual({ width: 18, height: 26 });
    expect(getObstacleDimensions("drink", "large")).toEqual({ width: 26, height: 38 });
    expect(getObstacleDimensions("trays", "small")).toEqual({ width: 30, height: 18 });
    expect(getObstacleDimensions("trays", "large")).toEqual({ width: 38, height: 34 });
  });
});

describe("High Score LocalStorage Helper", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("reads and writes valid high scores safely", () => {
    expect(getOfflineHighScore()).toBe(0);

    const saved = saveOfflineHighScore(450);
    expect(saved).toBe(450);
    expect(getOfflineHighScore()).toBe(450);

    // Lower score does not overwrite higher score
    const retained = saveOfflineHighScore(200);
    expect(retained).toBe(450);
    expect(getOfflineHighScore()).toBe(450);
  });

  it("handles corrupted, non-numeric, or null storage gracefully without throwing", () => {
    localStorageMock.setItem(HIGH_SCORE_STORAGE_KEY, "invalid-corrupt-data");
    expect(getOfflineHighScore()).toBe(0);

    localStorageMock.setItem(HIGH_SCORE_STORAGE_KEY, "-999");
    expect(getOfflineHighScore()).toBe(0);
  });

  it("handles storage exceptions (e.g. storage disabled / quota exceeded)", () => {
    const originalSet = localStorageMock.setItem;
    localStorageMock.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    const res = saveOfflineHighScore(100);
    expect(res).toBe(100); // Does not crash
    localStorageMock.setItem = originalSet;
  });
});

describe("Student Route Allow-list & Scope Verification", () => {
  it("allow-lists all student routes for the full-screen offline overlay", () => {
    expect(isStudentRoute("/")).toBe(true);
    expect(isStudentRoute("/menu")).toBe(true);
    expect(isStudentRoute("/cart")).toBe(true);
    expect(isStudentRoute("/checkout")).toBe(true);
    expect(isStudentRoute("/profile")).toBe(true);
    expect(isStudentRoute("/notifications")).toBe(true);
    expect(isStudentRoute("/orders")).toBe(true);
    expect(isStudentRoute("/orders/12345")).toBe(true);
    expect(isStudentRoute("/healthy")).toBe(true);
    expect(isStudentRoute("/healthy/score")).toBe(true);
  });

  it("strictly excludes staff, admin, auth, and /offline routes", () => {
    // Staff & Admin
    expect(isStudentRoute("/staff")).toBe(false);
    expect(isStudentRoute("/staff/pickup")).toBe(false);
    expect(isStudentRoute("/staff/inventory")).toBe(false);
    expect(isStudentRoute("/admin")).toBe(false);
    expect(isStudentRoute("/admin/menu")).toBe(false);
    expect(isStudentRoute("/admin/orders")).toBe(false);

    // Auth routes
    expect(isStudentRoute("/login")).toBe(false);
    expect(isStudentRoute("/signup")).toBe(false);
    expect(isStudentRoute("/forgot-password")).toBe(false);
    expect(isStudentRoute("/set-password")).toBe(false);
    expect(isStudentRoute("/auth/confirm")).toBe(false);
    expect(isStudentRoute("/auth/callback")).toBe(false);

    // Dedicated offline page & unlisted routes
    expect(isStudentRoute("/offline")).toBe(false);
    expect(isStudentRoute("/api/orders")).toBe(false);
    expect(isStudentRoute("/random-unlisted-page")).toBe(false);
  });
});

describe("Reachability Controller & Double-Probe False-Offline Rule", () => {
  it("requires TWO consecutive probe failures before entering offline_confirmed", async () => {
    let callCount = 0;
    const failingProbe = vi.fn(async () => {
      callCount++;
      return false; // Network fail
    });

    const controller = new ReachabilityController(failingProbe);
    expect(controller.getStatus()).toBe("online");

    const history: string[] = [];
    controller.subscribe((status) => history.push(status));

    // Offline event fires
    await controller.checkReachability(false);

    expect(callCount).toBe(2); // Two probes executed
    expect(history).toEqual(["checking", "offline_pending", "offline_confirmed"]);
    expect(controller.getStatus()).toBe("offline_confirmed");
  });

  it("remains online if the second verification probe succeeds", async () => {
    let callCount = 0;
    const transientProbe = vi.fn(async () => {
      callCount++;
      // Probe 1 fails, probe 2 succeeds
      return callCount === 2;
    });

    const controller = new ReachabilityController(transientProbe);
    const history: string[] = [];
    controller.subscribe((status) => history.push(status));

    await controller.checkReachability(false);

    expect(callCount).toBe(2);
    expect(history).toEqual(["checking", "offline_pending", "online"]);
    expect(controller.getStatus()).toBe("online");
  });

  it("recovers to online immediately as soon as ONE probe succeeds", async () => {
    const successfulProbe = vi.fn(async () => true);
    const controller = new ReachabilityController(successfulProbe);

    const history: string[] = [];
    controller.subscribe((status) => history.push(status));

    const ok = await controller.checkReachability(true);
    expect(ok).toBe(true);
    expect(history).toEqual(["checking", "online"]);
    expect(controller.getStatus()).toBe("online");
  });

  it("skips probing while document.hidden is true", async () => {
    const probe = vi.fn(async () => false);
    const controller = new ReachabilityController(probe);

    // Mock document.hidden on globalThis
    const originalDoc = (globalThis as unknown as { document?: { hidden?: boolean } }).document;
    Object.defineProperty(globalThis, "document", {
      value: { hidden: true },
      writable: true,
      configurable: true,
    });

    await controller.checkReachability(false);
    expect(probe).not.toHaveBeenCalled();

    if (originalDoc) {
      Object.defineProperty(globalThis, "document", { value: originalDoc });
    } else {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it("performs probe using AbortController with fallback to GET if HEAD rejects", async () => {
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        throw new Error("Method Not Allowed");
      }
      return new Response("OK", { status: 200 });
    });

    const result = await performReachabilityProbe({
      fetchFn: mockFetch as unknown as typeof fetch,
      probeUrl: "/icons/icon-192.png",
      timeoutMs: 1000,
    });

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2); // Tried HEAD, then fell back to GET
  });
});

describe("Static Architecture & Security Boundaries", () => {
  it("confirms no offline file imports from auth actions or recovery validation", () => {
    const offlineGamePath = path.resolve(__dirname, "../offline-game.ts");
    const indicatorPath = path.resolve(__dirname, "../../components/offline/offline-indicator.tsx");
    const canvasPath = path.resolve(__dirname, "../../components/offline/offline-game-canvas.tsx");
    const offlinePagePath = path.resolve(__dirname, "../../app/offline/page.tsx");

    const files = [offlineGamePath, indicatorPath, canvasPath, offlinePagePath];

    for (const file of files) {
      expect(fs.existsSync(file)).toBe(true);
      const content = fs.readFileSync(file, "utf-8");

      expect(content).not.toContain("@/server/actions/auth");
      expect(content).not.toContain("@/server/auth");
      expect(content).not.toContain("@/lib/validation/auth-recovery");
      expect(content).not.toContain("forgotPasswordAction");
      expect(content).not.toContain("setPasswordAction");
    }
  });

  it("confirms /offline page does not import student components or cart store", () => {
    const offlinePagePath = path.resolve(__dirname, "../../app/offline/page.tsx");
    const content = fs.readFileSync(offlinePagePath, "utf-8");

    expect(content).not.toContain("@/components/student");
    expect(content).not.toContain("useCartStore");
    expect(content).not.toContain("StudentBottomNav");
    expect(content).not.toContain("StudentHeader");
    expect(content).not.toContain("StudentInstallPrompt");
  });

  it("enforces one-way import architecture: offline-indicator and offline-reachability do NOT import offline-game", () => {
    const indicatorPath = path.resolve(__dirname, "../../components/offline/offline-indicator.tsx");
    const reachabilityPath = path.resolve(__dirname, "../offline-reachability.ts");
    const gamePath = path.resolve(__dirname, "../offline-game.ts");

    const indicatorContent = fs.readFileSync(indicatorPath, "utf-8");
    const reachabilityContent = fs.readFileSync(reachabilityPath, "utf-8");
    const gameContent = fs.readFileSync(gamePath, "utf-8");

    // Indicator must NOT statically import from offline-game (uses offline-reachability instead)
    expect(indicatorContent).not.toMatch(/from\s+["'].*offline-game["']/);
    // Reachability must NOT import from offline-game
    expect(reachabilityContent).not.toMatch(/from\s+["'].*offline-game["']/);

    // One-way: offline-game CAN import from offline-reachability
    expect(gameContent).toContain("offline-reachability");

    // OfflineGameErrorBoundary must NOT import from offline-game
    const boundaryPath = path.resolve(__dirname, "../../components/offline/offline-game-boundary.tsx");
    const boundaryContent = fs.readFileSync(boundaryPath, "utf-8");
    expect(boundaryContent).not.toMatch(/from\s+["'].*offline-game["']/);
  });
});

describe("Offline Game Prefetch Gating (shouldPrefetchOfflineGame)", () => {
  it("allows prefetch when online, visible, normal network, on a student route", () => {
    expect(
      shouldPrefetchOfflineGame({
        online: true,
        visible: true,
        saveData: false,
        effectiveType: "4g",
        pathname: "/menu",
      })
    ).toBe(true);

    // Positional signature support
    expect(shouldPrefetchOfflineGame(true, true, false, "4g", "/menu")).toBe(true);
    expect(shouldPrefetchOfflineGame(true, true, false, "3g", "/orders")).toBe(true);
    expect(shouldPrefetchOfflineGame(true, true, false, "4g", "student")).toBe(true);
  });

  it("blocks prefetch when offline", () => {
    expect(
      shouldPrefetchOfflineGame({
        online: false,
        visible: true,
        saveData: false,
        effectiveType: "4g",
        pathname: "/menu",
      })
    ).toBe(false);
    expect(shouldPrefetchOfflineGame(false, true, false, "4g", "/menu")).toBe(false);
  });

  it("blocks prefetch when document is hidden", () => {
    expect(
      shouldPrefetchOfflineGame({
        online: true,
        visible: false,
        saveData: false,
        effectiveType: "4g",
        pathname: "/menu",
      })
    ).toBe(false);
    expect(shouldPrefetchOfflineGame(true, false, false, "4g", "/menu")).toBe(false);
  });

  it("blocks prefetch when saveData is enabled", () => {
    expect(
      shouldPrefetchOfflineGame({
        online: true,
        visible: true,
        saveData: true,
        effectiveType: "4g",
        pathname: "/menu",
      })
    ).toBe(false);
    expect(shouldPrefetchOfflineGame(true, true, true, "4g", "/menu")).toBe(false);
  });

  it("blocks prefetch on slow network connections (slow-2g, 2g)", () => {
    expect(
      shouldPrefetchOfflineGame({
        online: true,
        visible: true,
        saveData: false,
        effectiveType: "slow-2g",
        pathname: "/menu",
      })
    ).toBe(false);
    expect(
      shouldPrefetchOfflineGame({
        online: true,
        visible: true,
        saveData: false,
        effectiveType: "2g",
        pathname: "/menu",
      })
    ).toBe(false);

    expect(shouldPrefetchOfflineGame(true, true, false, "2g", "/menu")).toBe(false);
    expect(shouldPrefetchOfflineGame(true, true, false, "slow-2g", "/menu")).toBe(false);
  });

  it("blocks prefetch on staff, admin, auth, and /offline routes", () => {
    const blockedRoutes = [
      "/staff",
      "/staff/pickup",
      "/admin",
      "/admin/orders",
      "/login",
      "/signup",
      "/forgot-password",
      "/set-password",
      "/auth/confirm",
      "/offline",
      "staff",
      "admin",
      "auth",
    ];

    for (const route of blockedRoutes) {
      expect(
        shouldPrefetchOfflineGame({
          online: true,
          visible: true,
          saveData: false,
          effectiveType: "4g",
          pathname: route,
        })
      ).toBe(false);
    }
  });
});

describe("OfflineGameErrorBoundary & Chunk Load Protection", () => {
  it("renders children when no chunk load or render error occurs", () => {
    const element = React.createElement(
      OfflineGameErrorBoundary,
      { onClose: vi.fn() },
      React.createElement("div", { id: "child-game" }, "Game Running")
    );
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Game Running");
    expect(html).not.toContain("The game could not load");
  });

  it("catches chunk load failure, does not throw, and displays the exact compact fallback message", () => {
    const boundary = new OfflineGameErrorBoundary({ onClose: vi.fn(), children: null });
    expect(boundary.state.hasError).toBe(false);

    // Simulate getDerivedStateFromError when ChunkLoadError occurs
    const nextState = OfflineGameErrorBoundary.getDerivedStateFromError();
    expect(nextState).toEqual({ hasError: true });

    boundary.state = nextState;
    const output = boundary.render();
    const html = renderToStaticMarkup(output as React.ReactElement);

    expect(html).toContain(
      "The game could not load. It needs a connection the first time, so try again when you are back online."
    );
    expect(html).toContain("Close");
  });

  it("calls onClose and resets error state when Close button is tapped", () => {
    const onClose = vi.fn();
    const boundary = new OfflineGameErrorBoundary({ onClose, children: null });
    boundary.state = { hasError: true };

    // In unit test environment without full React DOM reconciler, mock class updater
    (boundary as unknown as { updater: unknown }).updater = {
      enqueueSetState: (_inst: unknown, partialState: unknown) => {
        Object.assign(
          boundary.state,
          typeof partialState === "function"
            ? (partialState as (s: unknown) => unknown)(boundary.state)
            : partialState
        );
      },
      enqueueForceUpdate: () => {},
      isMounted: () => true,
    };

    boundary.handleClose();

    expect(boundary.state.hasError).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("verifies LazyOfflineGame is wrapped by OfflineGameErrorBoundary in indicator and /offline page", () => {
    const indicatorPath = path.resolve(__dirname, "../../components/offline/offline-indicator.tsx");
    const offlinePagePath = path.resolve(__dirname, "../../app/offline/page.tsx");

    const indicatorContent = fs.readFileSync(indicatorPath, "utf-8");
    const pageContent = fs.readFileSync(offlinePagePath, "utf-8");

    expect(indicatorContent).toContain("OfflineGameErrorBoundary");
    expect(indicatorContent).toMatch(
      /<OfflineGameErrorBoundary[\s\S]*?<Suspense[\s\S]*?<LazyOfflineGame[\s\S]*?<\/Suspense>[\s\S]*?<\/OfflineGameErrorBoundary>/
    );

    expect(pageContent).toContain("OfflineGameErrorBoundary");
    expect(pageContent).toMatch(
      /<OfflineGameErrorBoundary[\s\S]*?<Suspense[\s\S]*?<LazyOfflineGame[\s\S]*?<\/Suspense>[\s\S]*?<\/OfflineGameErrorBoundary>/
    );
  });
});
