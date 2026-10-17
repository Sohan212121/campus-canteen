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

import { proxy } from "@/proxy";
import { ROLE_HOME } from "@/server/auth";

function createMockRequest(
  pathname: string,
  options?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  const url = new URL(`https://example.com${pathname}`);
  const headers = new Headers(options?.headers);
  return {
    method: options?.method ?? "GET",
    headers,
    nextUrl: {
      pathname,
      clone: () => new URL(url.toString()),
    },
    cookies: {
      getAll: () => [],
      set: vi.fn(),
    },
  } as unknown as NextRequest;
}

function mockProfile(profile: { role: string; is_active: boolean } | null) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: profile,
      error: profile ? null : { message: "not found" },
    }),
  });
}

describe("proxy (UX redirects & loop invariants)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
  });

  describe("Server Action and non-GET bypass (page routes only)", () => {
    it("passes Server Action requests through without redirecting", async () => {
      const req = createMockRequest("/admin", {
        method: "POST",
        headers: { "next-action": "some-action-id" },
      });
      const res = await proxy(req);
      expect(res.headers.get("location")).toBeNull();
      // Should not query profiles
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("passes non-GET mutation requests through without redirecting", async () => {
      const req = createMockRequest("/orders", { method: "POST" });
      const res = await proxy(req);
      expect(res.headers.get("location")).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe("bypass routes (never redirected)", () => {
    it.each([
      "/api/health",
      "/auth/deactivated",
      "/auth/callback",
      "/auth/confirm",
    ])("passes %s through without auth redirection", async (path) => {
      const req = createMockRequest(path);
      const res = await proxy(req);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  describe("unauthenticated visitors", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
    });

    it.each(["/login", "/signup", "/forgot-password", "/auth/confirm"])(
      "allows unauthenticated visitor on %s without redirect",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBeNull();
      }
    );

    it("redirects unauthenticated visitor on / to /login", async () => {
      const req = createMockRequest("/");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/login");
    });

    it("redirects unauthenticated visitor on /staff to /login", async () => {
      const req = createMockRequest("/staff");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/login");
    });

    it("redirects unauthenticated visitor on /admin to /login", async () => {
      const req = createMockRequest("/admin");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/login");
    });

    it("returns 401 JSON for unauthenticated visitor on /api/* routes", async () => {
      const req = createMockRequest("/api/orders/some-id/pickup-code");
      const res = await proxy(req);
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.json();
      expect(body).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
        error: "Authentication required",
      });
    });
  });

  describe("deactivated accounts", () => {
    it("redirects deactivated user to /auth/deactivated on regular routes", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "deact-user" } } });
      mockProfile({ role: "student", is_active: false });

      const req = createMockRequest("/menu");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/auth/deactivated");
    });

    it("returns 403 JSON for deactivated user on /api/* routes", async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "deact-user" } } });
      mockProfile({ role: "student", is_active: false });

      const req = createMockRequest("/api/orders/some-id/pickup-code");
      const res = await proxy(req);
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.json();
      expect(body).toEqual({
        ok: false,
        code: "FORBIDDEN",
        error: "Account is inactive",
      });
    });

    it.each(["/set-password", "/auth/pending-activation", "/auth/confirm"])(
      "exempts inactive user on %s without redirect to /auth/deactivated",
      async (path) => {
        mockGetUser.mockResolvedValue({ data: { user: { id: "inactive-user" } } });
        mockProfile({ role: "staff", is_active: false });

        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBeNull();
      }
    );
  });

  describe("signed-in visitors visiting /login or /signup", () => {
    it.each([
      ["student", ROLE_HOME.student],
      ["staff", ROLE_HOME.staff],
      ["admin", ROLE_HOME.admin],
    ])("redirects %s on /login to %s", async (role, expectedHome) => {
      mockGetUser.mockResolvedValue({ data: { user: { id: `user-${role}` } } });
      mockProfile({ role, is_active: true });

      const req = createMockRequest("/login");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe(`https://example.com${expectedHome}`);
    });
  });

  describe("student role navigation", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "student-1" } } });
      mockProfile({ role: "student", is_active: true });
    });

    it.each(["/", "/menu", "/cart", "/checkout", "/orders", "/profile", "/notifications"])(
      "allows student on %s without redirect (no loop)",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBeNull();
      }
    );

    it("redirects student away from /staff to /", async () => {
      const req = createMockRequest("/staff");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/");
    });

    it("redirects student away from /admin to /", async () => {
      const req = createMockRequest("/admin");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/");
    });
  });

  describe("staff role navigation", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
      mockProfile({ role: "staff", is_active: true });
    });

    it.each(["/staff", "/staff/pickup", "/staff/inventory"])(
      "allows staff on %s without redirect (no loop)",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBeNull();
      }
    );

    it.each(["/", "/menu", "/cart", "/checkout", "/orders", "/profile", "/notifications"])(
      "redirects staff away from student route %s to /staff",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBe("https://example.com/staff");
      }
    );

    it("redirects staff away from /admin to /staff", async () => {
      const req = createMockRequest("/admin");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/staff");
    });
  });

  describe("admin role navigation", () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
      mockProfile({ role: "admin", is_active: true });
    });

    it.each(["/admin", "/admin/menu", "/admin/orders", "/admin/users", "/admin/settings"])(
      "allows admin on %s without redirect (no loop)",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBeNull();
      }
    );

    it.each(["/", "/menu", "/cart", "/checkout", "/orders", "/profile", "/notifications"])(
      "redirects admin away from student route %s to /admin",
      async (path) => {
        const req = createMockRequest(path);
        const res = await proxy(req);
        expect(res.headers.get("location")).toBe("https://example.com/admin");
      }
    );

    it("redirects admin away from /staff to /admin", async () => {
      const req = createMockRequest("/staff");
      const res = await proxy(req);
      expect(res.headers.get("location")).toBe("https://example.com/admin");
    });
  });
});
