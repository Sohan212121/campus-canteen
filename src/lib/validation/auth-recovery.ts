import { z } from "zod";

/**
 * Allowed relative path destinations for post-authentication redirects.
 * Strictly prevents open-redirect attacks.
 */
export const ALLOWED_REDIRECT_PATHS = [
  "/",
  "/menu",
  "/cart",
  "/orders",
  "/profile",
  "/staff",
  "/admin",
  "/set-password",
  "/auth/pending-activation",
] as const;

/**
 * Validates and sanitizes a redirect target path.
 * Must be a relative path without protocols, double-slashes, or backslashes.
 */
export function validateRedirectPath(
  rawNext: string | null | undefined,
  defaultPath = "/"
): string {
  if (!rawNext) return defaultPath;

  const trimmed = rawNext.trim();

  // Reject anything containing a scheme/protocol, double-slashes, or backslashes
  if (
    trimmed.includes("://") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    !trimmed.startsWith("/")
  ) {
    return defaultPath;
  }

  // Ensure it matches one of the known safe application routes
  const isAllowed = ALLOWED_REDIRECT_PATHS.some(
    (allowed) =>
      trimmed === allowed ||
      trimmed.startsWith(`${allowed}/`) ||
      trimmed.startsWith(`${allowed}?`)
  );

  return isAllowed ? trimmed : defaultPath;
}

/** Zod schema for forgot password request */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Zod schema for set-password form */
export const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/** Cookie name used to authorize password setting */
export const PASSWORD_RESET_COOKIE = "sb-password-reset-allowed";
