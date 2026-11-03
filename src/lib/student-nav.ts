/**
 * Pure navigation helper utilities for the Student portal.
 * Handles active tab computation, path boundary normalization,
 * and header/bottom-nav routing rules.
 */

export interface BottomNavTabItem {
  label: string;
  href: string;
}

export const STUDENT_BOTTOM_NAV_ITEMS: readonly BottomNavTabItem[] = [
  { label: "Home", href: "/" },
  { label: "Menu", href: "/menu" },
  { label: "Healthy", href: "/healthy" },
  { label: "Cart", href: "/cart" },
  { label: "Orders", href: "/orders" },
] as const;

/**
 * Normalizes a raw URL path:
 * - strips whitespace, query params, hash fragments, and trailing slashes
 * - ensures a single leading slash
 * - converts empty/null/undefined into empty string ""
 */
export function normalizeNavPath(rawPath: string | null | undefined): string {
  if (!rawPath || typeof rawPath !== "string") return "";

  const trimmed = rawPath.trim();
  if (!trimmed) return "";

  // Strip query strings and hash anchors
  const clean = trimmed.split("?")[0].split("#")[0].trim();
  if (!clean) return "";

  // Root path stays "/"
  if (clean === "/") return "/";

  // Remove trailing slashes
  const noTrailing = clean.replace(/\/+$/, "");

  // Ensure leading slash
  return noTrailing.startsWith("/") ? noTrailing : `/${noTrailing}`;
}

/**
 * Determines whether a specific bottom navigation tab is active for the given pathname.
 *
 * Rules:
 * 1. Boundary match: A path is active for an href only if it equals the href
 *    or starts with href + "/" (so /menu does not match /menus and /healthy does not match /healthy-x).
 * 2. Normalizes trailing slashes, query params, hashes, and handles null/empty safely.
 * 3. /healthy and /healthy/score highlight the Healthy tab (/healthy).
 * 4. /profile highlights no bottom tab (header Profile button is highlighted instead).
 * 5. /notifications and /checkout highlight no bottom tab.
 * 6. Home (/) matches ONLY "/" (never matches sub-routes like /menu or /healthy).
 */
export function isBottomNavActive(
  itemHref: string,
  rawPathname: string | null | undefined
): boolean {
  const pathname = normalizeNavPath(rawPathname);
  if (!pathname) return false;

  const targetHref = normalizeNavPath(itemHref);
  if (!targetHref) return false;

  // Non-navigating or external pages explicitly highlighted elsewhere or unhighlighted
  if (
    pathname === "/profile" ||
    pathname.startsWith("/profile/") ||
    pathname === "/notifications" ||
    pathname.startsWith("/notifications/") ||
    pathname === "/checkout" ||
    pathname.startsWith("/checkout/")
  ) {
    return false;
  }

  // Home route must strictly match root
  if (targetHref === "/") {
    return pathname === "/";
  }

  // Exact match
  if (pathname === targetHref) {
    return true;
  }

  // Boundary subpath match (targetHref + "/")
  return pathname.startsWith(`${targetHref}/`);
}

/**
 * Computes the active bottom navigation tab href, or null if none is active.
 */
export function getActiveBottomNavTab(
  rawPathname: string | null | undefined
): string | null {
  const pathname = normalizeNavPath(rawPathname);
  if (!pathname) return null;

  for (const item of STUDENT_BOTTOM_NAV_ITEMS) {
    if (isBottomNavActive(item.href, pathname)) {
      return item.href;
    }
  }

  return null;
}

/**
 * Determines whether the header Profile button should display as active.
 * Active on /profile and any /profile/* sub-routes.
 */
export function isProfileHeaderActive(rawPathname: string | null | undefined): boolean {
  const pathname = normalizeNavPath(rawPathname);
  if (!pathname) return false;
  return pathname === "/profile" || pathname.startsWith("/profile/");
}

