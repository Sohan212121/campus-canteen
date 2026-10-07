import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getSupabaseCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  return { url: url || "", key: key || "" };
}

/**
 * Full read-write Supabase client for Server Actions & Route Handlers.
 * Can set cookies to refresh the session token.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseCredentials();

  if (!url || !key) {
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        signInWithPassword: async () => ({
          data: { user: null, session: null },
          error: { message: "Invalid email or password" },
        }),
        signUp: async () => ({
          data: { user: null, session: null },
          error: { message: "Invalid email or password" },
        }),
        signOut: async () => ({ error: null }),
        exchangeCodeForSession: async () => ({
          data: { user: null, session: null },
          error: { message: "Auth code error" },
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServerClient>;
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have a proxy refreshing user sessions.
        }
      },
    },
  });
}

/**
 * Read-only Supabase client for Server Components.
 * Never writes cookies — safe to call from any RSC rendering context.
 */
export async function createReadOnlyClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseCredentials();

  if (!url || !key) {
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServerClient>;
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Intentionally empty — this client is read-only and must never
        // write cookies. It is used exclusively by Server Components.
      },
    },
  });
}

/**
 * Admin / service-role client — bypasses RLS.
 * Must only be used in trusted server-side code.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() || "";

  if (!url || !serviceKey) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createServerClient>;
  }

  return createServerClient(url, serviceKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {},
    },
  });
}

