import { describe, it, expect } from "vitest";
import {
  validateRedirectPath,
  forgotPasswordSchema,
  setPasswordSchema,
  ALLOWED_OTP_TYPES,
} from "@/lib/validation/auth-recovery";

describe("validateRedirectPath", () => {
  it("allows safe allowed paths", () => {
    expect(validateRedirectPath("/")).toBe("/");
    expect(validateRedirectPath("/set-password")).toBe("/set-password");
    expect(validateRedirectPath("/profile")).toBe("/profile");
    expect(validateRedirectPath("/staff")).toBe("/staff");
    expect(validateRedirectPath("/admin")).toBe("/admin");
    expect(validateRedirectPath("/auth/pending-activation")).toBe(
      "/auth/pending-activation"
    );
  });

  it("allows query parameters on safe paths", () => {
    expect(validateRedirectPath("/set-password?mode=invite")).toBe(
      "/set-password?mode=invite"
    );
  });

  it("falls back to defaultPath on empty or null input", () => {
    expect(validateRedirectPath(null)).toBe("/");
    expect(validateRedirectPath(undefined, "/set-password")).toBe(
      "/set-password"
    );
    expect(validateRedirectPath("")).toBe("/");
  });

  it("rejects absolute URLs with protocol", () => {
    expect(validateRedirectPath("https://evil.com")).toBe("/");
    expect(validateRedirectPath("http://evil.com/set-password")).toBe("/");
    expect(validateRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(validateRedirectPath("//evil.com")).toBe("/");
    expect(validateRedirectPath("//evil.com/set-password")).toBe("/");
  });

  it("rejects URLs containing backslashes", () => {
    expect(validateRedirectPath("/\\evil.com")).toBe("/");
    expect(validateRedirectPath("\\evil.com")).toBe("/");
  });

  it("rejects unknown path destinations not in the allowlist", () => {
    expect(validateRedirectPath("/some-unknown-path")).toBe("/");
    expect(validateRedirectPath("/malicious/route")).toBe("/");
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts valid email addresses", () => {
    const res = forgotPasswordSchema.safeParse({ email: "student@campus.edu" });
    expect(res.success).toBe(true);
  });

  it("rejects invalid emails", () => {
    const res = forgotPasswordSchema.safeParse({ email: "invalid-email" });
    expect(res.success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  it("accepts matching passwords of length >= 8", () => {
    const res = setPasswordSchema.safeParse({
      password: "StrongPassword123!",
      confirmPassword: "StrongPassword123!",
    });
    expect(res.success).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const res = setPasswordSchema.safeParse({
      password: "short",
      confirmPassword: "short",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toContain(
        "at least 8 characters"
      );
    }
  });

  it("rejects non-matching passwords", () => {
    const res = setPasswordSchema.safeParse({
      password: "Password123!",
      confirmPassword: "DifferentPassword123!",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].message).toBe("Passwords do not match");
    }
  });
});

describe("ALLOWED_OTP_TYPES", () => {
  it("contains all supported Supabase OTP verification types", () => {
    expect(ALLOWED_OTP_TYPES).toContain("recovery");
    expect(ALLOWED_OTP_TYPES).toContain("signup");
    expect(ALLOWED_OTP_TYPES).toContain("invite");
    expect(ALLOWED_OTP_TYPES).toContain("email");
    expect(ALLOWED_OTP_TYPES).toContain("magiclink");
    expect(ALLOWED_OTP_TYPES).toContain("email_change");
  });

  it("does not contain unauthorized arbitrary types", () => {
    expect(ALLOWED_OTP_TYPES).not.toContain("sms");
    expect(ALLOWED_OTP_TYPES).not.toContain("phone_change");
    expect(ALLOWED_OTP_TYPES).not.toContain("admin_override");
  });
});
