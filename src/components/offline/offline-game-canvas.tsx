"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  GAME_CANVAS_WIDTH,
  GAME_CANVAS_HEIGHT,
  GROUND_Y,
  GameState,
  BurgerPlayer,
  Obstacle,
  createInitialGameState,
  updateGameState,
  createSeededRandom,
  getOfflineHighScore,
  saveOfflineHighScore,
} from "@/lib/offline-game";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

export function OfflineGameCanvas({ onGameStart }: { onGameStart?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const [gameStatus, setGameStatus] = useState<"idle" | "playing" | "game_over">("idle");
  const gameStatusRef = useRef<"idle" | "playing" | "game_over">("idle");

  const stateRef = useRef<GameState | null>(null);
  const rngRef = useRef<() => number>(createSeededRandom(12345));
  const animFrameIdRef = useRef<number | null>(null);
  const inputRef = useRef<{ jump: boolean; duck: boolean }>({ jump: false, duck: false });
  const legCycleRef = useRef<number>(0);
  const lastJumpTimeRef = useRef<number>(0);
  const JUMP_BUFFER_MS = 220;

  // Canvas Drawing Routine
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!stateRef.current) {
      stateRef.current = createInitialGameState(0);
    }
    const s = stateRef.current;
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

    ctx.clearRect(0, 0, GAME_CANVAS_WIDTH, GAME_CANVAS_HEIGHT);

    // Ground line
    ctx.strokeStyle = isDark ? "#2A2E3D" : "#D4C7B0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(GAME_CANVAS_WIDTH, GROUND_Y);
    ctx.stroke();

    // Subtle ground dashes
    ctx.strokeStyle = isDark ? "#1E202B" : "#E2D7C3";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 8);
    ctx.lineTo(GAME_CANVAS_WIDTH, GROUND_Y + 8);
    ctx.stroke();
    ctx.setLineDash([]); // reset

    // Draw Obstacles
    for (const obs of s.obstacles) {
      drawObstacle(ctx, obs, isDark);
    }

    // Draw Burger Player
    drawBurger(ctx, s.player, legCycleRef.current, isDark);

    // Draw HUD: Score & High Score
    const scoreStr = String(s.score).padStart(5, "0");
    const highStr = String(s.highScore).padStart(5, "0");

    ctx.font = "bold 11px monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = isDark ? "#71717A" : "#8C8275";
    ctx.fillText(`HI ${highStr}   ${scoreStr}`, GAME_CANVAS_WIDTH - 12, 22);

    // Draw Start / Game Over Overlay message
    if (!s.isPlaying || s.isGameOver) {
      ctx.textAlign = "center";
      if (s.isGameOver) {
        ctx.fillStyle = isDark ? "#EF4444" : "#DC2626";
        ctx.font = "bold 14px sans-serif";
        ctx.fillText("G A M E   O V E R", GAME_CANVAS_WIDTH / 2, 70);

        ctx.fillStyle = isDark ? "#A1A1AA" : "#57534E";
        ctx.font = "11px sans-serif";
        ctx.fillText("Tap or press Space to try again", GAME_CANVAS_WIDTH / 2, 92);
      } else {
        ctx.fillStyle = isDark ? "#FACC15" : "#D9531E";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText("TAP OR PRESS SPACE TO JUMP", GAME_CANVAS_WIDTH / 2, 75);

        ctx.fillStyle = isDark ? "#71717A" : "#78716C";
        ctx.font = "10px sans-serif";
        ctx.fillText("Dodge the trays & spilled drinks!", GAME_CANVAS_WIDTH / 2, 95);
      }
    }
  }, []);

  // Initialize high score on mount
  useEffect(() => {
    const high = getOfflineHighScore();
    stateRef.current = createInitialGameState(high);
    drawCanvas();
  }, [drawCanvas]);

  // Restart / Start game
  const handleStartGame = useCallback(() => {
    rngRef.current = createSeededRandom(Date.now());
    const high = getOfflineHighScore();
    const fresh = createInitialGameState(high);
    fresh.isPlaying = true;
    stateRef.current = fresh;
    gameStatusRef.current = "playing";
    setGameStatus("playing");
    onGameStart?.();
  }, [onGameStart]);

  // Jump trigger with instant response & jump buffering
  const triggerJump = useCallback(() => {
    if (gameStatusRef.current !== "playing") {
      handleStartGame();
      return;
    }
    lastJumpTimeRef.current = Date.now();
    inputRef.current.jump = true;
  }, [handleStartGame]);

  // Keyboard controls with scroll protection ONLY while playing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        if (gameStatusRef.current === "playing") {
          e.preventDefault();
        }
        triggerJump();
      } else if (e.code === "ArrowDown") {
        if (gameStatusRef.current === "playing") {
          e.preventDefault();
        }
        inputRef.current.duck = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        inputRef.current.jump = false;
      } else if (e.code === "ArrowDown") {
        inputRef.current.duck = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [triggerJump]);

  // Pause when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && gameStatusRef.current === "playing") {
        if (stateRef.current) {
          stateRef.current.isPlaying = false;
        }
        gameStatusRef.current = "idle";
        setGameStatus("idle");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Main Animation / Game Loop
  useEffect(() => {
    const loop = () => {
      const current = stateRef.current;
      if (current && current.isPlaying && !current.isGameOver) {
        const now = Date.now();
        const isJumpBuffered = now - lastJumpTimeRef.current <= JUMP_BUFFER_MS;
        if (isJumpBuffered) {
          inputRef.current.jump = true;
        }

        const wasGrounded = current.player.isGrounded;
        legCycleRef.current = (legCycleRef.current + 0.25) % (Math.PI * 2);
        const next = updateGameState(current, rngRef.current, inputRef.current, {
          prefersReducedMotion,
        });

        // Consume jump buffer immediately once the jump has executed from ground
        if (wasGrounded && !next.player.isGrounded) {
          lastJumpTimeRef.current = 0;
          inputRef.current.jump = false;
        } else if (!isJumpBuffered) {
          inputRef.current.jump = false;
        }

        if (next.isGameOver) {
          saveOfflineHighScore(next.score);
          gameStatusRef.current = "game_over";
          setGameStatus("game_over");
        }

        stateRef.current = next;
      }

      drawCanvas();
      animFrameIdRef.current = requestAnimationFrame(loop);
    };

    animFrameIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [drawCanvas, prefersReducedMotion]);

  return (
    <div className="w-full flex flex-col items-center select-none touch-manipulation">
      <div
        className="relative w-full max-w-[375px] rounded-xl overflow-hidden border border-[#D4C7B0] dark:border-[#2A2E3D] bg-[#F7F2E8] dark:bg-[#0B0D13] shadow-inner cursor-pointer select-none touch-manipulation"
        style={{ touchAction: "manipulation" }}
        onPointerDown={(e) => {
          e.preventDefault();
          triggerJump();
        }}
        onClick={(e) => {
          e.preventDefault();
        }}
        role="button"
        tabIndex={0}
        aria-label={
          gameStatus === "idle"
            ? "Offline Mini Game. Tap to start playing."
            : gameStatus === "game_over"
            ? "Game over. Tap to restart."
            : "Playing game. Tap or press space to jump."
        }
      >
        <canvas
          ref={canvasRef}
          width={GAME_CANVAS_WIDTH}
          height={GAME_CANVAS_HEIGHT}
          className="w-full h-auto block select-none pointer-events-none"
        />
      </div>

      {/* Touch action controls with instantaneous zero-latency pointerdown response */}
      <div className="flex items-center gap-3 mt-3 w-full max-w-[375px]">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            triggerJump();
          }}
          onClick={(e) => {
            e.preventDefault();
          }}
          style={{ touchAction: "manipulation" }}
          className="flex-1 h-11 min-h-[44px] rounded-xl bg-[#D9531E] dark:bg-[#FACC15] text-white dark:text-[#090A0F] font-bold text-xs flex items-center justify-center shadow-xs active:scale-95 transition-transform duration-75 cursor-pointer select-none touch-manipulation"
        >
          {gameStatus === "game_over" ? "RETRY GAME" : gameStatus === "idle" ? "START GAME" : "JUMP"}
        </button>
        <button
          type="button"
          style={{ touchAction: "manipulation" }}
          onPointerDown={(e) => {
            e.preventDefault();
            inputRef.current.duck = true;
          }}
          onPointerUp={() => {
            inputRef.current.duck = false;
          }}
          onPointerLeave={() => {
            inputRef.current.duck = false;
          }}
          onClick={(e) => {
            e.preventDefault();
          }}
          className="w-20 h-11 min-h-[44px] rounded-xl bg-[#E6DEC9] dark:bg-[#1A1C24] text-[#181513] dark:text-[#E2E8F0] font-semibold text-xs flex items-center justify-center shadow-xs active:scale-95 transition-transform duration-75 cursor-pointer select-none touch-manipulation"
        >
          DUCK
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Canvas Geometric Drawing Helpers (Original Burger Character & Obstacles)
// ============================================================================

