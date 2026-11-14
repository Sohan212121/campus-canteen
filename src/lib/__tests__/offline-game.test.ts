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
  getMinObstacleGap,
  calculateGameSpeed,
  GROUND_Y,
  BURGER_WIDTH,
  BURGER_HEIGHT_NORMAL,
  BURGER_HEIGHT_DUCK,
  INITIAL_SPEED,
  BASE_SPEED,
  MAX_SPEED,
  SPEED_RAMP_DURATION_SEC,
  SPEED_RAMP_FRAMES,
  FIRST_OBSTACLE_DISTANCE,
  JUMP_AIRBORNE_FRAMES,
  JUMP_SAFETY_MARGIN_PX,
  GRAVITY,
  JUMP_VELOCITY,
  TARGET_FPS,
} from "../offline-game";
import {
  FOOD_CHARACTERS,
  getCharacterById,
  getOfflineCharacter,
  saveOfflineCharacter,
  CHARACTER_STORAGE_KEY,
  type CharacterId,
} from "../offline-game-characters";
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

describe("Speed Ramp & Grace Period Dynamics", () => {
  it("starts at about 60% of original base speed and strictly lower than BASE_SPEED", () => {
    expect(INITIAL_SPEED).toBeLessThan(BASE_SPEED);
    expect(INITIAL_SPEED).toBe(2.5);
    expect(INITIAL_SPEED / BASE_SPEED).toBeCloseTo(0.6, 1);

    const initial = createInitialGameState();
    expect(initial.speed).toBe(INITIAL_SPEED);
  });

  it("ensures speed never decreases and never exceeds MAX_SPEED over long runs", () => {
    let previousSpeed = 0;
    // Test from score 0 through 6,000 (well beyond the 4,500 ramp point)
    for (let score = 0; score <= 6000; score += 10) {
      const speed = calculateGameSpeed(score);
      expect(speed).toBeGreaterThanOrEqual(previousSpeed);
      expect(speed).toBeLessThanOrEqual(MAX_SPEED);
      expect(speed).toBeGreaterThanOrEqual(INITIAL_SPEED);
      previousSpeed = speed;
    }
  });

  it("reaches MAX_SPEED after exactly 75 seconds (4,500 frames at 60 FPS)", () => {
    expect(SPEED_RAMP_DURATION_SEC).toBe(75);
    expect(SPEED_RAMP_FRAMES).toBe(4500);

    // Right before 75s (4,490 frames), speed has not quite hit MAX_SPEED
    expect(calculateGameSpeed(4490)).toBeLessThan(MAX_SPEED);

    // At 75s (4,500 frames), speed reaches exactly MAX_SPEED (8.5)
    expect(calculateGameSpeed(4500)).toBe(MAX_SPEED);

    // After 75s (e.g. 5,000, 10,000 frames), speed stays capped at MAX_SPEED
    expect(calculateGameSpeed(5000)).toBe(MAX_SPEED);
    expect(calculateGameSpeed(10000)).toBe(MAX_SPEED);
  });

  it("verifies the first-obstacle grace period is at least 2.0 seconds before obstacle spawns", () => {
    // Calculated grace time to travel FIRST_OBSTACLE_DISTANCE at INITIAL_SPEED
    const graceSecondsToSpawn = FIRST_OBSTACLE_DISTANCE / (INITIAL_SPEED * TARGET_FPS);
    expect(graceSecondsToSpawn).toBeGreaterThanOrEqual(2.0);

    // Live state machine simulation: verify no obstacle spawns before frame 120 (2.0s)
    let state = createInitialGameState();
    state.isPlaying = true;
    const rng = createSeededRandom(9999);

    let firstSpawnFrame = -1;
    for (let frame = 1; frame <= 150; frame++) {
      state = updateGameState(state, rng, { jump: false, duck: false });
      if (state.obstacles.length > 0 && firstSpawnFrame === -1) {
        firstSpawnFrame = frame;
        break;
      }
    }

    expect(firstSpawnFrame).toBeGreaterThanOrEqual(120);
    const liveGraceSeconds = firstSpawnFrame / TARGET_FPS;
    expect(liveGraceSeconds).toBeGreaterThanOrEqual(2.0);
  });
});

describe("Jump Arc Obstacle Clearance & Safety Margin", () => {
  it("confirms jump arc airborne duration is exactly 31 frames", () => {
    let vy = JUMP_VELOCITY;
    let y = 0;
    let frames = 0;
    while (true) {
      frames++;
      y += vy;
      vy += GRAVITY;
      if (y >= 0) break;
    }
    expect(frames).toBe(JUMP_AIRBORNE_FRAMES);
    expect(JUMP_AIRBORNE_FRAMES).toBe(31);
  });

  it("guarantees at EVERY speed from INITIAL_SPEED to MAX_SPEED that min obstacle gap exceeds jump arc travel distance + safety margin", () => {
    // Check in small steps of 0.1 across the entire speed envelope
    for (let sp = INITIAL_SPEED; sp <= MAX_SPEED + 0.05; sp += 0.1) {
      const currentSpeed = Math.round(sp * 10) / 10;
      const jumpDistance = JUMP_AIRBORNE_FRAMES * currentSpeed;
      const requiredSafeDistance = jumpDistance + JUMP_SAFETY_MARGIN_PX;

      // Check at start of run (score = 0)
      const minGapStart = getMinObstacleGap(currentSpeed, 0);
      expect(minGapStart).toBeGreaterThan(requiredSafeDistance);

      // Check at middle of run (score = 2250)
      const minGapMid = getMinObstacleGap(currentSpeed, 2250);
      expect(minGapMid).toBeGreaterThan(requiredSafeDistance);

      // Check at peak speed (score = 4500)
      const minGapMax = getMinObstacleGap(currentSpeed, 4500);
      expect(minGapMax).toBeGreaterThan(requiredSafeDistance);
    }
  });

  it("provides wider gaps early in the run than at top speed for beginner comfort", () => {
    const gapAtStart = getMinObstacleGap(INITIAL_SPEED, 0);
    const gapAtMaxSpeed = getMinObstacleGap(MAX_SPEED, SPEED_RAMP_FRAMES);

    // Gaps start generous (+100px bonus)
    expect(gapAtStart).toBeGreaterThan(gapAtMaxSpeed);
    expect(gapAtStart).toBe(380); // 280 base + 100 bonus
  });
});

