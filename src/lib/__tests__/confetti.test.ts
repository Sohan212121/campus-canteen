import { describe, it, expect, vi } from "vitest";
import { generateConfettiPieces, CONFETTI_COLORS } from "../confetti";

describe("Confetti Pure Helper (Deterministic & No Math.random)", () => {
  it("generates deterministic output for the same input and seed", () => {
    const run1 = generateConfettiPieces(28, 42);
    const run2 = generateConfettiPieces(28, 42);

    expect(run1).toEqual(run2);
    expect(run1.length).toBe(28);
  });

  it("never calls Math.random during execution", () => {
    const randomSpy = vi.spyOn(Math, "random");
    generateConfettiPieces(32, 100);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it("generates exact requested counts (e.g. 28 for placed, 16 for collected)", () => {
    expect(generateConfettiPieces(28).length).toBe(28);
    expect(generateConfettiPieces(16).length).toBe(16);
    expect(generateConfettiPieces(0).length).toBe(0);
  });

  it("outputs coordinates, rotations, delays, and durations within valid ranges", () => {
    const pieces = generateConfettiPieces(30);

    for (const piece of pieces) {
      expect(typeof piece.id).toBe("number");
      expect(piece.x).toBeGreaterThanOrEqual(-250);
      expect(piece.x).toBeLessThanOrEqual(250);
      expect(piece.y).toBeGreaterThan(0); // drops downward
      expect(piece.rotation).toBeGreaterThanOrEqual(-360);
      expect(piece.rotation).toBeLessThanOrEqual(360);
      expect(piece.delayMs).toBeGreaterThanOrEqual(0);
      expect(piece.delayMs).toBeLessThanOrEqual(300);
      expect(piece.durationMs).toBeGreaterThanOrEqual(1200);
      expect(piece.durationMs).toBeLessThanOrEqual(2500);
      expect(piece.colorIndex).toBeGreaterThanOrEqual(0);
      expect(piece.colorIndex).toBeLessThan(CONFETTI_COLORS.length);
      expect(["circle", "square", "rect"]).toContain(piece.shape);
      expect(piece.sizePx).toBeGreaterThan(0);
    }
  });

  it("distributes variety across shapes and brand colors", () => {
    const pieces = generateConfettiPieces(28);
    const shapes = new Set(pieces.map((p) => p.shape));
    const colors = new Set(pieces.map((p) => p.colorIndex));

    expect(shapes.has("circle")).toBe(true);
    expect(shapes.has("square")).toBe(true);
    expect(shapes.has("rect")).toBe(true);
    expect(colors.size).toBe(CONFETTI_COLORS.length);
  });
});

