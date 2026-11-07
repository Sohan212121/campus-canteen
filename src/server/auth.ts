import { cache } from "react";
import { redirect } from "next/navigation";

import { createReadOnlyClient } from "@/lib/supabase/server";

/** The shape of a profile row returned by getCurrentUser(). */
export type UserProfile = {
  id: string;
  full_name: string | null;
  college_id: string | null;
  role: "student" | "staff" | "admin";
  canteen_id: string | null;
  is_active: boolean;
};

/**
 * Read-only auth check for Server Components.
 *
 * - Wrapped with React cache() for per-request memoisation across Server Components
 *   within the same request lifecycle.
 * - Uses `auth.getUser()` (validates the JWT against Supabase Auth, never trusts
 *   the token alone) instead of `auth.getSession()`.
 * - Uses the read-only Supabase client — no cookie writes, no signOut.
 * - Returns the user's profile from `public.profiles` (role comes from here,
 *   never from user_metadata or JWT claims).
 * - Returns `null` when there is no authenticated user or no matching profile.
 */
export const getCurrentUser = cache(async (): Promise<UserProfile | null> => {
  const supabase = await createReadOnlyClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, college_id, role, canteen_id, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return profile as UserProfile;
});

export const ROLE_HOME = {
  student: "/",
  staff: "/staff",
  admin: "/admin",
} as const;

export type UserRole = keyof typeof ROLE_HOME;

/**
 * Server-side role gate for protected pages.
 *
 * - Requires the user to be logged in and to have one of the allowed roles.
 * - If the user is inactive (`is_active === false`), redirects to the
 *   `/auth/deactivated` route handler which signs them out and sends them
 *   to `/login?error=account_deactivated`.
 * - If no user is found, redirects to `/login`.
 * - If the user's role is not in the allowed list, redirects to their own home:
 *   student -> /, staff -> /staff, admin -> /admin.
 *
 * Role is always read from `public.profiles`, never from JWT claims.
 */
export async function requireRole(
  allowedRoles: UserProfile["role"][]
): Promise<UserProfile> {
  const profile = await getCurrentUser();

  if (!profile) {
    redirect("/login");
  }

  if (!profile.is_active) {
    redirect("/auth/deactivated");
  }

  if (!allowedRoles.includes(profile.role)) {
    redirect(ROLE_HOME[profile.role] ?? "/");
  }

  return profile;
}
