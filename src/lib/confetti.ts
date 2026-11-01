export type ConfettiShape = "circle" | "square" | "rect";

export interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  delayMs: number;
  durationMs: number;
  colorIndex: number;
  shape: ConfettiShape;
  sizePx: number;
}

export const CONFETTI_COLORS = [
  "#10b981", // Emerald 500
  "#3b82f6", // Blue 500
  "#f59e0b", // Amber 500
  "#ec4899", // Pink 500
  "#8b5cf6", // Purple 500
  "#06b6d4", // Cyan 500
] as const;

/**
 * Deterministic pure helper to generate a confetti burst piece list.
 * Derives coordinates, delays, durations, colours and shapes without Math.random()
 * so there is no hydration mismatch between SSR and client render.
 */
export function generateConfettiPieces(count: number, seed = 42): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = [];
  const shapes: ConfettiShape[] = ["circle", "square", "rect"];

  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random integer sequence based on index and seed
    const pseudoA = (i * 37 + seed * 17 + 13) % 100;
    const pseudoB = (i * 53 + seed * 23 + 29) % 100;
    const pseudoC = (i * 71 + seed * 31 + 43) % 100;
    const pseudoD = (i * 97 + seed * 41 + 61) % 100;

    // Angle evenly distributed around 360 with a deterministic jitter
    const baseAngle = (i / count) * 360;
    const angleJitter = ((pseudoA - 50) / 50) * (180 / count);
    const angleRad = ((baseAngle + angleJitter) * Math.PI) / 180;

    // Radius / spread
    const distance = 80 + ((pseudoB / 100) * 120);

    // X position: spread outward from center
    const x = Math.round(Math.cos(angleRad) * distance);

    // Y position: outward spread plus downward gravity bias
    const y = Math.round(Math.sin(angleRad) * (distance * 0.7) + 100 + (pseudoC * 1.4));

    // Rotation: -360 to +360 deg
    const rotation = Math.round(((pseudoD - 50) / 50) * 360);

    // Delay: 0 to 260 ms
    const delayMs = (i * 23) % 260;

    // Duration: 1400 to 2200 ms
    const durationMs = 1400 + (pseudoA * 8);

    // Shape & Size
    const shape = shapes[i % shapes.length];
    const sizePx = shape === "rect" ? 6 : shape === "circle" ? 8 : 7;

    pieces.push({
      id: i,
      x,
      y,
      rotation,
      delayMs,
      durationMs,
      colorIndex: i % CONFETTI_COLORS.length,
      shape,
      sizePx,
    });
  }

  return pieces;
}

