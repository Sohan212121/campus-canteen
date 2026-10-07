import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock next/navigation
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    // redirect() in Next.js throws to halt execution; simulate this.
    throw new Error("NEXT_REDIRECT");
  },
}));

// Supabase mock helpers
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

// Import module under test AFTER mocks are registered
import { getCurrentUser, requireRole } from "@/server/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSupabaseProfile(profile: Record<string, unknown> | null) {
  // Supabase chain: supabase.from("profiles").select(...).eq(...).single()
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: profile,
      error: profile ? null : { message: "not found" },
    }),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("server/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // getCurrentUser()
  // =========================================================================

  describe("getCurrentUser()", () => {
    it("returns null when there is no authenticated user", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const result = await getCurrentUser();

      expect(result).toBeNull();
      // Should NOT query profiles when no user exists.
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns the profile when user is authenticated", async () => {
      const fakeUser = { id: "user-123" };
      const fakeProfile = {
        id: "user-123",
        full_name: "Test Student",
        college_id: "CS2024001",
        role: "student",
        canteen_id: null,
        is_active: true,
      };

      mockGetUser.mockResolvedValue({ data: { user: fakeUser } });
      mockSupabaseProfile(fakeProfile);

      const result = await getCurrentUser();

      expect(result).toEqual(fakeProfile);
    });

    it("returns null when user exists but profile is missing", async () => {
      const fakeUser = { id: "user-456" };
      mockGetUser.mockResolvedValue({ data: { user: fakeUser } });
      mockSupabaseProfile(null);

      const result = await getCurrentUser();

      expect(result).toBeNull();
    });

    it("calls auth.getUser() and never auth.getSession()", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await getCurrentUser();

      // auth.getUser() must have been called
      expect(mockGetUser).toHaveBeenCalledTimes(1);

      // Ensure there is no getSession call — we verify this by checking the mock
      // object does NOT contain getSession at all (it was never added to the mock).
      const { createReadOnlyClient } = await import("@/lib/supabase/server");
      const client = await createReadOnlyClient();
      expect(client.auth).not.toHaveProperty("getSession");
    });
  });

  // =========================================================================
  // requireRole()
  // =========================================================================

  describe("requireRole()", () => {
    it("redirects to /login when there is no user", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await expect(requireRole(["student"])).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("redirects to /auth/deactivated when user is inactive", async () => {
      const fakeUser = { id: "user-789" };
      const inactiveProfile = {
        id: "user-789",
        full_name: "Inactive User",
        college_id: null,
        role: "student",
        canteen_id: null,
        is_active: false,
      };

      mockGetUser.mockResolvedValue({ data: { user: fakeUser } });
      mockSupabaseProfile(inactiveProfile);

      await expect(requireRole(["student"])).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/auth/deactivated");
    });

    it("redirects to / when user's role is not in the allowed list", async () => {
      const fakeUser = { id: "user-abc" };
      const staffProfile = {
        id: "user-abc",
        full_name: "Staff Member",
        college_id: null,
        role: "staff",
        canteen_id: "canteen-1",
        is_active: true,
      };

      mockGetUser.mockResolvedValue({ data: { user: fakeUser } });
      mockSupabaseProfile(staffProfile);

      await expect(requireRole(["admin"])).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/");
    });

    it("returns the profile when user has an allowed role", async () => {
      const fakeUser = { id: "user-ok" };
      const adminProfile = {
        id: "user-ok",
        full_name: "Admin Boss",
        college_id: null,
        role: "admin",
        canteen_id: null,
        is_active: true,
      };

      mockGetUser.mockResolvedValue({ data: { user: fakeUser } });
      mockSupabaseProfile(adminProfile);

      const result = await requireRole(["admin", "staff"]);

      expect(result).toEqual(adminProfile);
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
