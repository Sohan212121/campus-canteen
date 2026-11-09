import { cache } from "react";
import { redirect } from "next/navigation";

import { createReadOnlyClient } from "@/lib/supabase/server";
import { withTimeout, TimeoutError } from "@/lib/timeout";

/** The shape of a profile row returned by getCurrentUser(). */
export type UserProfile = {
  id: string;
  full_name: string | null;
  college_id: string | null;
  role: "student" | "staff" | "admin";
  canteen_id: string | null;
  is_active: boolean;
  email?: string | null;
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
 * - Enforces a 4-second timeout with AbortSignal. On timeout, logs one line
 *   "auth service unreachable" without sensitive keys.
 * - Returns `null` when there is no authenticated user or no matching profile.
 */
export const getCurrentUser = cache(async (): Promise<UserProfile | null> => {
  try {
    const supabase = await createReadOnlyClient();

    const authRes = (await withTimeout(
      supabase.auth.getUser(),
      4000
    )) as Awaited<ReturnType<typeof supabase.auth.getUser>>;
    const user = authRes?.data?.user;

    if (!user) {
      if (authRes?.error) {
        const err = authRes.error;
        const status = err.status || 0;
        const name = err.name || "";
        const msg = (err.message || "").toLowerCase();

        // Handle temporary error: status >= 500, 429 rate limit, or AuthRetryableFetchError / network failure
        const isTemporary =
          status >= 500 ||
          status === 429 ||
          name === "AuthRetryableFetchError" ||
          msg.includes("network") ||
          msg.includes("fetch failed") ||
          msg.includes("timeout") ||
          msg.includes("service unreachable");

        if (isTemporary) {
          console.error("auth service unreachable");
          throw new Error("We can't reach the service right now. Please try again.");
        }
      }
      return null;
    }

    const query = supabase
      .from("profiles")
      .select("id, full_name, college_id, role, canteen_id, is_active")
      .eq("id", user.id);

    const profileRes = await withTimeout(
      async (signal) => {
        if (typeof (query as { abortSignal?: (s: AbortSignal) => unknown }).abortSignal === "function") {
          (query as { abortSignal: (s: AbortSignal) => unknown }).abortSignal(signal);
        }
        return await query.single();
      },
      4000
    );

    const profile = profileRes?.data;
    if (!profile) {
      const err = profileRes?.error;
      const isNotFound =
        !err ||
        err.code === "PGRST116" ||
        err.message?.toLowerCase().includes("not found") ||
        err.message?.toLowerCase().includes("no rows") ||
        err.message?.toLowerCase().includes("0 rows");

      if (isNotFound) {
        // Definitive: user row does not exist in profiles table
        return null;
      }

      // Transient database / network query failure — throw into retry state
      console.error("auth service unreachable");
      throw new Error("We can't reach the service right now. Please try again.");
    }

    const userProfile: UserProfile = { ...(profile as UserProfile) };
    if (user.email) {
      userProfile.email = user.email;
    }

    return userProfile;
  } catch (err) {
    const isTimeout =
      err instanceof TimeoutError || (err as Error)?.name === "TimeoutError";
    const msg = (err as Error)?.message?.toLowerCase() || "";
    const isNetworkOrTransient =
      isTimeout ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("can't reach the service") ||
      msg.includes("abort");

    if (isNetworkOrTransient) {
      console.error("auth service unreachable");
      throw new Error("We can't reach the service right now. Please try again.");
    }
    return null;
  }
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
 * - On timeout: NEVER grant access, NEVER clear session cookies, and NEVER redirect to /login.
 *
 * Role is always read from `public.profiles`, never from JWT claims.
 */
export async function requireRole(
  allowedRoles: UserProfile["role"][]
): Promise<UserProfile> {
  let profile: UserProfile | null = null;
  try {
    profile = await getCurrentUser();
  } catch (err) {
    if (
      err instanceof TimeoutError ||
      (err as Error)?.name === "TimeoutError" ||
      (err as Error)?.message?.includes("reach the service right now")
    ) {
      throw new Error("We can't reach the service right now. Please try again.");
    }
    throw err;
  }

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
