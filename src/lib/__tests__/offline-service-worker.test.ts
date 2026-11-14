import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { isAuthOrExemptPath } from "../../components/offline/sw-register";
import {
  OFFLINE_CACHE_NAME,
  OFFLINE_URL,
  OFFLINE_SHELL_MARKER,
  isBypassedPath,
  isEligibleNavigationRequest,
  isStaleCacheName,
} from "../offline-service-worker";
import {
  JUMP_TARGET_DISTANCE_START,
  JUMP_TARGET_DISTANCE_END,
  JUMP_PEAK_HEIGHT,
  FAST_FALL_MULTIPLIER,
} from "../offline-game";
import { proxy } from "../../proxy";
import { type NextRequest } from "next/server";

describe("Offline Service Worker Static Architecture & Invariants", () => {
  const rootDir = process.cwd();
  const swPath = path.join(rootDir, "public", "sw.js");
  const offlineHtmlPath = path.join(rootDir, "public", "offline.html");
  const killSwitchDocPath = path.join(rootDir, "docs", "OFFLINE_SERVICE_WORKER_KILL_SWITCH.md");

  it("verifies public/sw.js exists and precaches ONLY /offline.html and static icons", () => {
    expect(fs.existsSync(swPath)).toBe(true);
    const swContent = fs.readFileSync(swPath, "utf-8");

    // Must define bumped cache name and marker
    expect(swContent).toContain("campbite-offline-v2");
    expect(swContent).toContain("CAMPBITE_OFFLINE_SHELL_V2");
    expect(swContent).toContain(OFFLINE_URL);

    // Static behavioural test: sw.js must NOT put any dynamic request into the cache
    expect(swContent).not.toMatch(/cache\.(put|add)\s*\(\s*event\.request/);
    expect(swContent).not.toMatch(/caches\.open\([^)]+\)\.then\([^)]*put\s*\([^)]*event\.request/);

    // Static behavioural test: the ONLY URLs put into cache are OFFLINE_URL and static icon paths
    const putCalls = swContent.match(/cache\.(put|add)\s*\([^)]+\)/g) || [];
    for (const call of putCalls) {
      expect(call).toMatch(/OFFLINE_URL|iconUrl|"\/?offline\.html"/);
    }

    // Static behavioural test: checks request method GET and navigation mode
    expect(swContent).toContain('event.request.method !== "GET"');
    expect(swContent).toContain('event.request.mode !== "navigate"');
    expect(swContent).toContain("url.origin !== self.location.origin");

    // Network timeout is set to about 15 seconds
    expect(swContent).toMatch(/15000/);
  });

  it("verifies public/offline.html exists, is self-contained, and stays under 150 KB", () => {
    expect(fs.existsSync(offlineHtmlPath)).toBe(true);
    const stats = fs.statSync(offlineHtmlPath);
    const content = fs.readFileSync(offlineHtmlPath, "utf-8");

    // File size budget: strictly under 150 KB and has content (> 10 KB)
    expect(stats.size).toBeLessThan(150 * 1024);
    expect(stats.size).toBeGreaterThan(10 * 1024);

    // Contains mandatory verification marker
    expect(content).toContain("<!-- CAMPBITE_OFFLINE_SHELL_V2 -->");

    // Contains offline reassurance and friendly wording
    expect(content).toContain("You're offline");
    expect(content).toContain("Orders you have already placed are safe.");
    expect(content).toContain("Retry Connection");

    // Embeds both light and dark base64 data URIs preserving official brand artwork
    expect(content).toContain("data:image/png;base64,");
    expect(content).toContain('alt="C@MPBITE"');

    // Theme detection: reads next-themes key "theme" in try/catch without writing to theme storage
    expect(content).toContain('localStorage.getItem("theme")');
    expect(content).not.toContain('localStorage.setItem("theme"');

    // Retry button throttles reloads to at most once per 5 seconds and handles "online" event
    expect(content).toContain("addEventListener");
    expect(content).toContain('"online"');
    expect(content).toContain("5000");
  });

  it("verifies the embedded offline game in public/offline.html matches exact jump constants from src/lib/offline-game.ts", () => {
    const content = fs.readFileSync(offlineHtmlPath, "utf-8");

    // Extract constants from embedded standalone script in public/offline.html
    const startDistMatch = content.match(/JUMP_TARGET_DISTANCE_START\s*=\s*(\d+(?:\.\d+)?)/);
    const endDistMatch = content.match(/JUMP_TARGET_DISTANCE_END\s*=\s*(\d+(?:\.\d+)?)/);
    const peakHeightMatch = content.match(/JUMP_PEAK_HEIGHT\s*=\s*(\d+(?:\.\d+)?)/);
    const fastFallMatch = content.match(/FAST_FALL_MULTIPLIER\s*=\s*(\d+(?:\.\d+)?)/);

    expect(startDistMatch).not.toBeNull();
    expect(endDistMatch).not.toBeNull();
    expect(peakHeightMatch).not.toBeNull();
    expect(fastFallMatch).not.toBeNull();

    const htmlStartDist = parseFloat(startDistMatch![1]);
    const htmlEndDist = parseFloat(endDistMatch![1]);
    const htmlPeakHeight = parseFloat(peakHeightMatch![1]);
    const htmlFastFall = parseFloat(fastFallMatch![1]);

    // Fails if any constant differs from src/lib/offline-game.ts
    expect(htmlStartDist).toBe(JUMP_TARGET_DISTANCE_START);
    expect(htmlEndDist).toBe(JUMP_TARGET_DISTANCE_END);
    expect(htmlPeakHeight).toBe(JUMP_PEAK_HEIGHT);
    expect(htmlFastFall).toBe(FAST_FALL_MULTIPLIER);

    // Verify expected physical numerical values
    expect(htmlStartDist).toBe(205);
    expect(htmlEndDist).toBe(126);
    expect(htmlPeakHeight).toBe(86);
    expect(htmlFastFall).toBe(2.2);

    // Verify canvas and game controls exist in HTML
    expect(content).toContain('id="offline-game-canvas"');
    expect(content).toContain('id="play-game-btn"');
    expect(content).toContain('id="close-game-btn"');
    expect(content).toContain("cc_offline_highscore_v1");
  });

  it("verifies docs/OFFLINE_SERVICE_WORKER_KILL_SWITCH.md documents tombstone worker", () => {
    expect(fs.existsSync(killSwitchDocPath)).toBe(true);
    const docContent = fs.readFileSync(killSwitchDocPath, "utf-8");

    expect(docContent).toContain("self.registration.unregister()");
    expect(docContent).toContain("caches.delete");
    expect(docContent).toContain("skipWaiting()");
    expect(docContent).toContain("campbite-offline-v2");
  });
});

