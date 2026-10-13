import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResetPasswordForEmail = vi.fn();
const mockUpdateUser = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
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
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import {
  forgotPasswordAction,
  setPasswordAction,
} from "@/server/actions/auth";
import { PASSWORD_RESET_COOKIE } from "@/lib/validation/auth-recovery";

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

    it("rejects passwords shorter than 8 characters", async () => {
      mockCookieGet.mockReturnValue({ value: "true" });

      const formData = new FormData();
      formData.set("password", "short");
      formData.set("confirmPassword", "short");

      const result = await setPasswordAction({}, formData);
      expect(result.fieldErrors?.password).toBeDefined();
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("rejects non-matching passwords", async () => {
      mockCookieGet.mockReturnValue({ value: "true" });

      const formData = new FormData();
      formData.set("password", "Password123!");
      formData.set("confirmPassword", "MismatchPassword123!");

      const result = await setPasswordAction({}, formData);
      expect(result.fieldErrors?.confirmPassword?.[0]).toBe(
        "Passwords do not match"
      );
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("updates password, signs out other sessions, deletes cookie, and redirects active student to /", async () => {
      mockCookieGet.mockReturnValue({ value: "true" });
      mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
      mockUpdateUser.mockResolvedValue({ error: null });
      mockSingle.mockResolvedValue({
        data: { role: "student", is_active: true },
      });

      const formData = new FormData();
      formData.set("password", "ValidNewPassword123!");
      formData.set("confirmPassword", "ValidNewPassword123!");

      await expect(setPasswordAction({}, formData)).rejects.toThrow(
        "NEXT_REDIRECT:/"
      );

      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: "ValidNewPassword123!",
      });
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      expect(mockCookieDelete).toHaveBeenCalledWith(PASSWORD_RESET_COOKIE);
      expect(mockRedirect).toHaveBeenCalledWith("/");
    });

    it("redirects inactive staff user to /auth/pending-activation", async () => {
      mockCookieGet.mockReturnValue({ value: "true" });
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

      expect(mockUpdateUser).toHaveBeenCalledWith({
        password: "ValidNewPassword123!",
      });
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
      expect(mockCookieDelete).toHaveBeenCalledWith(PASSWORD_RESET_COOKIE);
      expect(mockRedirect).toHaveBeenCalledWith("/auth/pending-activation");
    });
  });
});