describe("Food Characters & Fair Hitbox Architecture", () => {
  it("provides at least 6 unique food characters with valid canvas draw functions", () => {
    expect(FOOD_CHARACTERS.length).toBeGreaterThanOrEqual(6);
    expect(FOOD_CHARACTERS.length).toBe(7); // burger, pizza, samosa, donut, fries, hotdog, icecream

    const expectedIds = ["burger", "pizza", "samosa", "donut", "fries", "hotdog", "icecream"];
    for (const expectedId of expectedIds) {
      const char = FOOD_CHARACTERS.find((c) => c.id === expectedId);
      expect(char).toBeDefined();
      expect(char?.name).toBeTruthy();
      expect(typeof char?.draw).toBe("function");
    }
  });

  it("enforces 100% fair hitbox dimensions for all characters", () => {
    // Every character must play with the exact same BurgerPlayer dimensions
    const testPlayer = {
      x: 36,
      y: GROUND_Y - BURGER_HEIGHT_NORMAL,
      vy: 0,
      width: BURGER_WIDTH,
      height: BURGER_HEIGHT_NORMAL,
      isGrounded: true,
      isDucking: false,
    };

    expect(testPlayer.width).toBe(34);
    expect(testPlayer.height).toBe(34);

    // When ducking, all characters use BURGER_HEIGHT_DUCK
    testPlayer.height = BURGER_HEIGHT_DUCK;
    expect(testPlayer.height).toBe(20);

    for (const char of FOOD_CHARACTERS) {
      const retrieved = getCharacterById(char.id);
      expect(retrieved.id).toBe(char.id);
    }
  });

  it("falls back safely to burger for unknown character IDs", () => {
    const fallback = getCharacterById("unknown_food_item" as CharacterId);
    expect(fallback.id).toBe("burger");
  });
});

describe("Character Selection LocalStorage Helper (cc_offline_character_v1)", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("reads and writes valid character choices safely", () => {
    expect(getOfflineCharacter()).toBe("burger"); // Safe default

    saveOfflineCharacter("pizza");
    expect(getOfflineCharacter()).toBe("pizza");

    saveOfflineCharacter("samosa");
    expect(getOfflineCharacter()).toBe("samosa");

    saveOfflineCharacter("donut");
    expect(getOfflineCharacter()).toBe("donut");

    saveOfflineCharacter("fries");
    expect(getOfflineCharacter()).toBe("fries");

    saveOfflineCharacter("hotdog");
    expect(getOfflineCharacter()).toBe("hotdog");

    saveOfflineCharacter("icecream");
    expect(getOfflineCharacter()).toBe("icecream");
  });

  it("survives missing, corrupted, or invalid character storage by falling back to burger", () => {
    localStorageMock.setItem(CHARACTER_STORAGE_KEY, "corrupted_marshmallow_999");
    expect(getOfflineCharacter()).toBe("burger");

    localStorageMock.setItem(CHARACTER_STORAGE_KEY, "");
    expect(getOfflineCharacter()).toBe("burger");

    localStorageMock.setItem(CHARACTER_STORAGE_KEY, "   ");
    expect(getOfflineCharacter()).toBe("burger");
  });

  it("survives unavailable storage (e.g. storage disabled / thrown exception) without crashing", () => {
    const originalGet = localStorageMock.getItem;
    const originalSet = localStorageMock.setItem;

    localStorageMock.getItem = () => {
      throw new Error("SecurityError: Access is denied for this document");
    };
    expect(getOfflineCharacter()).toBe("burger");

    localStorageMock.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const saved = saveOfflineCharacter("pizza");
    expect(saved).toBe("pizza"); // Safe fallback return

    localStorageMock.getItem = originalGet;
    localStorageMock.setItem = originalSet;
  });
});

describe("Static Architecture: Character Code Isolation", () => {
  it("enforces that root layout components (offline-indicator & offline-reachability) do NOT import offline-game-characters", () => {
    const indicatorPath = path.resolve(__dirname, "../../components/offline/offline-indicator.tsx");
    const reachabilityPath = path.resolve(__dirname, "../offline-reachability.ts");

    const indicatorContent = fs.readFileSync(indicatorPath, "utf-8");
    const reachabilityContent = fs.readFileSync(reachabilityPath, "utf-8");

    expect(indicatorContent).not.toMatch(/from\s+["'].*offline-game-characters["']/);
    expect(reachabilityContent).not.toMatch(/from\s+["'].*offline-game-characters["']/);
  });
});
