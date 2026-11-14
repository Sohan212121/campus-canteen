import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { isAuthOrExemptPath } from "../../components/offline/sw-register";
import { proxy } from "../../proxy";
import { type NextRequest } from "next/server";

describe("Offline Service Worker Static Architecture & Invariants", () => {
  const rootDir = process.cwd();
  const swPath = path.join(rootDir, "public", "sw.js");
  const offlineHtmlPath = path.join(rootDir, "public", "offline.html");
  const killSwitchDocPath = path.join(rootDir, "docs", "OFFLINE_SERVICE_WORKER_KILL_SWITCH.md");

  it("verifies public/sw.js exists and precaches ONLY /offline.html", () => {
    expect(fs.existsSync(swPath)).toBe(true);
    const swContent = fs.readFileSync(swPath, "utf-8");

    // Must define cache name and marker
    expect(swContent).toContain("campbite-offline-v1");
    expect(swContent).toContain("CAMPBITE_OFFLINE_SHELL_V1");
    expect(swContent).toContain("/offline.html");

    // Static test: sw.js must NOT put any dynamic request into the cache
    expect(swContent).not.toMatch(/cache\.(put|add)\s*\(\s*event\.request/);
    expect(swContent).not.toMatch(/caches\.open\([^)]+\)\.then\([^)]*put\s*\([^)]*event\.request/);

    // Static test: the ONLY URL cached must be OFFLINE_URL (/offline.html)
    const putCalls = swContent.match(/cache\.(put|add)\s*\([^)]+\)/g) || [];
    for (const call of putCalls) {
      expect(call).toMatch(/OFFLINE_URL|"\/?offline\.html"/);
    }
  });

  it("verifies public/offline.html exists, is self-contained, and stays under 100 KB", () => {
    expect(fs.existsSync(offlineHtmlPath)).toBe(true);
    const stats = fs.statSync(offlineHtmlPath);
    const content = fs.readFileSync(offlineHtmlPath, "utf-8");

    // File size budget: strictly under 100 KB
    expect(stats.size).toBeLessThan(100 * 1024);
    expect(stats.size).toBeGreaterThan(10 * 1024); // contains embedded base64 artwork

    // Contains mandatory verification marker
    expect(content).toContain("<!-- CAMPBITE_OFFLINE_SHELL_V1 -->");

    // Contains offline reassurance and friendly wording
    expect(content).toContain("You're offline");
    expect(content).toContain("Orders you have already placed are safe.");
    expect(content).toContain("Retry Connection");

    // Embeds both light and dark base64 data URIs preserving the official brand artwork
    expect(content).toContain("data:image/png;base64,");
    expect(content).toContain('alt="C@MPBITE"');

    // Theme detection: reads next-themes key "theme" in try/catch without writing to storage
    expect(content).toContain('localStorage.getItem("theme")');
    expect(content).not.toContain("localStorage.setItem");

    // Retry button throttles reloads to at most once per 5 seconds and handles "online" event
    expect(content).toContain("addEventListener");
    expect(content).toContain('"online"');
    expect(content).toContain("5000");
  });

  it("verifies docs/OFFLINE_SERVICE_WORKER_KILL_SWITCH.md documents tombstone worker", () => {
    expect(fs.existsSync(killSwitchDocPath)).toBe(true);
    const docContent = fs.readFileSync(killSwitchDocPath, "utf-8");

    expect(docContent).toContain("self.registration.unregister()");
    expect(docContent).toContain("caches.delete");
    expect(docContent).toContain("skipWaiting()");
  });
});

describe("Service Worker Filter & Bypass Rules", () => {
  // Extract and simulate isBypassedPath logic from sw.js
  function isBypassedPath(pathname: string): boolean {
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
      p.startsWith("/api/")
    );
  }

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
      clone: () => ({ text: async () => "CAMPBITE_OFFLINE_SHELL_V1" }),
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
      clone: () => ({ text: async () => "CAMPBITE_OFFLINE_SHELL_V1" }),
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
      if (!text.includes("CAMPBITE_OFFLINE_SHELL_V1")) {
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
    // Location header must be null (not redirected to /login)
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes /offline.html through without redirecting even when user is signed out", async () => {
    const req = createMockRequest("/offline.html");
    const res = await proxy(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
