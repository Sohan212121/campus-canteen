import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("SIGNUP_EMAIL_PLACEHOLDER constant", () => {
  const originalEnv = process.env.NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER = originalEnv;
  });

  it("defaults to you@gmail.com when NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER is unset", async () => {
    delete process.env.NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER;
    const { SIGNUP_EMAIL_PLACEHOLDER } = await import("@/lib/constants");
    expect(SIGNUP_EMAIL_PLACEHOLDER).toBe("you@gmail.com");
  });

  it("respects NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER environment variable when set", async () => {
    process.env.NEXT_PUBLIC_SIGNUP_EMAIL_PLACEHOLDER = "student@college.ac.in";
    const { SIGNUP_EMAIL_PLACEHOLDER } = await import("@/lib/constants");
    expect(SIGNUP_EMAIL_PLACEHOLDER).toBe("student@college.ac.in");
  });
});
