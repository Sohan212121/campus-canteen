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
const mockSignUp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  }),
}));

// Import modules under test AFTER mocks are registered
import { getCurrentUser, requireRole } from "@/server/auth";
import { signupAction } from "@/server/actions/auth";

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

  // =========================================================================
  // signupAction() validation
  // =========================================================================

  describe("signupAction() validation", () => {
    it("returns inline field errors when required fields are missing or invalid", async () => {
      const formData = new FormData();
      formData.set("fullName", "");
      formData.set("collegeId", "");
      formData.set("email", "invalid-email");
      formData.set("password", "short"); // < 8 characters

      const result = await signupAction({}, formData);

      expect(result.error).toBeUndefined();
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors?.fullName).toContain("Full name is required.");
      expect(result.fieldErrors?.collegeId).toContain("College ID is required.");
      expect(result.fieldErrors?.email).toContain("Please enter a valid email address.");
      expect(result.fieldErrors?.password).toContain("Password must be at least 8 characters.");
      // Ensure it never calls supabase or returns a login error
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("logs error and returns generic signup error when Supabase fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSignUp.mockResolvedValue({
        error: { message: "User already registered" },
      });

      const formData = new FormData();
      formData.set("fullName", "John Doe");
      formData.set("collegeId", "CS2024001");
      formData.set("email", "john@campus.edu");
      formData.set("password", "securepassword123");

      const result = await signupAction({}, formData);

      expect(result.error).toBe("Could not create account. Please try again.");
      expect(result.fieldErrors).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

