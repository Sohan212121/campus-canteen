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
import { withTimeout } from "@/lib/timeout";
import { renderServiceUnavailableHtml } from "@/lib/service-unavailable";

/**
 * Copies refreshed cookies from a Supabase response onto a redirect response,
 * ensuring session tokens are never dropped during redirects.
 */
function redirectWithCookies(
  targetUrl: URL,
  sourceResponse: NextResponse
): NextResponse {
  const redirectRes = NextResponse.redirect(targetUrl);
  sourceResponse.cookies.getAll().forEach((cookie) => {
    redirectRes.cookies.set(cookie.name, cookie.value, {
      path: cookie.path,
      domain: cookie.domain,
      maxAge: cookie.maxAge,
      expires: cookie.expires,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
    });
  });
  return redirectRes;
}

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

  // Never redirect health check, dedicated auth handlers, or public PWA assets
  if (
    pathname === "/api/health" ||
    pathname === "/auth/deactivated" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/confirm" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline" ||
    pathname.startsWith("/icons/")
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

  const allCookies = request.cookies.getAll();
  const hasSessionCookie = allCookies.some(
    (c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")
  );

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

  // Refresh session via getUser() with a 4-second timeout
  let user = null;
  let isAuthTimeout = false;
  let isTransientAuthError = false;

  try {
    const authRes = await withTimeout(supabase.auth.getUser(), 4000);
    user = authRes?.data?.user ?? null;
    if (!user && authRes?.error) {
      const err = authRes.error;
      const status = err.status || 0;
      const name = err.name || "";
      const msg = (err.message || "").toLowerCase();

      // Classify transient errors: 5xx, rate limits (429), retryable network fetches
      if (
        status >= 500 ||
        status === 429 ||
        name === "AuthRetryableFetchError" ||
        msg.includes("network") ||
        msg.includes("fetch failed") ||
        msg.includes("timeout") ||
        msg.includes("service unreachable")
      ) {
        isTransientAuthError = true;
      }
    }
  } catch {
    console.error("auth service unreachable");
    isAuthTimeout = true;
    user = null;
  }

  const isServiceUnavailable =
    isAuthTimeout || (isTransientAuthError && hasSessionCookie);

  // Handle transient auth failure: NEVER grant access, NEVER clear session cookies, and NEVER redirect to /login
  if (isServiceUnavailable) {
    if (
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/forgot-password" ||
      pathname === "/set-password" ||
      pathname === "/auth/confirm" ||
      pathname === "/auth/pending-activation" ||
      pathname === "/offline"
    ) {
      return supabaseResponse;
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVICE_UNAVAILABLE",
          error: "Authentication service temporarily unreachable",
        },
        { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } }
      );
    }

    return new NextResponse(renderServiceUnavailableHtml(), {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "5",
        "Cache-Control": "no-store",
      },
    });
  }

  // Handle unauthenticated visitors (definitive non-timeout signed-out state)
  if (!user) {
    if (
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/forgot-password" ||
      pathname === "/auth/confirm"
    ) {
      return supabaseResponse;
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHENTICATED", error: "Authentication required" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return redirectWithCookies(loginUrl, supabaseResponse);
  }

  // Look up profile role & status for authenticated page navigation with a 4-second timeout
  let profile: { role: string; is_active: boolean } | null = null;
  try {
    const query = supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id);

    const profileRes = await withTimeout(
      async (signal) => {
        if (
          typeof (query as { abortSignal?: (s: AbortSignal) => unknown })
            .abortSignal === "function"
        ) {
          (
            query as { abortSignal: (s: AbortSignal) => unknown }
          ).abortSignal(signal);
        }
        return await query.single();
      },
      4000
    );
    profile = profileRes?.data ?? null;

    if (!profile && profileRes?.error) {
      const err = profileRes.error;
      const isNotFound =
        err.code === "PGRST116" ||
        err.message?.toLowerCase().includes("not found") ||
        err.message?.toLowerCase().includes("no rows") ||
        err.message?.toLowerCase().includes("0 rows");

      if (!isNotFound) {
        // Transient database error during profile fetch
        throw new Error("auth service unreachable");
      }
    }
  } catch {
    console.error("auth service unreachable");
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVICE_UNAVAILABLE",
          error: "Profile service temporarily unreachable",
        },
        { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } }
      );
    }
    return new NextResponse(renderServiceUnavailableHtml(), {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "5",
        "Cache-Control": "no-store",
      },
    });
  }

  if (!profile) {
    return supabaseResponse;
  }

  // Inactive / deactivated user -> allow setting password or viewing waiting screen
  if (!profile.is_active) {
    if (
      pathname === "/set-password" ||
      pathname === "/auth/pending-activation" ||
      pathname === "/auth/confirm"
    ) {
      return supabaseResponse;
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, code: "FORBIDDEN", error: "Account is inactive" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
    const deactUrl = request.nextUrl.clone();
    deactUrl.pathname = "/auth/deactivated";
    return redirectWithCookies(deactUrl, supabaseResponse);
  }

  const userRole = profile.role as UserRole;
  const userHome = ROLE_HOME[userRole] ?? "/";

  // Allow signed-in users arriving at /forgot-password with an error parameter or from=link
  // to view the error message and request a new link rather than redirecting them home.
  const searchParams = request.nextUrl.searchParams;
  const isForgotPasswordWithContext =
    pathname === "/forgot-password" &&
    Boolean(
      searchParams?.has("error") ||
      searchParams?.has("error_code") ||
      searchParams?.get("from") === "link"
    );

  // Redirect signed-in active users away from auth pages to their own home
  if (
    !isForgotPasswordWithContext &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/forgot-password")
  ) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return redirectWithCookies(homeUrl, supabaseResponse);
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
    return redirectWithCookies(homeUrl, supabaseResponse);
  }

  // Staff area (/staff/*)
  if (pathname.startsWith("/staff") && userRole !== "staff") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return redirectWithCookies(homeUrl, supabaseResponse);
  }

  // Admin area (/admin/*)
  if (pathname.startsWith("/admin") && userRole !== "admin") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = userHome;
    return redirectWithCookies(homeUrl, supabaseResponse);
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
     * - /manifest.webmanifest, /offline, /icons/* (exact PWA exclusions)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api/health|manifest\\.webmanifest|manifest\\.json|site\\.webmanifest|offline|icons/.*|.*\\.(?:xml|txt)$).*)",
  ],
};
