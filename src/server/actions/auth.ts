"use server";

import { redirect } from "next/navigation";
import * as z from "zod";

import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME, type UserRole } from "@/server/auth";

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
        error: "Registration is restricted to authorized campus email addresses.",
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
    console.error("Supabase signup error:", error);
    const rawMsg = error.message || "";

    if (rawMsg.includes("DOMAIN_NOT_ALLOWED")) {
      return {
        error: "Registration is restricted to authorized campus email addresses.",
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
    console.error("Resend confirmation error:", error);
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
