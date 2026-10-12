import { describe, it, expect } from "vitest";
import {
  calculateResizeDimensions,
  isAnimatedGif,
} from "@/lib/client-image";

describe("client-image (Pure Geometry and Validation Tests)", () => {
  describe("calculateResizeDimensions", () => {
    it("does not upscale images smaller than maxDimension", () => {
      const result = calculateResizeDimensions({ width: 800, height: 600, maxDimension: 1200 });
      expect(result).toEqual({ width: 800, height: 600 });
    });

    it("scales down landscape images when width exceeds maxDimension", () => {
      const result = calculateResizeDimensions({ width: 2400, height: 1600, maxDimension: 1200 });
      expect(result.width).toBe(1200);
      expect(result.height).toBe(800);
    });

    it("scales down portrait images when height exceeds maxDimension", () => {
      const result = calculateResizeDimensions({ width: 1000, height: 2000, maxDimension: 1200 });
      expect(result.height).toBe(1200);
      expect(result.width).toBe(600);
    });

    it("scales down square images maintaining 1:1 aspect ratio", () => {
      const result = calculateResizeDimensions({ width: 1800, height: 1800, maxDimension: 1200 });
      expect(result).toEqual({ width: 1200, height: 1200 });
    });

    it("handles zero, negative, or invalid input gracefully", () => {
      expect(calculateResizeDimensions({ width: 0, height: 500 })).toEqual({ width: 0, height: 0 });
      expect(calculateResizeDimensions({ width: -100, height: 500 })).toEqual({ width: 0, height: 0 });
      expect(calculateResizeDimensions({ width: NaN, height: 500 })).toEqual({ width: 0, height: 0 });
    });
  });

  describe("isAnimatedGif", () => {
    it("identifies gif MIME type", () => {
      expect(isAnimatedGif({ type: "image/gif" })).toBe(true);
      expect(isAnimatedGif({ type: "IMAGE/GIF" })).toBe(true);
    });

    it("identifies gif file extension", () => {
      expect(isAnimatedGif({ name: "animation.gif" })).toBe(true);
      expect(isAnimatedGif({ name: "CAT.GIF" })).toBe(true);
    });

    it("returns false for non-gif formats", () => {
      expect(isAnimatedGif({ type: "image/jpeg", name: "photo.jpg" })).toBe(false);
      expect(isAnimatedGif({ type: "image/png", name: "graphic.png" })).toBe(false);
      expect(isAnimatedGif({ type: "image/webp", name: "food.webp" })).toBe(false);
    });
  });
});
