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
 * Allowed OTP verification types for email link flows.
 */
export const ALLOWED_OTP_TYPES = [
  "invite",
  "recovery",
  "signup",
  "email",
  "magiclink",
  "email_change",
] as const;

export type AllowedOtpType = (typeof ALLOWED_OTP_TYPES)[number];

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

/**
 * Decodes a JWT payload without external library dependencies.
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonString = Buffer.from(payloadBase64, "base64").toString("utf-8");
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

/**
 * Validates whether the session's authentication method reference (AMR)
 * contains a recovery, invite, or otp method completed within maxAgeSeconds (default: 600s).
 */
export function isRecentRecoveryOrInviteSession(
  claims: Record<string, unknown> | null | undefined,
  maxAgeSeconds = 600
): boolean {
  if (!claims) return false;

  const now = Math.floor(Date.now() / 1000);
  const amr = claims.amr;

  if (Array.isArray(amr)) {
    for (const entry of amr) {
      if (typeof entry === "object" && entry !== null) {
        const method = (entry as { method?: string }).method;
        const timestamp = (entry as { timestamp?: number }).timestamp;
        const isAllowedMethod =
          method === "recovery" || method === "invite" || method === "otp";

        if (isAllowedMethod) {
          if (typeof timestamp === "number") {
            if (now - timestamp <= maxAgeSeconds && timestamp <= now + 60) {
              return true;
            }
          } else {
            const iat = typeof claims.iat === "number" ? claims.iat : 0;
            if (iat && now - iat <= maxAgeSeconds && iat <= now + 60) {
              return true;
            }
          }
        }
      } else if (typeof entry === "string") {
        const isAllowedMethod =
          entry === "recovery" || entry === "invite" || entry === "otp";
        if (isAllowedMethod) {
          const iat = typeof claims.iat === "number" ? claims.iat : 0;
          if (iat && now - iat <= maxAgeSeconds && iat <= now + 60) {
            return true;
          }
        }
      }
    }
  }

  return false;
}
