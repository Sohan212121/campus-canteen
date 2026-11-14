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

export const GRAVITY = 0.78;
export const JUMP_VELOCITY = -11.5;
export const BASE_SPEED = 4.2;
export const MAX_SPEED = 8.5;
export const REDUCED_MOTION_SPEED = 3.6;

import {
  HIGH_SCORE_STORAGE_KEY,
  getOfflineHighScore,
  saveOfflineHighScore,
  isStudentRoute,
  type ReachabilityStatus,
  type ProbeOptions,
  performReachabilityProbe,
  ReachabilityController,
  shouldPrefetchOfflineGame,
} from "./offline-reachability";

export {
  HIGH_SCORE_STORAGE_KEY,
  getOfflineHighScore,
  saveOfflineHighScore,
  isStudentRoute,
  type ReachabilityStatus,
  type ProbeOptions,
  performReachabilityProbe,
  ReachabilityController,
  shouldPrefetchOfflineGame,
};

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