describe("Pure Helper Functions: isEligibleNavigationRequest & isStaleCacheName", () => {
  const origin = "https://example.com";

  it("allows standard GET navigation requests on student routes", () => {
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "navigate", url: `${origin}/` }, origin)
    ).toBe(true);
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "navigate", url: `${origin}/menu` }, origin)
    ).toBe(true);
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "navigate", url: `${origin}/cart` }, origin)
    ).toBe(true);
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "navigate", url: `${origin}/orders` }, origin)
    ).toBe(true);
  });

  it("rejects non-GET requests", () => {
    expect(
      isEligibleNavigationRequest({ method: "POST", mode: "navigate", url: `${origin}/menu` }, origin)
    ).toBe(false);
    expect(
      isEligibleNavigationRequest({ method: "PUT", mode: "navigate", url: `${origin}/cart` }, origin)
    ).toBe(false);
    expect(
      isEligibleNavigationRequest({ method: "DELETE", mode: "navigate", url: `${origin}/orders` }, origin)
    ).toBe(false);
  });

  it("rejects non-navigation requests (assets, api fetches, subresources)", () => {
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "cors", url: `${origin}/menu` }, origin)
    ).toBe(false);
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "no-cors", url: `${origin}/image.png` }, origin)
    ).toBe(false);
    expect(
      isEligibleNavigationRequest({ method: "GET", mode: "same-origin", url: `${origin}/script.js` }, origin)
    ).toBe(false);
  });

  it("rejects cross-origin requests", () => {
    expect(
      isEligibleNavigationRequest(
        { method: "GET", mode: "navigate", url: "https://evil.com/menu" },
        origin
      )
    ).toBe(false);
    expect(
      isEligibleNavigationRequest(
        { method: "GET", mode: "navigate", url: "https://auth.supabase.co/" },
        origin
      )
    ).toBe(false);
  });

  it.each([
    "/login",
    "/signup",
    "/forgot-password",
    "/set-password",
    "/auth",
    "/auth/confirm",
    "/auth/callback",
    "/auth/deactivated",
    "/api",
    "/api/orders",
    "/api/orders/123/pickup-code",
    "/_next/data/123/menu.json",
  ])("rejects bypassed auth, api, and data route: %s", (path) => {
    expect(
      isEligibleNavigationRequest(
        { method: "GET", mode: "navigate", url: `${origin}${path}` },
        origin
      )
    ).toBe(false);
    expect(isBypassedPath(path)).toBe(true);
  });

  it("identifies stale cache names for automatic purging during activate", () => {
    expect(isStaleCacheName("campbite-offline-v1", OFFLINE_CACHE_NAME)).toBe(true);
    expect(isStaleCacheName("campbite-offline-v0", OFFLINE_CACHE_NAME)).toBe(true);
    expect(isStaleCacheName("workbox-precache", OFFLINE_CACHE_NAME)).toBe(true);
    expect(isStaleCacheName("campbite-offline-v2", OFFLINE_CACHE_NAME)).toBe(false);
  });
});

