/**
 * Campus Canteen Offline Service Worker Pure Decision Utilities
 *
 * Provides deterministic helpers for service worker request eligibility,
 * path bypass checks, and cache version management.
 * Self-contained, zero auth imports, 100% testable in Vitest.
 */

export const OFFLINE_CACHE_NAME = "campbite-offline-v2";
export const OFFLINE_URL = "/offline.html";
export const OFFLINE_SHELL_MARKER = "CAMPBITE_OFFLINE_SHELL_V2";

export const PRECACHE_ASSETS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
] as const;

/**
 * Checks whether a URL pathname is an authentication, password recovery, API,
 * or Next.js data route that must strictly bypass the offline service worker.
 */
export function isBypassedPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
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
    p.startsWith("/auth/") ||
    p === "/api" ||
    p.startsWith("/api/") ||
    p.startsWith("/_next/data/")
  );
}

/**
 * Pure decision function: determines if an incoming request is eligible
 * for service worker offline navigation fallback.
 *
 * Rules:
 * 1. Must be GET method.
 * 2. Must be request.mode === "navigate".
 * 3. Must be same-origin.
 * 4. Must not be in the bypass path list.
 */
export function isEligibleNavigationRequest(
  request: { method: string; mode?: string; url: string },
  currentOrigin: string
): boolean {
  if (request.method !== "GET") {
    return false;
  }
  if (request.mode !== "navigate") {
    return false;
  }

  try {
    const url = new URL(request.url);
    if (url.origin !== currentOrigin) {
      return false;
    }
    if (isBypassedPath(url.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure decision function: identifies stale cache versions during activate.
 */
export function isStaleCacheName(
  cacheName: string,
  activeCacheName: string = OFFLINE_CACHE_NAME
): boolean {
  return cacheName !== activeCacheName;
}
