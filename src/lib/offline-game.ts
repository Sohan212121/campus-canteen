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
export const INITIAL_SPEED = 2.5; // ~60% of original 4.2 base speed
export const BASE_SPEED = 4.2;
export const MAX_SPEED = 8.5;
export const REDUCED_MOTION_SPEED = 3.6;

// Tunable variable jump arc constants (inverse scaling: longer jump at start, snappier/shorter at high speed)
export const JUMP_TARGET_DISTANCE_START = 205; // Tunable: 195 to 210 px (at INITIAL_SPEED)
export const JUMP_TARGET_DISTANCE_END = 126;   // Tunable: 122 to 135 px (at MAX_SPEED)
export const JUMP_PEAK_HEIGHT = 86;            // Target peak height in pixels (matches baseline ~85-90px)
export const FAST_FALL_MULTIPLIER = 2.2;       // Downward gravity multiplier when duck is held in air
export const OBSTACLE_MAX_WIDTH = 38;          // Widest obstacle (large trays: 38px)
export const JUMP_SAFETY_MARGIN_PX = 40;       // Safety margin added to gap clearance

// Speed ramp: smoothly ramps from INITIAL_SPEED to MAX_SPEED over 75 seconds (at 60 FPS = 4,500 frames / score)
export const SPEED_RAMP_DURATION_SEC = 75;
export const TARGET_FPS = 60;
export const SPEED_RAMP_FRAMES = SPEED_RAMP_DURATION_SEC * TARGET_FPS; // 4500 frames

// Grace period: player runs 320px (at least 120 frames = 2.0s with speed ramp) before the first obstacle spawns
export const FIRST_OBSTACLE_DISTANCE = 320;

// Legacy baseline reference airtime
export const JUMP_AIRBORNE_FRAMES = 31;

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
  jumpGravity: number;
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

/**
 * Calculates the current game speed as a deterministic, pure function of score (elapsed frames).
 * Guaranteed to start at INITIAL_SPEED (2.5), be monotonically non-decreasing, and cap strictly at MAX_SPEED (8.5).
 * Reaches MAX_SPEED at exactly SPEED_RAMP_FRAMES (4,500 frames = 75.0 seconds at 60 FPS).
 */
export function calculateGameSpeed(
  score: number,
  options?: { prefersReducedMotion?: boolean }
): number {
  if (options?.prefersReducedMotion) {
    return REDUCED_MOTION_SPEED;
  }
  const progress = Math.min(Math.max(score, 0) / SPEED_RAMP_FRAMES, 1);
  const rawSpeed = INITIAL_SPEED + (MAX_SPEED - INITIAL_SPEED) * progress;
  return Math.min(Math.round(rawSpeed * 100) / 100, MAX_SPEED);
}

/**
 * Target horizontal jump distance as a smooth, continuous linear function of current speed.
 * Starts longer at INITIAL_SPEED (205px) and shortens smoothly to (126px) at MAX_SPEED.
 */
export function getTargetJumpDistance(speed: number): number {
  const clampedSpeed = Math.min(Math.max(speed, INITIAL_SPEED), MAX_SPEED);
  const progress = (clampedSpeed - INITIAL_SPEED) / (MAX_SPEED - INITIAL_SPEED);
  return (
    JUMP_TARGET_DISTANCE_START -
    (JUMP_TARGET_DISTANCE_START - JUMP_TARGET_DISTANCE_END) * progress
  );
}

/**
 * Derives initial jump velocity (v0 = 4H/T) and gravity (g = 8H/T^2) from the target
 * peak height H and airtime T at the moment the jump starts.
 */
export function calculateJumpPhysics(speed: number): {
  v0: number;
  gravity: number;
  targetAirtime: number;
} {
  const targetDistance = getTargetJumpDistance(speed);
  const targetAirtime = targetDistance / Math.max(speed, 0.1);
  const v0 = -(4 * JUMP_PEAK_HEIGHT) / targetAirtime;
  const gravity = (8 * JUMP_PEAK_HEIGHT) / (targetAirtime * targetAirtime);
  return { v0, gravity, targetAirtime };
}

/**
 * Calculates the minimum possible gap between two consecutive obstacles at a given speed and score.
 *
 * Mathematical & gameplay guarantee:
 * - At every speed from INITIAL_SPEED to MAX_SPEED:
 *   minGap >= jumpDistance + OBSTACLE_MAX_WIDTH + BURGER_WIDTH + JUMP_SAFETY_MARGIN_PX
 * - Guarantees that even at peak jump distance, a player jumping over one obstacle will land
 *   safely with ample margin before encountering the next obstacle.
 * - Never smaller than the 280px base gap.
 * - Early in the run (score 0), a generous bonus gap (up to +100px) is added for beginner comfort.
 */
export function getMinObstacleGap(speed: number, score: number = 0): number {
  const jumpDistance = getTargetJumpDistance(speed);
  const clearanceRequired = Math.ceil(
    jumpDistance + OBSTACLE_MAX_WIDTH + BURGER_WIDTH + JUMP_SAFETY_MARGIN_PX
  );
  const safeBaseGap = Math.max(280, clearanceRequired);

  const progress = Math.min(Math.max(score, 0) / SPEED_RAMP_FRAMES, 1);
  const earlyGapBonus = Math.round(100 * (1 - progress));

  return safeBaseGap + earlyGapBonus;
}

export function spawnNextObstacle(
  rng: () => number,
  startX: number,
  id: number,
  speed: number = BASE_SPEED,
  score: number = 0
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

  const minGap = getMinObstacleGap(speed, score);
  const nextGap = minGap + Math.floor(rng() * 120);
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
      jumpGravity: GRAVITY,
    },
    obstacles: [],
    score: 0,
    highScore,
    speed: INITIAL_SPEED,
    isGameOver: false,
    isPlaying: false,
    distanceTraveled: 0,
    nextObstacleDistance: FIRST_OBSTACLE_DISTANCE,
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
    const { v0, gravity } = calculateJumpPhysics(state.speed);
    player.vy = v0;
    player.jumpGravity = gravity;
    player.isGrounded = false;
  }

  // Apply Gravity & Fast-Fall
  if (!player.isGrounded) {
    // When duck is held while airborne, fast-fall accelerates downward descent
    const effectiveGravity = input.duck
      ? player.jumpGravity * FAST_FALL_MULTIPLIER
      : player.jumpGravity;
    player.vy += effectiveGravity;
    player.y += player.vy;

    // Check ground collision
    const targetGroundY = GROUND_Y - player.height;
    if (player.y >= targetGroundY) {
      player.y = targetGroundY;
      player.vy = 0;
      player.isGrounded = true;
      player.jumpGravity = GRAVITY;
    }
  }

  // Smooth, gradual speed ramp based on elapsed play score / time
  const speed = calculateGameSpeed(state.score, options);

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
    const { obstacle, nextGap } = spawnNextObstacle(
      rng,
      GAME_CANVAS_WIDTH + 20,
      lastObstacleId,
      speed,
      state.score
    );
    movedObstacles.push(obstacle);
    nextObstacleDistance = distanceTraveled + nextGap;
  }

  // Score increments by 1 per frame while playing
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
