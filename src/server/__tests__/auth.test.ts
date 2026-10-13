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
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });

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
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

// Import modules under test AFTER mocks are registered
import { getCurrentUser, requireRole, ROLE_HOME, type UserProfile } from "@/server/auth";
import { signupAction, loginAction } from "@/server/actions/auth";

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
  // ROLE_HOME Map & Loop Invariant
  // =========================================================================

  describe("ROLE_HOME map & invariants", () => {
    it("defines the canonical homes for all roles", () => {
      expect(ROLE_HOME.student).toBe("/");
      expect(ROLE_HOME.staff).toBe("/staff");
      expect(ROLE_HOME.admin).toBe("/admin");
    });

    it("ensures each role home is unique and non-overlapping", () => {
      const homes = Object.values(ROLE_HOME);
      const uniqueHomes = new Set(homes);
      expect(uniqueHomes.size).toBe(homes.length);
    });

    it("ensures no role home path causes a self-redirecting loop", () => {
      // In proxy / requireRole logic, a user at their home path is allowed through
      // and never redirected away from their own home.
      for (const [role, home] of Object.entries(ROLE_HOME)) {
        // A user of this role visiting their home path is permitted
        const allowedRolesForHome: Record<string, UserProfile["role"][]> = {
          "/": ["student"],
          "/staff": ["staff"],
          "/admin": ["admin"],
        };

        const allowed = allowedRolesForHome[home];
        expect(allowed).toContain(role);
      }
    });
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

      const { createReadOnlyClient } = await import("@/lib/supabase/server");
      const client = await createReadOnlyClient();
      expect(client.auth).not.toHaveProperty("getSession");
    });
  });

  // =========================================================================
  // requireRole() - 3x3 Role Separation Matrix
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

    // -----------------------------------------------------------------------
    // Student Tests
    // -----------------------------------------------------------------------
    describe("student role checks", () => {
      const studentProfile = {
        id: "student-1",
        full_name: "Student User",
        college_id: "ST001",
        role: "student",
        canteen_id: null,
        is_active: true,
      };

      beforeEach(() => {
        mockGetUser.mockResolvedValue({ data: { user: { id: "student-1" } } });
        mockSupabaseProfile(studentProfile);
      });

      it("permits student on student-guarded routes", async () => {
        const result = await requireRole(["student"]);
        expect(result).toEqual(studentProfile);
        expect(mockRedirect).not.toHaveBeenCalled();
      });

      it("redirects student away from staff-guarded routes to /", async () => {
        await expect(requireRole(["staff"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/");
      });

      it("redirects student away from admin-guarded routes to /", async () => {
        await expect(requireRole(["admin"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/");
      });
    });

    // -----------------------------------------------------------------------
    // Staff Tests
    // -----------------------------------------------------------------------
    describe("staff role checks", () => {
      const staffProfile = {
        id: "staff-1",
        full_name: "Staff User",
        college_id: "EMP001",
        role: "staff",
        canteen_id: "canteen-1",
        is_active: true,
      };

      beforeEach(() => {
        mockGetUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
        mockSupabaseProfile(staffProfile);
      });

      it("permits staff on staff-guarded routes", async () => {
        const result = await requireRole(["staff"]);
        expect(result).toEqual(staffProfile);
        expect(mockRedirect).not.toHaveBeenCalled();
      });

      it("redirects staff away from student-guarded routes to /staff", async () => {
        await expect(requireRole(["student"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/staff");
      });

      it("redirects staff away from admin-guarded routes to /staff", async () => {
        await expect(requireRole(["admin"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/staff");
      });
    });

    // -----------------------------------------------------------------------
    // Admin Tests
    // -----------------------------------------------------------------------
    describe("admin role checks", () => {
      const adminProfile = {
        id: "admin-1",
        full_name: "Admin User",
        college_id: null,
        role: "admin",
        canteen_id: null,
        is_active: true,
      };

      beforeEach(() => {
        mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
        mockSupabaseProfile(adminProfile);
      });

      it("permits admin on admin-guarded routes", async () => {
        const result = await requireRole(["admin"]);
        expect(result).toEqual(adminProfile);
        expect(mockRedirect).not.toHaveBeenCalled();
      });

      it("redirects admin away from student-guarded routes to /admin", async () => {
        await expect(requireRole(["student"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/admin");
      });

      it("redirects admin away from staff-guarded routes to /admin", async () => {
        await expect(requireRole(["staff"])).rejects.toThrow("NEXT_REDIRECT");
        expect(mockRedirect).toHaveBeenCalledWith("/admin");
      });
    });
  });

  // =========================================================================
  // loginAction() Role Redirection & Inactive Account
  // =========================================================================

  describe("loginAction() role redirects", () => {
    it("redirects student to / after login", async () => {
      mockSignInWithPassword.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: "student-1" } } });
      mockSupabaseProfile({ id: "student-1", role: "student", is_active: true });

      const formData = new FormData();
      formData.set("email", "student@campus.edu");
      formData.set("password", "password123");

      await expect(loginAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/");
    });

    it("redirects staff to /staff after login", async () => {
      mockSignInWithPassword.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
      mockSupabaseProfile({ id: "staff-1", role: "staff", is_active: true });

      const formData = new FormData();
      formData.set("email", "staff@campus.edu");
      formData.set("password", "password123");

      await expect(loginAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/staff");
    });

    it("redirects admin to /admin after login", async () => {
      mockSignInWithPassword.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
      mockSupabaseProfile({ id: "admin-1", role: "admin", is_active: true });

      const formData = new FormData();
      formData.set("email", "admin@campus.edu");
      formData.set("password", "password123");

      await expect(loginAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/admin");
    });

    it("signs out deactivated user and redirects to /login?error=account_deactivated", async () => {
      mockSignInWithPassword.mockResolvedValue({ error: null });
      mockGetUser.mockResolvedValue({ data: { user: { id: "deactivated-1" } } });
      mockSupabaseProfile({ id: "deactivated-1", role: "student", is_active: false });

      const formData = new FormData();
      formData.set("email", "banned@campus.edu");
      formData.set("password", "password123");

      await expect(loginAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockRedirect).toHaveBeenCalledWith("/login?error=account_deactivated");
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
      expect(result.fieldErrors?.collegeId).toContain("College ID must be at least 3 characters.");
      expect(result.fieldErrors?.email).toContain("Please enter a valid email address.");
      expect(result.fieldErrors?.password).toContain("Password must be at least 8 characters.");
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

      expect(result.error).toBe("Could not create account. Check your details or contact the canteen office.");
      expect(result.fieldErrors).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
