import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/navigation
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Supabase mock helpers
const mockSignUp = vi.fn();
const mockRpc = vi.fn();
const mockResend = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      resend: (...args: unknown[]) => mockResend(...args),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

// Mock requireRole
vi.mock("@/server/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({
    id: "admin-id-1",
    role: "admin",
    is_active: true,
  }),
}));

import { signupAction, resendConfirmationAction } from "@/server/actions/auth";
import {
  adminAddAllowedDomainAction,
  adminRemoveAllowedDomainAction,
  adminListAllowedDomainsAction,
} from "@/server/actions/admin-domains";

describe("Signup Hardening: Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signupAction() Input Hardening & Domain Pre-check", () => {
    it("rejects plus-addressing (+) in student email addresses", async () => {
      const formData = new FormData();
      formData.set("fullName", "Test Student");
      formData.set("collegeId", "STU1001");
      formData.set("email", "student+alias@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);
      expect(result.fieldErrors?.email).toContain(
        "Plus-addressing (+) is not permitted for registration."
      );
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("rejects invalid college_id special characters", async () => {
      const formData = new FormData();
      formData.set("fullName", "Test Student");
      formData.set("collegeId", "STU#1001!");
      formData.set("email", "student@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);
      expect(result.fieldErrors?.collegeId).toContain(
        "College ID can only contain letters, digits, and - _ . /"
      );
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("rejects college_id shorter than 3 or longer than 30 characters", async () => {
      const formData = new FormData();
      formData.set("fullName", "Test Student");
      formData.set("collegeId", "AB");
      formData.set("email", "student@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);
      expect(result.fieldErrors?.collegeId).toContain(
        "College ID must be at least 3 characters."
      );

      formData.set("collegeId", "A".repeat(31));
      const result2 = await signupAction({}, formData);
      expect(result2.fieldErrors?.collegeId).toContain(
        "College ID must be 30 characters or fewer."
      );
    });

    it("rejects full_name longer than 80 characters", async () => {
      const formData = new FormData();
      formData.set("fullName", "A".repeat(81));
      formData.set("collegeId", "STU1001");
      formData.set("email", "student@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);
      expect(result.fieldErrors?.fullName).toContain(
        "Full name must be 80 characters or fewer."
      );
    });

    it("blocks signup when is_signup_email_allowed RPC returns false", async () => {
      mockRpc.mockResolvedValue({ data: false, error: null });

      const formData = new FormData();
      formData.set("fullName", "Intruder");
      formData.set("collegeId", "STU1001");
      formData.set("email", "intruder@evil.com");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);

      expect(mockRpc).toHaveBeenCalledWith("is_signup_email_allowed", {
        p_email: "intruder@evil.com",
      });
      expect(result.error).toBe(
        "This email address can't be used to register. Please use an approved email address."
      );
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("fails open to trigger if is_signup_email_allowed RPC throws error", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "RPC error" } });
      mockSignUp.mockResolvedValue({
        data: { user: { id: "u-1" }, session: null },
        error: null,
      });

      const formData = new FormData();
      formData.set("fullName", "Alice Campus");
      formData.set("collegeId", "stu1001");
      formData.set("email", "alice@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);

      expect(mockSignUp).toHaveBeenCalledWith({
        email: "alice@campus.edu",
        password: "validpassword123",
        options: {
          data: {
            full_name: "Alice Campus",
            college_id: "STU1001", // normalized to uppercase
          },
        },
      });
      expect(result.needsConfirmation).toBe(true);
      expect(result.email).toBe("alice@campus.edu");
    });

    it("returns needsConfirmation:true when user is returned with null session", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });
      mockSignUp.mockResolvedValue({
        data: { user: { id: "u-2" }, session: null },
        error: null,
      });

      const formData = new FormData();
      formData.set("fullName", "Bob Campus");
      formData.set("collegeId", "STU1002");
      formData.set("email", "bob@campus.edu");
      formData.set("password", "validpassword123");

      const result = await signupAction({}, formData);
      expect(result.needsConfirmation).toBe(true);
      expect(result.email).toBe("bob@campus.edu");
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("redirects to '/' when session is returned immediately", async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });
      mockSignUp.mockResolvedValue({
        data: { user: { id: "u-3" }, session: { access_token: "tok" } },
        error: null,
      });

      const formData = new FormData();
      formData.set("fullName", "Charlie Campus");
      formData.set("collegeId", "STU1003");
      formData.set("email", "charlie@campus.edu");
      formData.set("password", "validpassword123");

      await expect(signupAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockRedirect).toHaveBeenCalledWith("/");
    });
  });

  describe("resendConfirmationAction()", () => {
    it("returns success with generic message to avoid email enumeration", async () => {
      mockResend.mockResolvedValue({ error: null });

      const res = await resendConfirmationAction("student@campus.edu");
      expect(res.success).toBe(true);
      expect(res.message).toContain("If an unverified account exists");
      expect(mockResend).toHaveBeenCalledWith({
        type: "signup",
        email: "student@campus.edu",
      });
    });

    it("rejects invalid email formats gracefully", async () => {
      const res = await resendConfirmationAction("notanemail");
      expect(res.success).toBe(false);
      expect(res.message).toBe("Invalid email address.");
      expect(mockResend).not.toHaveBeenCalled();
    });
  });

  describe("Admin Allowed Domains Actions", () => {
    it("adminListAllowedDomainsAction loads allowed domains via RPC", async () => {
      mockRpc.mockResolvedValue({
        data: [{ id: "1", domain: "campus.edu", created_at: "2026-01-01" }],
        error: null,
      });

      const res = await adminListAllowedDomainsAction();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toHaveLength(1);
        expect(res.data[0].domain).toBe("campus.edu");
      }
    });

    it("adminAddAllowedDomainAction validates domain format", async () => {
      const res = await adminAddAllowedDomainAction("not a domain!");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toBe("Invalid domain name format");
      }
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("adminAddAllowedDomainAction warns when adding consumer freemail without confirm", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "FREEMAIL_CONFIRMATION_REQUIRED: gmail.com is a public consumer email provider" },
      });

      const res = await adminAddAllowedDomainAction("gmail.com", false);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.isFreemailWarning).toBe(true);
        expect(res.error).toContain("is a public consumer email provider");
      }
    });

    it("adminAddAllowedDomainAction warns when adding public suffix without confirm", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "PUBLIC_SUFFIX_CONFIRMATION_REQUIRED: ac.in is a public top-level or second-level suffix" },
      });

      const res = await adminAddAllowedDomainAction("ac.in", false);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.isFreemailWarning).toBe(true);
        expect(res.error).toContain("is a public top-level or second-level suffix");
      }
    });

    it("adminAddAllowedDomainAction succeeds with confirmFreemail=true", async () => {
      mockRpc.mockResolvedValue({
        data: { id: "d-1", domain: "gmail.com", changed: true },
        error: null,
      });

      const res = await adminAddAllowedDomainAction("gmail.com", true);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.changed).toBe(true);
        expect(res.data.domain).toBe("gmail.com");
      }
    });

    it("adminRemoveAllowedDomainAction invokes RPC and revalidates path", async () => {
      mockRpc.mockResolvedValue({
        data: { domain: "campus.edu", changed: true },
        error: null,
      });

      const res = await adminRemoveAllowedDomainAction("campus.edu");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.changed).toBe(true);
      }
    });
  });
});
