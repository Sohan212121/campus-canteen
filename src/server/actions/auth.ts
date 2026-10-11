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

const signupSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required."),
  collegeId: z.string().trim().min(1, "College ID is required."),
  email: z.string().trim().email("Please enter a valid email address."),
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

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        college_id: parsed.data.collegeId,
      },
    },
  });

  if (error) {
    // Log the real error server-side only
    console.error("Supabase signup error:", error);
    // Generic error — never reveal whether an email is already registered
    return { error: "Could not create account. Please try again." };
  }

  redirect("/");
}

// ---------------------------------------------------------------------------
// Sign Out Server Action
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
