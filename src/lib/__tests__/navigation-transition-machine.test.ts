import { describe, it, expect, beforeEach } from "vitest";
import {
  NavigationTransitionMachine,
  shouldTriggerTransition,
  getSectionTitle,
} from "@/lib/navigation-transition-machine";

describe("NavigationTransitionMachine (Phase 2 Pure State Machine)", () => {
  let machine: NavigationTransitionMachine;

  beforeEach(() => {
    machine = new NavigationTransitionMachine();
  });

  describe("Initial State", () => {
    it("starts in idle state with null optimistic path and hidden overlay", () => {
      const state = machine.getState();
      expect(state.status).toBe("idle");
      expect(state.overlayVisible).toBe(false);
      expect(state.isExiting).toBe(false);
      expect(state.optimisticPath).toBeNull();
      expect(state.targetPath).toBeNull();
    });
  });

  describe("1. Timing & Fast Route Skipping (< 60ms)", () => {
    it("skips overlay entirely if route completes within 60ms of tap", () => {
      const t0 = 1000;
      // User taps /menu
      const startRes = machine.start({
        targetPath: "/menu",
        now: t0,
      });
      expect(startRes.action).toBe("schedule_fast_check");
      expect(machine.getState().status).toBe("pending_fast_check");
      expect(machine.getState().overlayVisible).toBe(false);
      expect(machine.getState().optimisticPath).toBe("/menu");

      // Next.js commits /menu at t = t0 + 40ms (fast route)
      const pathRes = machine.onPathnameChange({
        newPathname: "/menu",
        now: t0 + 40,
      });

      expect(pathRes.action).toBe("skip_overlay");
      // Overlay was NEVER set to visible
      expect(machine.getState().overlayVisible).toBe(false);
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().optimisticPath).toBeNull();
    });

    it("displays overlay if route takes longer than 60ms", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/menu", now: t0 });

      // Fast check timeout fires at 60ms
      const shown = machine.onFastCheckElapsed();
      expect(shown).toBe(true);
      expect(machine.getState().status).toBe("visible");
      expect(machine.getState().overlayVisible).toBe(true);
      expect(machine.getState().isExiting).toBe(false);
    });
  });

  describe("2. Minimum Hold (350ms) & Readiness Handoff", () => {
    it("holds overlay until at least 350ms if route completes before 350ms", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/menu", now: t0 });
      machine.onFastCheckElapsed(); // overlay visible at t = t0 + 60ms

      // Route finishes at t = t0 + 200ms
      const pathRes = machine.onPathnameChange({
        newPathname: "/menu",
        now: t0 + 200,
      });

      // Must schedule exit for 350 - 200 = 150ms remaining
      expect(pathRes.action).toBe("schedule_exit");
      expect(pathRes.delayMs).toBe(150);
      expect(machine.getState().isExiting).toBe(false);

      // Once remaining delay elapses at 350ms
      machine.onMinHoldElapsed();
      expect(machine.getState().status).toBe("exiting");
      expect(machine.getState().isExiting).toBe(true);
      expect(machine.getState().optimisticPath).toBeNull();
    });

    it("exits immediately when route completes after 350ms", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/orders", now: t0 });
      machine.onFastCheckElapsed();

      // Route finishes at t = t0 + 500ms (> 350ms)
      const pathRes = machine.onPathnameChange({
        newPathname: "/orders",
        now: t0 + 500,
      });

      expect(pathRes.action).toBe("exit_immediately");
      expect(machine.getState().status).toBe("exiting");
      expect(machine.getState().isExiting).toBe(true);
      expect(machine.getState().optimisticPath).toBeNull();
    });

    it("completes exit fade after 180ms", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/orders", now: t0 });
      machine.onFastCheckElapsed();
      machine.onPathnameChange({ newPathname: "/orders", now: t0 + 500 });

      // Exit fade completes
      machine.onExitFadeComplete();
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().overlayVisible).toBe(false);
      expect(machine.getState().isExiting).toBe(false);
    });
  });

  describe("3. Hard Failsafe Upper Cap (1200ms)", () => {
    it("unconditionally exits and resets optimistic path at 1200ms if route never completes", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/cart", now: t0 });
      machine.onFastCheckElapsed();

      // 1200ms cap fires
      machine.onFailsafeCap();
      expect(machine.getState().status).toBe("exiting");
      expect(machine.getState().isExiting).toBe(true);
      expect(machine.getState().optimisticPath).toBeNull();

      machine.onExitFadeComplete();
      expect(machine.getState().status).toBe("idle");
    });
  });

  describe("4. Optimistic Path Reset Rules (Amendment 1)", () => {
    it("(a) resets optimisticPath on redirect (newPathname !== targetPath)", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/orders", now: t0 });
      expect(machine.getState().optimisticPath).toBe("/orders");

      // Server redirects unauthenticated user to /login
      const res = machine.onPathnameChange({
        newPathname: "/login",
        now: t0 + 100,
      });

      expect(res.action).toBe("redirect_reset");
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().optimisticPath).toBeNull();
      expect(machine.getState().overlayVisible).toBe(false);
    });

    it("(b) resets optimisticPath when 1200ms cap fires with no pathname change", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/profile", now: t0 });
      expect(machine.getState().optimisticPath).toBe("/profile");

      machine.onFailsafeCap();
      expect(machine.getState().optimisticPath).toBeNull();
    });

    it("(c) resets optimisticPath on popstate (browser Back/Forward)", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/menu", now: t0 });
      expect(machine.getState().optimisticPath).toBe("/menu");

      // User presses browser back button
      machine.cancel();
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().optimisticPath).toBeNull();
      expect(machine.getState().overlayVisible).toBe(false);
    });

    it("(d) resets optimisticPath when tab becomes hidden (visibilitychange / pagehide)", () => {
      const t0 = 1000;
      machine.start({ targetPath: "/healthy", now: t0 });
      expect(machine.getState().optimisticPath).toBe("/healthy");

      // User switches tab
      machine.cancel();
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().optimisticPath).toBeNull();
    });
  });

  describe("5. One Tap = One Transition Guard (Amendment 2)", () => {
    it("ignores duplicate startTransition call within 50ms on the same target", () => {
      const t0 = 1000;
      // First invocation from bottom-nav onClick
      const res1 = machine.start({ targetPath: "/menu", now: t0 });
      expect(res1.action).toBe("schedule_fast_check");

      // Second invocation from document click listener within 10ms
      const res2 = machine.start({ targetPath: "/menu", now: t0 + 10 });
      expect(res2.action).toBe("ignored");

      // State remains in original single transition
      expect(machine.getState().targetPath).toBe("/menu");
      expect(machine.getState().startTimestamp).toBe(t0);
    });
  });

  describe("6. Rapid Tap Replacement (Amendment 5)", () => {
    it("cleanly cancels active transition and immediately switches to newest target", () => {
      const t0 = 1000;
      // User taps Menu
      machine.start({ targetPath: "/menu", now: t0 });
      machine.onFastCheckElapsed();
      expect(machine.getState().targetPath).toBe("/menu");
      expect(machine.getState().optimisticPath).toBe("/menu");

      // User rapidly taps Orders at t = t0 + 120ms
      const res2 = machine.start({ targetPath: "/orders", now: t0 + 120 });
      expect(res2.action).toBe("schedule_fast_check");

      // State now points exclusively to /orders with new start timestamp
      expect(machine.getState().targetPath).toBe("/orders");
      expect(machine.getState().optimisticPath).toBe("/orders");
      expect(machine.getState().startTimestamp).toBe(t0 + 120);
      expect(machine.getState().overlayVisible).toBe(false); // fast-check restart
    });
  });

  describe("7. Skip Conditions & Reduced Motion", () => {
    it("skips transition on same-route re-tap", () => {
      const res = shouldTriggerTransition({
        targetHref: "/menu",
        currentPath: "/menu",
      });
      expect(res.shouldTrigger).toBe(false);
      expect(res.reason).toBe("same_route");
    });

    it("skips transition on query-only changes for current route", () => {
      const res = shouldTriggerTransition({
        targetHref: "/menu?category=hot-snacks",
        currentPath: "/menu",
      });
      expect(res.shouldTrigger).toBe(false);
      expect(res.reason).toBe("same_route");
    });

    it("skips transition on hash changes", () => {
      const res = shouldTriggerTransition({
        targetHref: "#top",
        currentPath: "/menu",
      });
      expect(res.shouldTrigger).toBe(false);
      expect(res.reason).toBe("external_or_hash");
    });

    it("skips transition on external links", () => {
      const res = shouldTriggerTransition({
        targetHref: "https://campus.edu",
        currentPath: "/",
      });
      expect(res.shouldTrigger).toBe(false);
    });

    it("skips overlay on prefers-reduced-motion while updating optimistic tab", () => {
      const t0 = 1000;
      const res = machine.start({
        targetPath: "/menu",
        now: t0,
        isReducedMotion: true,
      });

      expect(res.action).toBe("optimistic_only");
      expect(machine.getState().overlayVisible).toBe(false);
      expect(machine.getState().status).toBe("idle");
      expect(machine.getState().optimisticPath).toBe("/menu");
    });
  });

  describe("8. Title Mapping & Themes", () => {
    it("correctly identifies healthy routes and themes", () => {
      expect(getSectionTitle("/healthy")).toBe("Healthy Mode");
      expect(getSectionTitle("/healthy/score")).toBe("Healthy Score Guide");

      const t0 = 1000;
      machine.start({ targetPath: "/healthy", now: t0 });
      expect(machine.getState().theme).toBe("healthy");
      expect(machine.getState().destinationLabel).toBe("Healthy Mode");
    });

    it("correctly maps standard routes", () => {
      expect(getSectionTitle("/")).toBe("Campus Dining");
      expect(getSectionTitle("/menu")).toBe("Canteen Menu");
      expect(getSectionTitle("/cart")).toBe("Your Cart");
      expect(getSectionTitle("/orders")).toBe("Active Orders");
      expect(getSectionTitle("/profile")).toBe("Student Profile");
      expect(getSectionTitle("/checkout")).toBe("Secure Checkout");
      expect(getSectionTitle("/notifications")).toBe("Notifications");
    });
  });
});

