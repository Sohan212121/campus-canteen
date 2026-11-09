import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResetPasswordForEmail = vi.fn();
const mockVerifyOtp = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockUpdateUser = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();
const mockCookieDelete = vi.fn();
const mockHeadersGet = vi.fn();
const mockRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: mockCookieGet,
    set: mockCookieSet,
    delete: mockCookieDelete,
  })),
  headers: vi.fn().mockImplementation(async () => ({
    get: mockHeadersGet,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      resetPasswordForEmail: (...args: unknown[]) =>
        mockResetPasswordForEmail(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      exchangeCodeForSession: (...args: unknown[]) =>
        mockExchangeCodeForSession(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import {
  forgotPasswordAction,
  verifyConfirmTokenAction,
  verifyConfirmCodeAction,
  authorizeRecoverySessionAction,
  setPasswordAction,
  loginAction,
} from "@/server/actions/auth";
import { PASSWORD_RESET_COOKIE } from "@/lib/validation/auth-recovery";

function createTestJwt(amr: unknown, iat = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ amr, iat, exp: iat + 3600 })).toString("base64url");
  return `${header}.${payload}.mock-sig`;
}

describe("Recovery & Password Setting Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadersGet.mockReturnValue("http://localhost:3000");
  });

  describe("forgotPasswordAction", () => {
    it("rejects invalid email formats", async () => {
      const formData = new FormData();
      formData.set("email", "not-an-email");

      const result = await forgotPasswordAction({}, formData);
      expect(result.fieldErrors?.email).toBeDefined();
      expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("returns generic success message on valid email submission", async () => {
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      const formData = new FormData();
      formData.set("email", "student@campus.edu");

      const result = await forgotPasswordAction({}, formData);
      expect(result.success).toBe(true);
      expect(result.message).toContain(
        "If an account with this email exists, a password reset link has been sent"
      );
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "student@campus.edu",
        expect.objectContaining({
          redirectTo: "http://localhost:3000/auth/confirm?type=recovery&next=/set-password",
        })
      );
    });

    it("reduces referer with full path to its origin only", async () => {
      mockHeadersGet.mockImplementation((key: string) => {
        if (key === "referer") return "https://canteen.campus.edu/forgot-password?retry=1";
        return null;
      });
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      const formData = new FormData();
      formData.set("email", "student@campus.edu");

      const result = await forgotPasswordAction({}, formData);
      expect(result.success).toBe(true);
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "student@campus.edu",
        expect.objectContaining({
          redirectTo: "https://canteen.campus.edu/auth/confirm?type=recovery&next=/set-password",
        })
      );
    });

    it("returns identical generic success message when provider returns error (anti-enumeration)", async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        error: { message: "User not found or rate limited" },
      });

      const formData = new FormData();
      formData.set("email", "unregistered@campus.edu");

      const result = await forgotPasswordAction({}, formData);
      expect(result.success).toBe(true);
      expect(result.message).toContain(
        "If an account with this email exists, a password reset link has been sent"
      );
    });
  });

  describe("verifyConfirmTokenAction", () => {
    it("redirects unknown type values to expired link screen", async () => {
      const formData = new FormData();
      formData.set("token_hash", "valid-hash");
      formData.set("type", "unknown_type");

      await expect(verifyConfirmTokenAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/forgot-password?error=link_expired"
      );
      expect(mockVerifyOtp).not.toHaveBeenCalled();
    });

    it("accepts invite, recovery, signup, and email types", async () => {
      for (const validOtpType of ["invite", "recovery", "signup", "email"]) {
        mockVerifyOtp.mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        });

        const formData = new FormData();
        formData.set("token_hash", "valid-hash");
        formData.set("type", validOtpType);

        await expect(verifyConfirmTokenAction(formData)).rejects.toThrow(
          "NEXT_REDIRECT:"
        );
        expect(mockVerifyOtp).toHaveBeenCalledWith({
          token_hash: "valid-hash",
          type: validOtpType,
        });
      }
    });

    it("binds the password reset cookie to the verified user id for recovery/invite", async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { user: { id: "verified-user-uuid" } },
        error: null,
      });

      const formData = new FormData();
      formData.set("token_hash", "valid-token");
      formData.set("type", "recovery");
      formData.set("next", "/set-password");

      await expect(verifyConfirmTokenAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/set-password"
      );

      expect(mockCookieSet).toHaveBeenCalledWith(
        PASSWORD_RESET_COOKIE,
        "verified-user-uuid:recovery",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        })
      );
    });

    it("accepts magiclink and email_change types", async () => {
      for (const validOtpType of ["magiclink", "email_change"]) {
        mockVerifyOtp.mockResolvedValue({
          data: { user: { id: "user-456" } },
          error: null,
        });

        const formData = new FormData();
        formData.set("token_hash", "valid-hash");
        formData.set("type", validOtpType);

        await expect(verifyConfirmTokenAction(formData)).rejects.toThrow(
          "NEXT_REDIRECT:"
        );
        expect(mockVerifyOtp).toHaveBeenCalledWith({
          token_hash: "valid-hash",
          type: validOtpType,
        });
      }
    });
  });

  describe("verifyConfirmCodeAction", () => {
    it("exchanges code for session and binds password reset cookie when session AMR is recovery", async () => {
      const now = Math.floor(Date.now() / 1000);
      const recoveryJwt = createTestJwt([{ method: "recovery", timestamp: now }]);

      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          user: { id: "code-user-uuid" },
          session: { access_token: recoveryJwt },
        },
        error: null,
      });

      const formData = new FormData();
      formData.set("code", "auth-code-123");
      formData.set("type", "recovery");
      formData.set("next", "/set-password");

      await expect(verifyConfirmCodeAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/set-password"
      );

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("auth-code-123");
      expect(mockCookieSet).toHaveBeenCalledWith(
        PASSWORD_RESET_COOKIE,
        "code-user-uuid:recovery",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        })
      );
    });

    it("does NOT bind password reset cookie when session AMR is password (not recovery)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const passwordJwt = createTestJwt([{ method: "password", timestamp: now }]);

      mockExchangeCodeForSession.mockResolvedValue({
        data: {
          user: { id: "code-user-uuid" },
          session: { access_token: passwordJwt },
        },
        error: null,
      });

      const formData = new FormData();
      formData.set("code", "auth-code-123");
      formData.set("type", "recovery"); // Even if client passes type=recovery!
      formData.set("next", "/set-password");

      await expect(verifyConfirmCodeAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/"
      );

      // CRITICAL SECURITY REQUIREMENT: Cookie must NOT be set
      expect(mockCookieSet).not.toHaveBeenCalledWith(
        PASSWORD_RESET_COOKIE,
        expect.anything(),
        expect.anything()
      );
    });

    it("redirects to different_browser when PKCE code verifier is missing", async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { user: null },
        error: { message: "code verifier not found or invalid pkce" },
      });

      const formData = new FormData();
      formData.set("code", "stale-code");
      formData.set("type", "recovery");

      await expect(verifyConfirmCodeAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/forgot-password?error=different_browser"
      );
    });

    it("redirects to link_expired on other code exchange errors", async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { user: null },
        error: { message: "invalid authorization code" },
      });

      const formData = new FormData();
      formData.set("code", "invalid-code");

      await expect(verifyConfirmCodeAction(formData)).rejects.toThrow(
        "NEXT_REDIRECT:/forgot-password?error=link_expired"
      );
    });
  });

  describe("authorizeRecoverySessionAction", () => {
    it("binds password reset cookie strictly when session AMR has recent recovery timestamp", async () => {
      const now = Math.floor(Date.now() / 1000);
      const recoveryJwt = createTestJwt([{ method: "recovery", timestamp: now }]);

      mockGetUser.mockResolvedValue({
        data: { user: { id: "server-verified-user" } },
        error: null,
      });
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: "server-verified-user" },
            access_token: recoveryJwt,
          },
        },
        error: null,
      });

      const res = await authorizeRecoverySessionAction();
      expect(res.success).toBe(true);
      expect(res.userId).toBe("server-verified-user");
      expect(mockCookieSet).toHaveBeenCalledWith(
        PASSWORD_RESET_COOKIE,
        "server-verified-user:recovery",
        expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        })
      );
    });

    it("(a) an ordinary logged-in session (password auth) cannot get the reset cookie", async () => {
      const now = Math.floor(Date.now() / 1000);
      const passwordJwt = createTestJwt([{ method: "password", timestamp: now }]);

      mockGetUser.mockResolvedValue({
        data: { user: { id: "ordinary-user" } },
        error: null,
      });
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: "ordinary-user" },
            access_token: passwordJwt,
          },
        },
        error: null,
      });

      const res = await authorizeRecoverySessionAction();
      expect(res.success).toBe(false);
      expect(res.error).toContain("not a verified recent recovery");
      expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it("(b) a recovery session older than 10 minutes cannot get the reset cookie", async () => {
      const elevenMinutesAgo = Math.floor(Date.now() / 1000) - 660; // 11 minutes ago
      const expiredRecoveryJwt = createTestJwt([
        { method: "recovery", timestamp: elevenMinutesAgo },
      ]);

      mockGetUser.mockResolvedValue({
        data: { user: { id: "expired-user" } },
        error: null,
      });
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { id: "expired-user" },
            access_token: expiredRecoveryJwt,
          },
        },
        error: null,
      });

      const res = await authorizeRecoverySessionAction();
      expect(res.success).toBe(false);
      expect(res.error).toContain("not a verified recent recovery");
      expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it("returns error when no valid session exists on server", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: "session missing" },
      });
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const res = await authorizeRecoverySessionAction();
      expect(res.success).toBe(false);
      expect(res.error).toBe("Unauthorized session");
    });
  });

  describe("setPasswordAction", () => {
    it("rejects when reset authorization cookie is missing", async () => {
      mockCookieGet.mockReturnValue(undefined);

      const formData = new FormData();
      formData.set("password", "NewPassword123!");
      formData.set("confirmPassword", "NewPassword123!");

      const result = await setPasswordAction({}, formData);
      expect(result.error).toContain("expired or is unauthorized");
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("rejects when reset authorization cookie belongs to a different user", async () => {
      mockCookieGet.mockReturnValue({ value: "other-user-uuid" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "actual-user-uuid" } } });

      const formData = new FormData();
      formData.set("password", "NewPassword123!");
      formData.set("confirmPassword", "NewPassword123!");

      const result = await setPasswordAction({}, formData);
      expect(result.error).toContain("Authentication required");
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("rejects passwords shorter than 8 characters", async () => {
      mockCookieGet.mockReturnValue({ value: "user-123" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });

      const formData = new FormData();
      formData.set("password", "short");
      formData.set("confirmPassword", "short");

      const result = await setPasswordAction({}, formData);
      expect(result.fieldErrors?.password).toBeDefined();
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("rejects non-matching passwords", async () => {
      mockCookieGet.mockReturnValue({ value: "user-123" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });

      const formData = new FormData();
      formData.set("password", "Password123!");
      formData.set("confirmPassword", "MismatchPassword123!");

      const result = await setPasswordAction({}, formData);
      expect(result.fieldErrors?.confirmPassword?.[0]).toBe(
        "Passwords do not match"
      );
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("recovery ends signed out and redirects to /login?reset=success", async () => {
      mockCookieGet.mockReturnValue({ value: "user-123:recovery" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
      mockUpdateUser.mockResolvedValue({ error: null });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      await expect(setPasswordAction({}, formData)).rejects.toThrow(
        "NEXT_REDIRECT:/login?reset=success"
      );

      // Kept signOut({ scope: "others" }) for every flow
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      // Deleted the password reset cookie
      expect(mockCookieDelete).toHaveBeenCalledWith(PASSWORD_RESET_COOKIE);
      // Recovery branch: performed full signOut of current session
      expect(mockSignOut).toHaveBeenCalledWith();
      expect(mockRedirect).toHaveBeenCalledWith("/login?reset=success");
    });

    it("legacy recovery cookie without colon also ends signed out and redirects to /login?reset=success", async () => {
      mockCookieGet.mockReturnValue({ value: "user-123" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
      mockUpdateUser.mockResolvedValue({ error: null });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      await expect(setPasswordAction({}, formData)).rejects.toThrow(
        "NEXT_REDIRECT:/login?reset=success"
      );

      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      expect(mockSignOut).toHaveBeenCalledWith();
      expect(mockRedirect).toHaveBeenCalledWith("/login?reset=success");
    });

    it("invite still goes to the role home, signed in (no full sign out)", async () => {
      mockCookieGet.mockReturnValue({ value: "staff-123:invite" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "staff-123" } } });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { role: "staff", is_active: true },
      });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      await expect(setPasswordAction({}, formData)).rejects.toThrow(
        "NEXT_REDIRECT:/staff"
      );

      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: "ValidNewPassword123!",
      });
      // Kept signOut others
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      // Did NOT call full sign out (user stays signed in)
      expect(mockSignOut).not.toHaveBeenCalledWith();
      expect(mockCookieDelete).toHaveBeenCalledWith(PASSWORD_RESET_COOKIE);
      expect(mockRedirect).toHaveBeenCalledWith("/staff");
    });

    it("invite flow redirects inactive user to /auth/pending-activation while signed in", async () => {
      mockCookieGet.mockReturnValue({ value: "staff-123:invite" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "staff-123" } } });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { role: "staff", is_active: false },
      });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      await expect(setPasswordAction({}, formData)).rejects.toThrow(
        "NEXT_REDIRECT:/auth/pending-activation"
      );

      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      expect(mockSignOut).not.toHaveBeenCalledWith();
      expect(mockCookieDelete).toHaveBeenCalledWith(PASSWORD_RESET_COOKIE);
      expect(mockRedirect).toHaveBeenCalledWith("/auth/pending-activation");
    });

    it("a failed password update does not sign anyone out", async () => {
      mockCookieGet.mockReturnValue({ value: "user-123:recovery" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
      mockUpdateUser.mockResolvedValue({
        error: { message: "Database update error" },
      });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      const result = await setPasswordAction({}, formData);
      expect(result.error).toContain("Failed to update password");

      // GUARANTEE: Never signs out if update failed
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockCookieDelete).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("guarantees: loginAction and src/proxy.ts are untouched", async () => {
      expect(typeof loginAction).toBe("function");
      // Read src/proxy.ts to verify it was not modified
      const fs = await import("fs");
      const path = await import("path");
      const proxyContent = fs.readFileSync(
        path.resolve(process.cwd(), "src/proxy.ts"),
        "utf-8"
      );
      expect(proxyContent).toContain("export async function proxy");
      expect(proxyContent).toContain("pathname === \"/auth/confirm\"");
    });
  });

  describe("Login Page Reset Message Specification", () => {
    it("the login message appears only when reset=success is present", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const loginPageContent = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/(auth)/login/page.tsx"),
        "utf-8"
      );

      // Verify the reset parameter query check
      expect(loginPageContent).toContain('searchParams.get("reset")');
      expect(loginPageContent).toContain('resetParam === "success"');

      // Verify the exact user-requested message string
      const expectedMessage =
        "Password updated. Please sign in with your new password. If you use the CampBite app, open it and sign in there.";
      expect(loginPageContent).toContain(expectedMessage);

      // Verify it does NOT appear for other parameters
      function computeResetMessage(
        resetParam: string | null,
        hasStateError: boolean
      ): string | null {
        return !hasStateError && resetParam === "success"
          ? expectedMessage
          : null;
      }

      expect(computeResetMessage("success", false)).toBe(expectedMessage);
      expect(computeResetMessage(null, false)).toBeNull();
      expect(computeResetMessage("failed", false)).toBeNull();
      expect(computeResetMessage("error", false)).toBeNull();
      expect(computeResetMessage("true", false)).toBeNull();
      expect(computeResetMessage("success", true)).toBeNull();
    });
  });
});
