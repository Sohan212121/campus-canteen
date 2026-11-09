"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import * as z from "zod";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { logSupabaseError } from "@/lib/supabase-error";
import { ROLE_HOME, type UserRole } from "@/server/auth";
import {
  forgotPasswordSchema,
  setPasswordSchema,
  validateRedirectPath,
  PASSWORD_RESET_COOKIE,
  ALLOWED_OTP_TYPES,
  parseJwtPayload,
  isRecentRecoveryOrInviteSession,
} from "@/lib/validation/auth-recovery";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters."),
});

const collegeIdRegex = /^[A-Za-z0-9_./-]{3,30}$/;

const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(80, "Full name must be 80 characters or fewer."),
  collegeId: z
    .string()
    .trim()
    .min(3, "College ID must be at least 3 characters.")
    .max(30, "College ID must be 30 characters or fewer.")
    .refine(
      (val) => collegeIdRegex.test(val),
      "College ID can only contain letters, digits, and - _ . /"
    ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address.")
    .refine((val) => !val.split("@")[0]?.includes("+"), {
      message: "Plus-addressing (+) is not permitted for registration.",
    }),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters."),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  needsConfirmation?: boolean;
  email?: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// Login Server Action
// ---------------------------------------------------------------------------

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Generic error message — never leak whether the email exists.
    return { error: "Invalid email or password" };
  }

  // After successful sign-in, verify the user's account is active.
  // The role comes from public.profiles, never from JWT claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active, role")
      .eq("id", user.id)
      .single();

    if (!profile?.is_active) {
      // Account is deactivated — sign them out immediately.
      await supabase.auth.signOut();
      redirect("/login?error=account_deactivated");
    }

    if (profile?.role && profile.role in ROLE_HOME) {
      redirect(ROLE_HOME[profile.role as UserRole]);
    }
  }

  redirect("/");
}

// ---------------------------------------------------------------------------
// Signup Server Action
// ---------------------------------------------------------------------------

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const raw = {
    fullName: formData.get("fullName"),
    collegeId: formData.get("collegeId"),
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  // 1. Friendly pre-check: verify domain allowed using public RPC.
  // Fails OPEN if RPC fails so trigger remains final authority.
  try {
    const { data: isAllowed, error: rpcError } = await supabase.rpc(
      "is_signup_email_allowed",
      { p_email: parsed.data.email }
    );
    if (!rpcError && isAllowed === false) {
      return {
        error: "This email address can't be used to register. Please use an approved email address.",
      };
    }
  } catch (err) {
    // Fail open on RPC glitch; DB trigger will enforce domain on signUp.
    console.warn("is_signup_email_allowed RPC check failed, failing open to trigger:", err);
  }

  // 2. Call Supabase auth.signUp with uppercase college_id and sanitized full_name
  const normalizedCollegeId = parsed.data.collegeId.toUpperCase();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        college_id: normalizedCollegeId,
      },
    },
  });

  if (error) {
    logSupabaseError("auth:signup", error);
    const rawMsg = error.message || "";

    if (rawMsg.includes("DOMAIN_NOT_ALLOWED")) {
      return {
        error: "This email address can't be used to register. Please use an approved email address.",
      };
    }

    // Generic error — no enumeration oracle
    return {
      error: "Could not create account. Check your details or contact the canteen office.",
    };
  }

  // 3. Email confirmation flow:
  // If email confirmation is required, Supabase returns a user but no session.
  if (!data?.session) {
    return {
      success: true,
      needsConfirmation: true,
      email: parsed.data.email,
    };
  }

  redirect("/");
}

// ---------------------------------------------------------------------------
// Resend Confirmation Action
// ---------------------------------------------------------------------------

export async function resendConfirmationAction(
  email: string
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, message: "Invalid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: cleanEmail,
  });

  if (error) {
    logSupabaseError("auth:resendConfirmation", error);
  }

  // Generic message — avoid user enumeration
  return {
    success: true,
    message: "If an unverified account exists for this email, a new confirmation link has been sent.",
  };
}

// ---------------------------------------------------------------------------
// Sign Out Server Action
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Forgot Password Server Action
// ---------------------------------------------------------------------------

export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const raw = {
    email: formData.get("email"),
  };

  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const headersList = await headers();
  const rawReferer = headersList.get("referer");
  let refererOrigin: string | null = null;
  if (rawReferer) {
    try {
      refererOrigin = new URL(rawReferer).origin;
    } catch {
      refererOrigin = null;
    }
  }

  const origin =
    headersList.get("origin") ||
    refererOrigin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        redirectTo: `${origin}/auth/confirm?type=recovery&next=/set-password`,
      }
    );
    if (error) {
      logSupabaseError("forgotPasswordAction:provider", error);
    }
  } catch (err) {
    console.error("[forgotPasswordAction] Unexpected exception:", err);
  }

  // Consistent message for every outcome including rate-limit errors
  return {
    success: true,
    message:
      "If an account with this email exists, a password reset link has been sent. Please check your inbox and spam folder.",
  };
}

