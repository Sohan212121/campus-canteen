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

import { ROLE_HOME, type UserRole } from "@/server/auth";

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  // If Supabase credentials are not configured, skip auth redirects
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Never redirect health check or dedicated auth handlers
  if (
    pathname === "/api/health" ||
    pathname === "/auth/deactivated" ||
    pathname === "/auth/callback"
  ) {
    return NextResponse.next();
  }

  // Only run UX redirects on page routes (skip Server Actions and mutation requests)
  if (
    request.headers.has("next-action") ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
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
  });

  // Refresh session via getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Handle unauthenticated visitors
  if (!user) {
    if (pathname === "/login" || pathname === "/signup") {
      return supabaseResponse;
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Look up profile role & status for authenticated page navigation
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return supabaseResponse;
  }

  // Deactivated user -> redirect to sign-out handler
  if (!profile.is_active) {
    const deactUrl = request.nextUrl.clone();
    deactUrl.pathname = "/auth/deactivated";
    return NextResponse.redirect(deactUrl);
  }

  const userRole = profile.role as UserRole;
  const userHome = ROLE_HOME[userRole] ?? "/";

  // Redirect signed-in users away from /login and /signup to their own home
  if (pathname === "/login" || pathname === "/signup") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return NextResponse.redirect(homeUrl);
  }

  // Student area: /, /menu, /cart, /checkout, /orders, /profile, /notifications
  const isStudentRoute =
    pathname === "/" ||
    pathname === "/menu" ||
    pathname.startsWith("/menu/") ||
    pathname === "/cart" ||
    pathname.startsWith("/cart/") ||
    pathname === "/checkout" ||
    pathname.startsWith("/checkout/") ||
    pathname === "/orders" ||
    pathname.startsWith("/orders/") ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/") ||
    pathname === "/notifications" ||
    pathname.startsWith("/notifications/");

  if (isStudentRoute && userRole !== "student") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return NextResponse.redirect(homeUrl);
  }

  // Staff area (/staff/*)
  if (pathname.startsWith("/staff") && userRole !== "staff") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return NextResponse.redirect(homeUrl);
  }

  // Admin area (/admin/*)
  if (pathname.startsWith("/admin") && userRole !== "admin") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
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
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api/health|manifest\\.json|site\\.webmanifest|.*\\.(?:xml|txt)$).*)",
  ],
};
