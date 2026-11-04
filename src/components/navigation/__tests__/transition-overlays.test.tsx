import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import * as fs from "fs";
import * as path from "path";
import { LogoTransition } from "@/components/ui/logo-transition";
import { HealthyLogoTransition } from "@/components/ui/healthy-logo-transition";

describe("Transition Overlays (Phase 2 UI Invariants)", () => {
  const logoTransitionFile = fs.readFileSync(
    path.resolve(__dirname, "../../ui/logo-transition.tsx"),
    "utf-8"
  );
  const healthyTransitionFile = fs.readFileSync(
    path.resolve(__dirname, "../../ui/healthy-logo-transition.tsx"),
    "utf-8"
  );

  describe("LogoTransition (Standard)", () => {
    it("has pointer-events-none from the first frame so clicks pass through", () => {
      const html = renderToString(
        <LogoTransition destinationLabel="Canteen Menu" isExiting={false} />
      );
      expect(html).toContain("pointer-events-none");
      expect(logoTransitionFile).toContain("pointer-events-none select-none");
    });

    it("uses z-30 (below bottom nav's z-40) and removes z-[100] or z-[9999]", () => {
      const html = renderToString(
        <LogoTransition destinationLabel="Canteen Menu" isExiting={false} />
      );
      expect(html).toContain("z-30");
      expect(html).not.toContain("z-[100]");
      expect(html).not.toContain("z-[9999]");
      expect(logoTransitionFile).not.toContain("z-[100]");
      expect(logoTransitionFile).not.toContain("z-[9999]");
    });

    it("contains no looping animations (no animate-pulse, no animate-ping)", () => {
      const html = renderToString(
        <LogoTransition destinationLabel="Canteen Menu" isExiting={false} />
      );
      expect(html).not.toContain("animate-pulse");
      expect(html).not.toContain("animate-ping");
      expect(logoTransitionFile).not.toContain("animate-pulse");
      expect(logoTransitionFile).not.toContain("animate-ping");
    });

    it("does not render solid opaque background (no #FFFDF5 or #12131A)", () => {
      const html = renderToString(
        <LogoTransition destinationLabel="Canteen Menu" isExiting={false} />
      );
      expect(html).not.toContain("bg-[#FFFDF5]");
      expect(html).not.toContain("bg-[#12131A]");
      expect(logoTransitionFile).not.toContain("bg-[#FFFDF5]");
      expect(logoTransitionFile).not.toContain("bg-[#12131A]");
    });
  });

  describe("HealthyLogoTransition (Healthy Mode)", () => {
    it("has pointer-events-none from the first frame so clicks pass through", () => {
      const html = renderToString(
        <HealthyLogoTransition destinationLabel="Healthy Mode" isExiting={false} />
      );
      expect(html).toContain("pointer-events-none");
      expect(healthyTransitionFile).toContain("pointer-events-none select-none");
    });

    it("uses z-30 and removes z-[9999]", () => {
      const html = renderToString(
        <HealthyLogoTransition destinationLabel="Healthy Mode" isExiting={false} />
      );
      expect(html).toContain("z-30");
      expect(html).not.toContain("z-[9999]");
      expect(healthyTransitionFile).not.toContain("z-[9999]");
    });

    it("contains no looping animations (no animate-pulse, no animate-ping)", () => {
      const html = renderToString(
        <HealthyLogoTransition destinationLabel="Healthy Mode" isExiting={false} />
      );
      expect(html).not.toContain("animate-pulse");
      expect(html).not.toContain("animate-ping");
      expect(healthyTransitionFile).not.toContain("animate-pulse");
      expect(healthyTransitionFile).not.toContain("animate-ping");
    });

    it("does not render solid opaque dark green backdrop (no #04120c)", () => {
      const html = renderToString(
        <HealthyLogoTransition destinationLabel="Healthy Mode" isExiting={false} />
      );
      expect(html).not.toContain("bg-[#04120c]");
      expect(healthyTransitionFile).not.toContain("bg-[#04120c]");
      // Translucent veil
      expect(html).toContain("bg-emerald-950/15");
    });
  });
});