function drawBurger(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  // Leg rendering when running / jumping
  if (isGrounded && !isDucking) {
    const legOffset = Math.sin(legCycle) * 3;
    ctx.strokeStyle = isDark ? "#E2E8F0" : "#44403C";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";

    // Left leg
    ctx.beginPath();
    ctx.moveTo(width * 0.35, height - 2);
    ctx.lineTo(width * 0.35 - legOffset, height + 4);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(width * 0.65, height - 2);
    ctx.lineTo(width * 0.65 + legOffset, height + 4);
    ctx.stroke();
  }

  // 1. Bottom Bun
  ctx.fillStyle = isDark ? "#E5A93C" : "#D48B30";
  ctx.beginPath();
  ctx.roundRect(0, height * 0.72, width, height * 0.28, [0, 0, 5, 5]);
  ctx.fill();

  // 2. Patty
  ctx.fillStyle = isDark ? "#6E361A" : "#4E210D";
  ctx.beginPath();
  ctx.roundRect(2, height * 0.52, width - 4, height * 0.22, 3);
  ctx.fill();

  // 3. Cheese layer
  ctx.fillStyle = "#F59E0B";
  ctx.beginPath();
  ctx.moveTo(3, height * 0.52);
  ctx.lineTo(width - 3, height * 0.52);
  ctx.lineTo(width * 0.6, height * 0.62);
  ctx.lineTo(width * 0.45, height * 0.53);
  ctx.closePath();
  ctx.fill();

  // 4. Wavy Lettuce
  ctx.fillStyle = "#22C55E";
  ctx.beginPath();
  ctx.roundRect(1, height * 0.4, width - 2, height * 0.14, 2);
  ctx.fill();

  // 5. Top Bun (Dome)
  ctx.fillStyle = isDark ? "#F59E0B" : "#E08F2A";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height * 0.42, [10, 10, 2, 2]);
  ctx.fill();

  // Sesame seeds on top bun
  ctx.fillStyle = "#FEF3C7";
  const seeds = [
    [width * 0.3, height * 0.16],
    [width * 0.52, height * 0.12],
    [width * 0.7, height * 0.18],
    [width * 0.4, height * 0.26],
  ];
  for (const [sx, sy] of seeds) {
    ctx.beginPath();
    ctx.ellipse(sx, sy, 1.4, 0.8, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawObstacle(ctx: CanvasRenderingContext2D, obs: Obstacle, isDark: boolean) {
  ctx.save();
  ctx.translate(obs.x, obs.y);

  if (obs.type === "drink") {
    // Spilled Drink Cup
    const cupColor = isDark ? "#EF4444" : "#DC2626";
    const lidColor = isDark ? "#F8FAFC" : "#FFFFFF";

    // Puddle on ground
    ctx.fillStyle = isDark ? "rgba(239, 68, 68, 0.35)" : "rgba(220, 38, 38, 0.28)";
    ctx.beginPath();
    ctx.ellipse(obs.width * 0.5, obs.height - 2, obs.width * 0.55, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tilted Cup Body
    ctx.fillStyle = cupColor;
    ctx.beginPath();
    ctx.moveTo(3, 8);
    ctx.lineTo(obs.width - 3, 8);
    ctx.lineTo(obs.width - 6, obs.height - 3);
    ctx.lineTo(6, obs.height - 3);
    ctx.closePath();
    ctx.fill();

    // Cup Lid
    ctx.fillStyle = lidColor;
    ctx.beginPath();
    ctx.roundRect(1, 4, obs.width - 2, 4, 2);
    ctx.fill();

    // Straw sticking out
    ctx.strokeStyle = isDark ? "#FACC15" : "#F59E0B";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(obs.width * 0.5, 4);
    ctx.lineTo(obs.width * 0.7, -4);
    ctx.stroke();
  } else {
    // Stack of Cafeteria Trays
    const trayCount = obs.size === "small" ? 1 : obs.size === "medium" ? 2 : 3;
    const trayHeight = 6;
    const trayColors = isDark
      ? ["#3B82F6", "#10B981", "#F59E0B"]
      : ["#2563EB", "#059669", "#D97706"];

    for (let i = 0; i < trayCount; i++) {
      const ty = obs.height - (i + 1) * (trayHeight + 2);
      ctx.fillStyle = trayColors[i % trayColors.length];
      ctx.beginPath();
      ctx.roundRect(0, ty, obs.width, trayHeight, 2.5);
      ctx.fill();

      // Tray rim highlight
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(1, ty + 1, obs.width - 2, trayHeight - 2);
    }
  }

  ctx.restore();
}
