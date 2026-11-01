"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogoTransition } from "@/components/ui/logo-transition";
import { HealthyLogoTransition } from "@/components/ui/healthy-logo-transition";

interface NavigationTransitionContextType {
  startTransition: (destinationHref: string, customLabel?: string) => void;
  isTransitioning: boolean;
}

const NavigationTransitionContext = createContext<NavigationTransitionContextType>({
  startTransition: () => {},
  isTransitioning: false,
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
  if (SECTION_TITLES[path]) return SECTION_TITLES[path];
  if (path.startsWith("/healthy/score")) return "Healthy Score Guide";
  if (path.startsWith("/healthy")) return "Healthy Mode";
  if (path.startsWith("/orders/")) return "Order Token Tracker";
  if (path.startsWith("/admin")) return "Staff & Canteen Admin";
  if (path.startsWith("/staff")) return "Canteen Staff Board";
  return "Campus Dining";
}

const MIN_DISPLAY_MS = 350; // Standard routes: responsive & fluid
const HEALTHY_MIN_DISPLAY_MS = 800; // Healthy Mode: deliberate, premium showcase of botanical badge & light sweep
const EXIT_FADE_MS = 240;   // Matches cb-backdrop-exit & cb-stage-exit duration
const MAX_FAILSAFE_MS = 2500; // Failsafe if route change completely stalls

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState("Campus Dining");
  const [transitionTheme, setTransitionTheme] = useState<"standard" | "healthy">("standard");

  const currentPathRef = useRef(pathname);
  const pendingTargetRef = useRef<string | null>(null);
  const transitionThemeRef = useRef<"standard" | "healthy">("standard");
  const isTransitioningRef = useRef(false);
  const transitionStartRef = useRef<number>(0);
  const exitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const finishTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const failsafeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearAllTimers = () => {
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    if (failsafeTimeoutRef.current) clearTimeout(failsafeTimeoutRef.current);
  };

  // Trigger smooth transition
  const startTransition = useCallback((destinationHref: string, customLabel?: string) => {
    const targetPath = destinationHref.split("?")[0].split("#")[0];
    if (targetPath === currentPathRef.current) return;
    if (isTransitioningRef.current && targetPath === pendingTargetRef.current) return;

    clearAllTimers();

    const isHealthyDest = targetPath.startsWith("/healthy");
    const theme = isHealthyDest ? "healthy" : "standard";
    transitionThemeRef.current = theme;
    pendingTargetRef.current = targetPath;
    isTransitioningRef.current = true;

    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-transition-theme", theme);
      document.body.setAttribute("data-transition-target", targetPath);
    }

    setTransitionTheme(theme);
    setDestinationLabel(
      customLabel ||
        (isHealthyDest
          ? targetPath === "/healthy/score"
            ? "Healthy Score Guide"
            : "Healthy Mode"
          : getSectionTitle(targetPath))
    );

    transitionStartRef.current = Date.now();
    setIsExiting(false);
    setIsTransitioning(true);

    // Failsafe auto-dismiss if route does not update within 2.5s
    failsafeTimeoutRef.current = setTimeout(() => {
      setIsExiting(true);
      finishTimeoutRef.current = setTimeout(() => {
        setIsTransitioning(false);
        setIsExiting(false);
        isTransitioningRef.current = false;
        pendingTargetRef.current = null;
        if (typeof document !== "undefined") {
          document.documentElement.removeAttribute("data-transition-theme");
          document.body.removeAttribute("data-transition-target");
        }
      }, EXIT_FADE_MS);
    }, MAX_FAILSAFE_MS);
  }, []);

  // Intercept document link clicks for global automatic transitions
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Ignore external, non-navigation, or modifier-clicked links
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        anchor.target === "_blank"
      ) {
        return;
      }

      const targetPath = href.split("?")[0].split("#")[0];
      if (targetPath && targetPath !== currentPathRef.current && targetPath.startsWith("/")) {
        startTransition(href);
      }
    };

    document.addEventListener("click", handleDocumentClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleDocumentClick, { capture: true });
    };
  }, [startTransition]);

  // When pathname changes (navigation complete), smoothly exit after the minimum hold
  useEffect(() => {
    if (pathname !== currentPathRef.current) {
      currentPathRef.current = pathname;

      if (isTransitioning) {
        if (failsafeTimeoutRef.current) clearTimeout(failsafeTimeoutRef.current);

        const elapsed = Date.now() - transitionStartRef.current;
        const minHold = transitionThemeRef.current === "healthy" ? HEALTHY_MIN_DISPLAY_MS : MIN_DISPLAY_MS;
        const remainingHold = Math.max(0, minHold - elapsed);

        // Schedule exit after minimum hold duration
        exitTimeoutRef.current = setTimeout(() => {
          setIsExiting(true);
          finishTimeoutRef.current = setTimeout(() => {
            setIsTransitioning(false);
            setIsExiting(false);
            isTransitioningRef.current = false;
            pendingTargetRef.current = null;
            if (typeof document !== "undefined") {
              document.documentElement.removeAttribute("data-transition-theme");
              document.body.removeAttribute("data-transition-target");
            }
          }, EXIT_FADE_MS);
        }, remainingHold);
      }
    }
  }, [pathname, isTransitioning]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, []);

  return (
    <NavigationTransitionContext.Provider value={{ startTransition, isTransitioning }}>
      {children}
      {isTransitioning && (
        transitionTheme === "healthy" ? (
          <HealthyLogoTransition
            destinationLabel={destinationLabel}
            isExiting={isExiting}
          />
        ) : (
          <LogoTransition
            destinationLabel={destinationLabel}
            isExiting={isExiting}
          />
        )
      )}
    </NavigationTransitionContext.Provider>
  );
}
