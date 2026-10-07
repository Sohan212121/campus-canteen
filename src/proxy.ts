/**
 * Next.js 16 Proxy (replaces middleware.ts)
 *
 * ⚠️  This proxy only performs UX-level redirects. It is NOT a security
 *     boundary. The real auth enforcement happens in:
 *     - requireRole() — server-side role & is_active checks in Server Components
 *     - Supabase RLS policies — row-level security on every database query
 *
 *     Even if this proxy were bypassed entirely, the application would remain
 *     secure because of those two layers.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — this is critical to keep the auth token alive.
  // IMPORTANT: uses getUser() (validates JWT against Auth server), not
  // getSession() which only reads the local token without validation.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from protected routes to /login.
  // Public routes (/login, /signup) are excluded via the matcher below.
  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages to home.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Common image file extensions
     * - /api/health (health check endpoint)
     * - manifest and icon files (PWA assets)
     * - /login and /signup (public auth pages)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api/health|manifest\\.json|site\\.webmanifest|.*\\.(?:xml|txt)$|login|signup).*)",
  ],
};
