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
  "/": "Campus Dining Home",
  "/menu": "Daily Menu & Chef Specials",
  "/cart": "Student Cart & Checkout",
  "/orders": "Active Orders & Pickups",
  "/profile": "Student Account & Profile",
  "/checkout": "Secure Checkout & Payment",
  "/notifications": "Campus Alerts & Updates",
};

export function getSectionTitle(path: string): string {
  if (SECTION_TITLES[path]) return SECTION_TITLES[path];
  if (path.startsWith("/orders/")) return "Order Token & Live Tracker";
  if (path.startsWith("/admin")) return "Staff & Canteen Admin";
  if (path.startsWith("/staff")) return "Canteen Staff Board";
  return "Campus Dining";
}

export function NavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [destinationLabel, setDestinationLabel] = useState("Campus Dining");

  const currentPathRef = useRef(pathname);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exitTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Manual trigger for programmatic navigation
  const startTransition = useCallback((destinationHref: string, customLabel?: string) => {
    // Respect prefers-reduced-motion
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const targetPath = destinationHref.split("?")[0].split("#")[0];
    if (targetPath === currentPathRef.current) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);

    setDestinationLabel(customLabel || getSectionTitle(targetPath));
    setIsExiting(false);
    setIsTransitioning(true);

    // Failsafe timeout: auto-exit after 1200ms if navigation stalls
    timeoutRef.current = setTimeout(() => {
      setIsExiting(true);
      exitTimeoutRef.current = setTimeout(() => {
        setIsTransitioning(false);
        setIsExiting(false);
      }, 220);
    }, 1200);
  }, []);

  // Listen to document link clicks for seamless automatic route transitions
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      // Find closest anchor tag
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Ignore external links, hash anchors, or modified clicks (cmd/ctrl/shift)
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

  // When pathname changes (navigation complete), smoothly exit the overlay
  useEffect(() => {
    if (pathname !== currentPathRef.current) {
      currentPathRef.current = pathname;

      if (isTransitioning) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        const exitDelayTimer = setTimeout(() => {
          setIsExiting(true);
          exitTimeoutRef.current = setTimeout(() => {
            setIsTransitioning(false);
            setIsExiting(false);
          }, 220);
        }, 30);

        return () => clearTimeout(exitDelayTimer);
      }
    }
  }, [pathname, isTransitioning]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
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
