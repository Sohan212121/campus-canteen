"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogoTransition } from "@/components/ui/logo-transition";

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
};

export function getSectionTitle(path: string): string {
  if (SECTION_TITLES[path]) return SECTION_TITLES[path];
  if (path.startsWith("/orders/")) return "Order Token Tracker";
  if (path.startsWith("/admin")) return "Staff & Canteen Admin";
  if (path.startsWith("/staff")) return "Canteen Staff Board";
  return "Campus Dining";
}

const MIN_DISPLAY_MS = 350; // Responsive & fluid: shows pop & light sweep cleanly without sluggish lag
const EXIT_FADE_MS = 240;   // Matches cb-backdrop-exit & cb-stage-exit duration
const MAX_FAILSAFE_MS = 2500; // Failsafe if route change completely stalls

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState("Campus Dining");

  const currentPathRef = useRef(pathname);
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
    // Respect user's prefers-reduced-motion
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const targetPath = destinationHref.split("?")[0].split("#")[0];
    if (targetPath === currentPathRef.current || targetPath.startsWith("/healthy")) return;

    clearAllTimers();

    setDestinationLabel(customLabel || getSectionTitle(targetPath));
    transitionStartRef.current = Date.now();
    setIsExiting(false);
    setIsTransitioning(true);

    // Failsafe auto-dismiss if route does not update within 2.5s
    failsafeTimeoutRef.current = setTimeout(() => {
      setIsExiting(true);
      finishTimeoutRef.current = setTimeout(() => {
        setIsTransitioning(false);
        setIsExiting(false);
      }, EXIT_FADE_MS);
    }, MAX_FAILSAFE_MS);
  }, []);

  // Intercept document link clicks for global automatic transitions
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
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
      if (
        targetPath &&
        targetPath !== currentPathRef.current &&
        targetPath.startsWith("/") &&
        !targetPath.startsWith("/healthy")
      ) {
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
        const remainingHold = Math.max(0, MIN_DISPLAY_MS - elapsed);

        // Schedule exit after minimum hold duration
        exitTimeoutRef.current = setTimeout(() => {
          setIsExiting(true);
          finishTimeoutRef.current = setTimeout(() => {
            setIsTransitioning(false);
            setIsExiting(false);
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
        <LogoTransition
          destinationLabel={destinationLabel}
          isExiting={isExiting}
        />
      )}
    </NavigationTransitionContext.Provider>
  );
}
