/**
 * Pure offline game physics, spawner logic, high-score persistence,
 * and reachability state machine.
 *
 * Self-contained, zero auth imports, 100% testable in Vitest.
 */

// ============================================================================
// 1. GAME CONSTANTS & TYPES
// ============================================================================

export const GAME_CANVAS_WIDTH = 375;
export const GAME_CANVAS_HEIGHT = 180;
export const GROUND_Y = 145;

export const BURGER_WIDTH = 34;
export const BURGER_HEIGHT_NORMAL = 34;
export const BURGER_HEIGHT_DUCK = 20;

export const GRAVITY = 0.65;
export const JUMP_VELOCITY = -10.5;
export const BASE_SPEED = 4.2;
export const MAX_SPEED = 8.5;
export const REDUCED_MOTION_SPEED = 3.6;

export const HIGH_SCORE_STORAGE_KEY = "cc_offline_highscore_v1";

export type ObstacleType = "drink" | "trays";
export type ObstacleSize = "small" | "medium" | "large";

export interface Obstacle {
  id: number;
  type: ObstacleType;
  size: ObstacleSize;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BurgerPlayer {
  x: number;
  y: number;
  vy: number;
  width: number;
  height: number;
  isGrounded: boolean;
  isDucking: boolean;
}

export interface GameState {
  player: BurgerPlayer;
  obstacles: Obstacle[];
  score: number;
  highScore: number;
  speed: number;
  isGameOver: boolean;
  isPlaying: boolean;
  distanceTraveled: number;
  nextObstacleDistance: number;
  lastObstacleId: number;
}

export interface GameInput {
  jump: boolean;
  duck: boolean;
}

// ============================================================================
// 2. SEEDED PSEUDO-RANDOM NUMBER GENERATOR (Mulberry32)
// ============================================================================

export function createSeededRandom(seed: number) {
  let s = Math.floor(seed) >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// 3. OBSTACLE DIMENSIONS & GENERATION
// ============================================================================

export function getObstacleDimensions(type: ObstacleType, size: ObstacleSize): { width: number; height: number } {
  if (type === "drink") {
    switch (size) {
      case "small":
        return { width: 18, height: 26 };
      case "medium":
        return { width: 22, height: 32 };
      case "large":
      default:
        return { width: 26, height: 38 };
    }
  } else {
    // trays
    switch (size) {
      case "small":
        return { width: 30, height: 18 };
      case "medium":
        return { width: 34, height: 26 };
      case "large":
      default:
        return { width: 38, height: 34 };
    }
  }
}

export function spawnNextObstacle(
  rng: () => number,
  startX: number,
  id: number
): { obstacle: Obstacle; nextGap: number } {
  const type: ObstacleType = rng() > 0.5 ? "drink" : "trays";
  const sizeRoll = rng();
  const size: ObstacleSize = sizeRoll < 0.4 ? "small" : sizeRoll < 0.75 ? "medium" : "large";
  const dims = getObstacleDimensions(type, size);

  const obstacle: Obstacle = {
    id,
    type,
    size,
    x: startX,
    y: GROUND_Y - dims.height,
    width: dims.width,
    height: dims.height,
  };

  // Gap between obstacles (220 to 380 pixels)
  const nextGap = 220 + Math.floor(rng() * 160);
  return { obstacle, nextGap };
}

// ============================================================================
// 4. COLLISION DETECTION (AABB with fair hitbox padding)
// ============================================================================

export function checkCollision(player: BurgerPlayer, obstacle: Obstacle): boolean {
  // Fair inset padding so minor sprite edge overlaps do not feel punishing
  const paddingX = 4;
  const paddingY = 3;

  const playerLeft = player.x + paddingX;
  const playerRight = player.x + player.width - paddingX;
  const playerTop = player.y + paddingY;
  const playerBottom = player.y + player.height;

  const obsLeft = obstacle.x + paddingX;
  const obsRight = obstacle.x + obstacle.width - paddingX;
  const obsTop = obstacle.y + paddingY;
  const obsBottom = obstacle.y + obstacle.height;

  return (
    playerLeft < obsRight &&
    playerRight > obsLeft &&
    playerTop < obsBottom &&
    playerBottom > obsTop
  );
}

// ============================================================================
// 5. GAME PHYSICS & STATE UPDATE
// ============================================================================

export function createInitialGameState(highScore: number = 0): GameState {
  return {
    player: {
      x: 36,
      y: GROUND_Y - BURGER_HEIGHT_NORMAL,
      vy: 0,
      width: BURGER_WIDTH,
      height: BURGER_HEIGHT_NORMAL,
      isGrounded: true,
      isDucking: false,
    },
    obstacles: [],
    score: 0,
    highScore,
    speed: BASE_SPEED,
    isGameOver: false,
    isPlaying: false,
    distanceTraveled: 0,
    nextObstacleDistance: 260,
    lastObstacleId: 0,
  };
}

export function updateGameState(
  state: GameState,
  rng: () => number,
  input: GameInput,
  options?: { prefersReducedMotion?: boolean }
): GameState {
  if (!state.isPlaying || state.isGameOver) {
    return state;
  }

  const reduced = options?.prefersReducedMotion ?? false;
  const player = { ...state.player };

  // Handle Ducking
  if (input.duck && player.isGrounded) {
    player.isDucking = true;
    player.height = BURGER_HEIGHT_DUCK;
    player.y = GROUND_Y - BURGER_HEIGHT_DUCK;
  } else {
    player.isDucking = false;
    player.height = BURGER_HEIGHT_NORMAL;
  }

  // Handle Jump
  if (input.jump && player.isGrounded) {
    player.vy = JUMP_VELOCITY;
    player.isGrounded = false;
  }

  // Apply Gravity
  if (!player.isGrounded) {
    player.vy += GRAVITY;
    player.y += player.vy;

    // Check ground collision
    const targetGroundY = GROUND_Y - player.height;
    if (player.y >= targetGroundY) {
      player.y = targetGroundY;
      player.vy = 0;
      player.isGrounded = true;
    }
  }

  // Speed scaling (caps at MAX_SPEED, fixed if prefers-reduced-motion)
  const speed = reduced
    ? REDUCED_MOTION_SPEED
    : Math.min(BASE_SPEED + Math.floor(state.score / 100) * 0.45, MAX_SPEED);

  // Advance obstacles
  const movedObstacles: Obstacle[] = [];
  let isGameOver = false;

  for (const obs of state.obstacles) {
    const nextX = obs.x - speed;
    const moved = { ...obs, x: nextX };

    if (checkCollision(player, moved)) {
      isGameOver = true;
    }

    // Keep if still on screen
    if (nextX + moved.width > -10) {
      movedObstacles.push(moved);
    }
  }

  // Spawn new obstacles
  const distanceTraveled = state.distanceTraveled + speed;
  let nextObstacleDistance = state.nextObstacleDistance;
  let lastObstacleId = state.lastObstacleId;

  if (distanceTraveled >= nextObstacleDistance) {
    lastObstacleId += 1;
    const { obstacle, nextGap } = spawnNextObstacle(rng, GAME_CANVAS_WIDTH + 20, lastObstacleId);
    movedObstacles.push(obstacle);
    nextObstacleDistance = distanceTraveled + nextGap;
  }

  // Score increments by 1 per ~6 frames
  const score = state.score + 1;
  const highScore = Math.max(state.highScore, score);

  return {
    ...state,
    player,
    obstacles: movedObstacles,
    score,
    highScore,
    speed,
    isGameOver,
    isPlaying: !isGameOver,
    distanceTraveled,
    nextObstacleDistance,
    lastObstacleId,
  };
}

// ============================================================================
// 6. HIGH-SCORE LOCALSTORAGE HELPER
// ============================================================================

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
// 7. ROUTE SCOPING HELPER (Strict Student Route Allow-list)
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
// 8. REACHABILITY PROBE & STATE MACHINE
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
    // Immediately verify with probe
    void this.checkReachability(true);
  }

  public handleOfflineEvent(): void {
    // Start verification probe
    void this.checkReachability(false);
  }

  public handleVisibilityResume(): void {
    if (typeof document !== "undefined" && !document.hidden && this.status !== "online") {
      void this.checkReachability(false);
    }
  }
}
