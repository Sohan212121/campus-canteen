"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function isAuthOrExemptPath(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.trim().toLowerCase();
  return (
    p === "/login" ||
    p.startsWith("/login/") ||
    p === "/signup" ||
    p.startsWith("/signup/") ||
    p === "/forgot-password" ||
    p.startsWith("/forgot-password/") ||
    p === "/set-password" ||
    p.startsWith("/set-password/") ||
    p === "/auth" ||
    p.startsWith("/auth/")
  );
}

export function ServiceWorkerRegister() {
  const pathname = usePathname();
  const registeredRef = useRef(false);

  useEffect(() => {
    // Strictly production only - never in development
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Do not register on auth or password recovery paths
    if (isAuthOrExemptPath(pathname)) {
      return;
    }

    // Guard so register() is called at most once per page session
    if (registeredRef.current) {
      return;
    }

    const doRegister = () => {
      if (registeredRef.current) return;
      registeredRef.current = true;
      try {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .catch(() => {
            // Silently swallow registration failures
          });
      } catch {
        // Silently swallow synchronous exceptions
      }
    };

    if (document.readyState === "complete") {
      doRegister();
    } else {
      window.addEventListener("load", doRegister, { once: true });
      return () => {
        window.removeEventListener("load", doRegister);
      };
    }
  }, [pathname]);

  return null;
}
