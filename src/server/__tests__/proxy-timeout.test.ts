import { describe, it, expect, vi, beforeEach } from "vitest";
import { type NextRequest } from "next/server";

// Mock Supabase SSR client
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

// Mock timeout to simulate AbortSignal timeout immediately in tests
vi.mock("@/lib/timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/timeout")>();
  return {
    ...actual,
    withTimeout: vi.fn(async (promiseOrFactory: unknown) => {
      // If mock signals a timeout test
      if ((globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__) {
        throw new actual.TimeoutError("auth service unreachable");
      }
      return typeof promiseOrFactory === "function"
        ? (promiseOrFactory as (s: AbortSignal) => unknown)(new AbortController().signal)
        : promiseOrFactory;
    }),
  };
});

import { proxy } from "@/proxy";

function createMockRequest(pathname: string): NextRequest {
  const url = new URL(`https://example.com${pathname}`);
  const setCookiesMock = vi.fn();
  return {
    method: "GET",
    headers: new Headers(),
    nextUrl: {
      pathname,
      clone: () => new URL(url.toString()),
    },
    cookies: {
      getAll: () => [{ name: "sb-auth-token", value: "valid-session" }],
      set: setCookiesMock,
    },
  } as unknown as NextRequest;
}

describe("Sub-Step 3C: Timeout safety for slow Supabase in Proxy & Auth helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
    (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = false;
  });

  describe("Protected routes during auth timeout", () => {
    it.each(["/", "/menu", "/cart", "/orders", "/profile", "/staff", "/admin"])(
      "returns HTTP 503 Service Unavailable on %s and NEVER redirects to /login",
      async (protectedPath) => {
        (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = true;
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const req = createMockRequest(protectedPath);
        const res = await proxy(req);

        // 1. Status must be 503
        expect(res.status).toBe(503);

        // 2. Must NEVER redirect (no Location header)
        expect(res.headers.get("location")).toBeNull();

        // 3. Must include Retry-After header
        expect(res.headers.get("Retry-After")).toBe("5");

        // 4. Must include friendly UI
        const html = await res.text();
        expect(html).toContain("We can't reach the service right now");
        expect(html).toContain("Retry");

        // 5. Must log exactly 'auth service unreachable' with no token leakage
        expect(consoleErrorSpy).toHaveBeenCalledWith("auth service unreachable");
        consoleErrorSpy.mockRestore();
      }
    );

    it("never clears or overwrites session cookies on timeout", async () => {
      (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = true;
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = createMockRequest("/orders");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      // Ensure Set-Cookie header is not set to empty/expired
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeNull();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Public pages during auth timeout", () => {
    it.each(["/login", "/signup", "/forgot-password", "/offline"])(
      "renders public page %s immediately without blocking on timeout",
      async (publicPath) => {
        (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = true;
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const req = createMockRequest(publicPath);
        const res = await proxy(req);

        // Public page must be allowed to render (200 / passthrough)
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();

        consoleErrorSpy.mockRestore();
      }
    );
  });

  describe("API routes during auth timeout", () => {
    it("returns HTTP 503 JSON with Retry-After for API requests", async () => {
      (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = true;
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = createMockRequest("/api/orders/test");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("5");
      const data = await res.json();
      expect(data.code).toBe("SERVICE_UNAVAILABLE");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Prefetch requests and transient auth error classification", () => {
    it("(d) a request with a spoofed prefetch header still goes through the full proxy checks", async () => {
      // Unauthenticated visitor with spoofed prefetch header on protected route
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const req = createMockRequest("/orders");
      // Empty cookies for unauthenticated visitor
      (req as unknown as { cookies: { getAll: () => unknown[] } }).cookies = {
        getAll: () => [],
      };
      (req.headers as Headers).set("next-router-prefetch", "1");
      (req.headers as Headers).set("purpose", "prefetch");

      const res = await proxy(req);

      // Must NOT bypass — must enforce full login redirect check
      expect(mockGetUser).toHaveBeenCalled();
      expect(res.headers.get("location")).toBe("https://example.com/login");
    });

    it("returns 503 and NEVER redirects to /login on transient 500 error when session cookie is present", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { status: 500, message: "Database connection failed" },
      });

      const req = createMockRequest("/orders");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
    });

    it("returns 503 and NEVER redirects to /login on rate limit (429) when session cookie is present", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { status: 429, message: "Too many requests" },
      });

      const req = createMockRequest("/orders");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
    });
  });
});
