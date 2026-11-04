"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogoTransition } from "@/components/ui/logo-transition";
import { HealthyLogoTransition } from "@/components/ui/healthy-logo-transition";
import {
  FAST_ROUTE_THRESHOLD_MS,
  MIN_HOLD_MS,
  MAX_FAILSAFE_MS,
  EXIT_FADE_MS,
  type TransitionTheme,
  getSectionTitle,
  shouldTriggerTransition,
} from "@/lib/navigation-transition-machine";
import { normalizeNavPath } from "@/lib/student-nav";

interface NavigationTransitionContextType {
  startTransition: (destinationHref: string, customLabel?: string) => void;
  isTransitioning: boolean;
  optimisticPath: string | null;
  activeNavPath: string;
}

const NavigationTransitionContext = createContext<NavigationTransitionContextType>({
  startTransition: () => {},
  isTransitioning: false,
  optimisticPath: null,
  activeNavPath: "/",
});

export const useNavigationTransition = () => useContext(NavigationTransitionContext);

export { getSectionTitle };

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [overlayVisible, setOverlayVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState("Campus Dining");
  const [transitionTheme, setTransitionTheme] = useState<TransitionTheme>("standard");
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  const currentPathRef = useRef(pathname);
  const targetPathRef = useRef<string | null>(null);
  const startTimestampRef = useRef<number>(0);
  const lastTapRef = useRef<{ target: string; time: number }>({ target: "", time: 0 });

  // Timers and Animation Frame references for rigorous cleanup
  const fastCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const minHoldTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finishTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const failsafeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const clearAllTimers = useCallback(() => {
    if (fastCheckTimeoutRef.current) {
      clearTimeout(fastCheckTimeoutRef.current);
      fastCheckTimeoutRef.current = null;
    }
    if (minHoldTimeoutRef.current) {
      clearTimeout(minHoldTimeoutRef.current);
      minHoldTimeoutRef.current = null;
    }
    if (finishTimeoutRef.current) {
      clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
    if (failsafeTimeoutRef.current) {
      clearTimeout(failsafeTimeoutRef.current);
      failsafeTimeoutRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const resetTransition = useCallback(() => {
    clearAllTimers();
    setOverlayVisible(false);
    setIsExiting(false);
    setOptimisticPath(null);
    targetPathRef.current = null;
    startTimestampRef.current = 0;

    if (typeof document !== "undefined") {
      document.documentElement.removeAttribute("data-transition-theme");
      document.body.removeAttribute("data-transition-target");
    }
  }, [clearAllTimers]);

  const startTransition = useCallback(
    (destinationHref: string, customLabel?: string) => {
      const now = Date.now();
      const cleanTarget = normalizeNavPath(destinationHref);
      const cleanCurrent = normalizeNavPath(currentPathRef.current);

      // Guard 1: Duplicate tap within 80ms (e.g. bottom-nav Link onClick + document click listener)
      if (
        lastTapRef.current.target === cleanTarget &&
        now - lastTapRef.current.time < 80
      ) {
        return;
      }
      lastTapRef.current = { target: cleanTarget, time: now };

      // Guard 2: Reduced motion preferences check
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const decision = shouldTriggerTransition({
        targetHref: destinationHref,
        currentPath: cleanCurrent,
        isReducedMotion: prefersReducedMotion,
      });

      if (!decision.shouldTrigger) {
        // Even if overlay is skipped (e.g. reduced motion), update optimistic tab highlight
        if (decision.reason === "reduced_motion" && decision.cleanTarget) {
          setOptimisticPath(decision.cleanTarget);
        }
        return;
      }

      // Rapid tap replacement: cleanly cancel previous transition for newest target
      clearAllTimers();

      const isHealthy = cleanTarget.startsWith("/healthy");
      const theme: TransitionTheme = isHealthy ? "healthy" : "standard";
      const label =
        customLabel ||
        (isHealthy
          ? cleanTarget === "/healthy/score"
            ? "Healthy Score Guide"
            : "Healthy Mode"
          : getSectionTitle(cleanTarget));

      targetPathRef.current = cleanTarget;
      startTimestampRef.current = now;

      // Optimistic highlight follows the tapped tab IMMEDIATELY
      setOptimisticPath(cleanTarget);
      setTransitionTheme(theme);
      setDestinationLabel(label);
      setIsExiting(false);

      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-transition-theme", theme);
        document.body.setAttribute("data-transition-target", cleanTarget);
      }

      // Fast-route gate: Defer overlay visibility by 60ms. If route completes < 60ms, overlay is skipped entirely.
      fastCheckTimeoutRef.current = setTimeout(() => {
        setOverlayVisible(true);
      }, FAST_ROUTE_THRESHOLD_MS);

      // Hard upper cap failsafe (1200ms): unconditionally dismisses overlay and resets optimistic path
      failsafeTimeoutRef.current = setTimeout(() => {
        setIsExiting(true);
        finishTimeoutRef.current = setTimeout(() => {
          resetTransition();
        }, EXIT_FADE_MS);
      }, MAX_FAILSAFE_MS);
    },
    [clearAllTimers, resetTransition]
  );

  // When pathname changes (Next.js navigation committed)
  useEffect(() => {
    if (pathname === currentPathRef.current) return;

    currentPathRef.current = pathname;
    const cleanCurrent = normalizeNavPath(pathname);
    const cleanTarget = targetPathRef.current;

    // Condition A: Redirected to a route different from the tapped target
    if (cleanTarget && cleanCurrent !== cleanTarget) {
      resetTransition();
      return;
    }

    // Condition B: Fast route completed within 60ms threshold
    const elapsed = Date.now() - startTimestampRef.current;
    if (startTimestampRef.current > 0 && elapsed <= FAST_ROUTE_THRESHOLD_MS) {
      resetTransition();
      return;
    }

    // Condition C: Target reached after overlay became visible -> readiness handoff
    if (targetPathRef.current) {
      if (failsafeTimeoutRef.current) {
        clearTimeout(failsafeTimeoutRef.current);
        failsafeTimeoutRef.current = null;
      }

      // Wait for paint tick (requestAnimationFrame) so route skeleton/content is committed to DOM
      rafIdRef.current = requestAnimationFrame(() => {
        const timeSinceStart = Date.now() - startTimestampRef.current;
        const remainingHold = Math.max(0, MIN_HOLD_MS - timeSinceStart);

        minHoldTimeoutRef.current = setTimeout(() => {
          setIsExiting(true);
          // Destination reached and confirmed painted: release optimistic path to real pathname
          setOptimisticPath(null);

          finishTimeoutRef.current = setTimeout(() => {
            resetTransition();
          }, EXIT_FADE_MS);
        }, remainingHold);
      });
    } else {
      // Direct navigation without startTransition
      setOptimisticPath(null);
    }
  }, [pathname, resetTransition]);

  // Global document click listener for in-app anchor links
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      // Guard against non-primary clicks (middle click, right click)
      if (e.button !== 0) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Ignore external, non-navigation, modified clicks, downloads, or target="_blank"
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self") ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      const cleanTarget = normalizeNavPath(href);
      const cleanCurrent = normalizeNavPath(currentPathRef.current);

      if (cleanTarget && cleanTarget !== cleanCurrent) {
        startTransition(href);
      }
    };

    document.addEventListener("click", handleDocumentClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleDocumentClick, { capture: true });
    };
  }, [startTransition]);

  // Listeners for popstate (Back/Forward), visibilitychange (hidden), and pagehide
  useEffect(() => {
    const handlePopState = () => {
      resetTransition();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        resetTransition();
      }
    };

    const handlePageHide = () => {
      resetTransition();
    };

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      clearAllTimers();
    };
  }, [resetTransition, clearAllTimers]);

  const activeNavPath = optimisticPath ?? pathname;

  return (
    <NavigationTransitionContext.Provider
      value={{
        startTransition,
        isTransitioning: overlayVisible,
        optimisticPath,
        activeNavPath,
      }}
    >
      {children}
      {overlayVisible &&
        (transitionTheme === "healthy" ? (
          <HealthyLogoTransition
            destinationLabel={destinationLabel}
            isExiting={isExiting}
          />
        ) : (
          <LogoTransition
            destinationLabel={destinationLabel}
            isExiting={isExiting}
          />
        ))}
    </NavigationTransitionContext.Provider>
  );
}
