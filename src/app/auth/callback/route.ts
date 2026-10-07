import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback handler.
 * Exchanges the authorization code for a session after third-party sign-in.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");

  // Validate redirect target: must be a relative path starting with a single "/" (not "//").
  // Otherwise, fall back safely to "/".
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // OAuth error — redirect to login with generic error.
  return NextResponse.redirect(`${origin}/login?error=auth_code_error`);
}