// ---------------------------------------------------------------------------
// Confirm Token Server Action (Email-Scanner Safe POST Verification)
// ---------------------------------------------------------------------------

export async function verifyConfirmTokenAction(
  formData: FormData
): Promise<never> {
  const token_hash = formData.get("token_hash")?.toString();
  const rawType = formData.get("type")?.toString();
  const rawNext = formData.get("next")?.toString();

  // Validate presence and allowlist: unknown types redirect to expired-link screen
  if (
    !token_hash ||
    !rawType ||
    !ALLOWED_OTP_TYPES.includes(rawType as (typeof ALLOWED_OTP_TYPES)[number])
  ) {
    redirect("/forgot-password?error=link_expired");
  }

  const type = rawType as EmailOtpType;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash,
    type,
  });

  if (error || !data?.user) {
    logSupabaseError("verifyConfirmTokenAction:otp", error);
    redirect("/forgot-password?error=link_expired");
  }

  const defaultNext =
    type === "recovery" || type === "invite" ? "/set-password" : "/";
  const next = validateRedirectPath(rawNext, defaultNext);

  if (type === "recovery" || type === "invite" || next === "/set-password") {
    const cookieStore = await cookies();
    cookieStore.set(PASSWORD_RESET_COOKIE, data.user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });
  }

  redirect(next);
}

// ---------------------------------------------------------------------------
// Confirm PKCE Authorization Code Action
// ---------------------------------------------------------------------------

export async function verifyConfirmCodeAction(
  formData: FormData
): Promise<never> {
  const code = formData.get("code")?.toString();
  const rawNext = formData.get("next")?.toString();

  if (!code) {
    redirect("/forgot-password?error=invalid_link");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user || !data?.session) {
    logSupabaseError("verifyConfirmCodeAction:exchange", error);
    const errMsg = (error?.message || "").toLowerCase();
    if (errMsg.includes("code verifier") || errMsg.includes("pkce")) {
      redirect("/forgot-password?error=different_browser");
    }
    redirect("/forgot-password?error=link_expired");
  }

  // Strictly verify the AMR claim from the exchanged session JWT (never trust client parameter)
  const claims = parseJwtPayload(data.session.access_token);
  const isVerifiedRecovery = isRecentRecoveryOrInviteSession(claims, 600);

  const defaultNext = isVerifiedRecovery ? "/set-password" : "/";
  const next = validateRedirectPath(rawNext, defaultNext);

  if (isVerifiedRecovery) {
    const cookieStore = await cookies();
    cookieStore.set(PASSWORD_RESET_COOKIE, data.user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });
  }

  redirect(next);
}

// ---------------------------------------------------------------------------
// Authorize Recovery Session (Server-Bound, strictly for validated sessions)
// ---------------------------------------------------------------------------

export async function authorizeRecoverySessionAction(): Promise<{
  success: boolean;
  userId?: string;
  error?: string;
}> {
  const supabase = await createClient();
  const [sessionRes, userRes] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);

  const session = sessionRes.data?.session;
  const user = userRes.data?.user;

  if (!session || !user || user.id !== session.user.id) {
    return { success: false, error: "Unauthorized session" };
  }

  // Strictly verify the AMR claim from the session JWT
  const claims = parseJwtPayload(session.access_token);
  const isVerifiedRecovery = isRecentRecoveryOrInviteSession(claims, 600);

  if (!isVerifiedRecovery) {
    return {
      success: false,
      error: "Session is not a verified recent recovery or invite session",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(PASSWORD_RESET_COOKIE, user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return { success: true, userId: user.id };
}

// ---------------------------------------------------------------------------
// Set Password Server Action
// ---------------------------------------------------------------------------

export async function setPasswordAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const cookieStore = await cookies();
  const resetAllowedUserId = cookieStore.get(PASSWORD_RESET_COOKIE)?.value;
  if (!resetAllowedUserId) {
    return {
      error:
        "Password reset session has expired or is unauthorized. Please request a new link.",
    };
  }

  const raw = {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const parsed = setPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== resetAllowedUserId) {
    return {
      error:
        "Authentication required. Please use the link sent to your email to set your password.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    logSupabaseError("setPasswordAction:update", error);
    return {
      error:
        "Failed to update password. Please try again or request a new link.",
    };
  }

  // Requirement: Sign out all other sessions (scope 'others')
  try {
    await supabase.auth.signOut({ scope: "others" });
  } catch (err) {
    console.error("[setPasswordAction] Signout others error:", err);
  }

  // Consume / delete the reset authorization cookie
  cookieStore.delete(PASSWORD_RESET_COOKIE);

  // Check profile active status and role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) {
    redirect("/auth/pending-activation");
  }

  if (profile?.role && profile.role in ROLE_HOME) {
    redirect(ROLE_HOME[profile.role as UserRole]);
  }

  redirect("/");
}