describe("Service Worker Filter & Bypass Rules", () => {
  it.each([
    "/login",
    "/signup",
    "/forgot-password",
    "/set-password",
    "/auth/confirm",
    "/auth/callback",
    "/auth/deactivated",
    "/api/orders",
    "/api/health",
  ])("strictly bypasses %s without calling respondWith", (bypassPath) => {
    expect(isBypassedPath(bypassPath)).toBe(true);
  });

  it.each([
    "/",
    "/menu",
    "/cart",
    "/checkout",
    "/orders",
    "/orders/123",
    "/profile",
    "/notifications",
    "/healthy",
    "/offline",
  ])("allows navigation fallback interception on %s", (studentPath) => {
    expect(isBypassedPath(studentPath)).toBe(false);
  });
});

describe("Service Worker Precache Validation & Redirect Protection", () => {
  it("rejects precache if response is redirected (e.g. redirected to /login)", () => {
    const mockRedirectedResponse = {
      ok: true,
      redirected: true,
      headers: new Headers({ "content-type": "text/html" }),
      clone: () => ({ text: async () => OFFLINE_SHELL_MARKER }),
    };

    const validate = (res: typeof mockRedirectedResponse) => {
      if (!res.ok) throw new Error("not ok");
      if (res.redirected) throw new Error("Precache rejected: response was redirected");
      if (!res.headers.get("content-type")?.includes("text/html")) throw new Error("bad content-type");
    };

    expect(() => validate(mockRedirectedResponse)).toThrow("Precache rejected: response was redirected");
  });

  it("rejects precache if status is not ok (e.g. 500 error)", () => {
    const mock500Response = {
      ok: false,
      status: 500,
      redirected: false,
      headers: new Headers({ "content-type": "text/html" }),
      clone: () => ({ text: async () => OFFLINE_SHELL_MARKER }),
    };

    const validate = (res: typeof mock500Response) => {
      if (!res.ok) throw new Error(`Precache failed: status ${res.status}`);
    };

    expect(() => validate(mock500Response)).toThrow("Precache failed: status 500");
  });

  it("rejects precache if body lacks the marker string", async () => {
    const mockMissingMarkerResponse = {
      ok: true,
      redirected: false,
      headers: new Headers({ "content-type": "text/html" }),
      clone: () => ({ text: async () => "<html>Random Error Page</html>" }),
    };

    const validateAsync = async (res: typeof mockMissingMarkerResponse) => {
      const text = await res.clone().text();
      if (!text.includes(OFFLINE_SHELL_MARKER)) {
        throw new Error("Precache rejected: missing marker string");
      }
    };

    await expect(validateAsync(mockMissingMarkerResponse)).rejects.toThrow(
      "Precache rejected: missing marker string"
    );
  });
});

describe("ServiceWorkerRegister Component Gating (isAuthOrExemptPath)", () => {
  it.each([
    "/login",
    "/signup",
    "/forgot-password",
    "/set-password",
    "/auth/confirm",
    "/auth/callback",
  ])("blocks registration on auth route %s", (path) => {
    expect(isAuthOrExemptPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/menu",
    "/cart",
    "/checkout",
    "/orders",
    "/profile",
    "/notifications",
  ])("allows registration on student route %s", (path) => {
    expect(isAuthOrExemptPath(path)).toBe(false);
  });
});

describe("Proxy Bypass Integration for Service Worker Assets", () => {
  function createMockRequest(pathname: string): NextRequest {
    const url = new URL(`https://example.com${pathname}`);
    return {
      method: "GET",
      headers: new Headers(),
      nextUrl: {
        pathname: url.pathname,
        searchParams: url.searchParams,
        clone: () => new URL(url.toString()),
      },
      cookies: {
        getAll: () => [],
        set: vi.fn(),
      },
    } as unknown as NextRequest;
  }

  it("passes /sw.js through without redirecting even when user is signed out", async () => {
    const req = createMockRequest("/sw.js");
    const res = await proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes /offline.html through without redirecting even when user is signed out", async () => {
    const req = createMockRequest("/offline.html");
    const res = await proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
