"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogoTransition } from "@/components/ui/logo-transition";
import { HealthyLogoTransition } from "@/components/ui/healthy-logo-transition";
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

const SECTION_TITLES: Record<string, string> = {
  "/": "Campus Dining",
  "/menu": "Canteen Menu",
  "/cart": "Your Cart",
  "/orders": "Active Orders",
  "/profile": "Student Profile",
  "/checkout": "Secure Checkout",
  "/notifications": "Notifications",
  "/healthy": "Healthy Mode",
  "/healthy/score": "Healthy Score Guide",
};

export function getSectionTitle(path: string): string {
  const clean = normalizeNavPath(path);
  if (SECTION_TITLES[clean]) return SECTION_TITLES[clean];
  if (clean.startsWith("/healthy/score")) return "Healthy Score Guide";
  if (clean.startsWith("/healthy")) return "Healthy Mode";
  if (clean.startsWith("/orders/")) return "Order Token Tracker";
  if (clean.startsWith("/admin")) return "Staff & Canteen Admin";
  if (clean.startsWith("/staff")) return "Canteen Staff Board";
  return "Campus Dining";
}

// Snappy readiness-driven timing constants: eliminates artificial delays while allowing smooth logo entrance
const MIN_HOLD_MS = 350;     // Minimum display so the signature logo animation plays cleanly without flashing
const EXIT_FADE_MS = 180;    // Fast opacity exit fade
const MAX_FAILSAFE_MS = 1200;// Hard upper limit so the screen NEVER gets stuck

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState("Campus Dining");
  const [transitionTheme, setTransitionTheme] = useState<"standard" | "healthy">("standard");
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  const currentPathRef = useRef(pathname);
  const targetPathRef = useRef<string | null>(null);
  const startTimestampRef = useRef<number>(0);
  const isTransitioningRef = useRef(false);
  const lastTapRef = useRef<{ target: string; time: number }>({ target: "", time: 0 });

  // Timers and Animation Frame refs for rigorous cleanup
  const minHoldTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finishTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const failsafeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const clearAllTimers = useCallback(() => {
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
    setIsTransitioning(false);
    setIsExiting(false);
    isTransitioningRef.current = false;
    setOptimisticPath(null);
    targetPathRef.current = null;
    startTimestampRef.current = 0;

    if (typeof document !== "undefined") {
      document.documentElement.removeAttribute("data-transition-theme");
      document.body.removeAttribute("data-transition-target");
    }
  }, [clearAllTimers]);

  // Trigger rapid, readiness-driven transition
  const startTransition = useCallback(
    (destinationHref: string, customLabel?: string) => {
      const now = Date.now();
      const cleanTarget = normalizeNavPath(destinationHref);
      const cleanCurrent = normalizeNavPath(currentPathRef.current);

      if (!cleanTarget) return;

      // Ignore re-taps on the current active section
      if (cleanTarget === cleanCurrent) return;

      // Deduplication guard: ignore double triggers from both Link onClick and document click listener within 80ms
      if (
        lastTapRef.current.target === cleanTarget &&
        now - lastTapRef.current.time < 80
      ) {
        return;
      }
      lastTapRef.current = { target: cleanTarget, time: now };

      // Rapid tap replacement: if user rapidly taps another section, cancel previous and immediately switch to new target
      clearAllTimers();

      const isHealthy = cleanTarget.startsWith("/healthy");
      const theme = isHealthy ? "healthy" : "standard";
      const label =
        customLabel ||
        (isHealthy
          ? cleanTarget === "/healthy/score"
            ? "Healthy Score Guide"
            : "Healthy Mode"
          : getSectionTitle(cleanTarget));

      targetPathRef.current = cleanTarget;
      startTimestampRef.current = now;
      isTransitioningRef.current = true;

      // Optimistic highlight: selected section becomes visible and highlighted IMMEDIATELY on click
      setOptimisticPath(cleanTarget);
      setTransitionTheme(theme);
      setDestinationLabel(label);
      setIsExiting(false);

      // Check prefers-reduced-motion: if reduced motion is preferred, highlight immediately without showing animated overlay
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (prefersReducedMotion) {
        return;
      }

      setIsTransitioning(true);

      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-transition-theme", theme);
        document.body.setAttribute("data-transition-target", cleanTarget);
      }

      // Hard upper cap failsafe (1200ms): dismisses overlay even if route navigation stalls
      failsafeTimeoutRef.current = setTimeout(() => {
        setIsExiting(true);
        finishTimeoutRef.current = setTimeout(() => {
          resetTransition();
        }, EXIT_FADE_MS);
      }, MAX_FAILSAFE_MS);
    },
    [clearAllTimers, resetTransition]
  );

  // When pathname changes (Next.js navigation completes and commits)
  useEffect(() => {
    if (pathname === currentPathRef.current) return;

    currentPathRef.current = pathname;
    const cleanCurrent = normalizeNavPath(pathname);
    const cleanTarget = targetPathRef.current;

    // Condition A: If redirected to another route (e.g. auth redirect to /login), reset immediately
    if (cleanTarget && cleanCurrent !== cleanTarget) {
      resetTransition();
      return;
    }

    // Condition B: Destination reached -> readiness-driven handoff with zero unnecessary delay
    if (isTransitioningRef.current) {
      if (failsafeTimeoutRef.current) {
        clearTimeout(failsafeTimeoutRef.current);
        failsafeTimeoutRef.current = null;
      }

      // Wait for next paint frame so destination route DOM has mounted
      rafIdRef.current = requestAnimationFrame(() => {
        const elapsed = Date.now() - startTimestampRef.current;
        const remainingHold = Math.max(0, MIN_HOLD_MS - elapsed);

        minHoldTimeoutRef.current = setTimeout(() => {
          setIsExiting(true);
          // Destination is ready and painted: release optimistic path to real pathname
          setOptimisticPath(null);

          finishTimeoutRef.current = setTimeout(() => {
            resetTransition();
          }, EXIT_FADE_MS);
        }, remainingHold);
      });
    } else {
      // Direct navigation without transition
      setOptimisticPath(null);
    }
  }, [pathname, resetTransition]);

  // Global document click listener for in-app anchor links
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      // Ignore non-primary clicks (middle click, right click)
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

  // System Safeguards: popstate (Back/Forward), visibilitychange (tab hidden), and pagehide
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
        isTransitioning,
        optimisticPath,
        activeNavPath,
      }}
    >
      {children}
      {isTransitioning &&
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
