import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  validateRedirectPath,
  PASSWORD_RESET_COOKIE,
} from "@/lib/validation/auth-recovery";

/**
 * OAuth & fallback callback handler.
 * Exchanges authorization code or token hash for session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next");

  const defaultNext =
    type === "recovery" || type === "invite" ? "/set-password" : "/";
  const next = validateRedirectPath(rawNext, defaultNext);

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      if (next === "/set-password" || type === "recovery" || type === "invite") {
        const cookieStore = await cookies();
        cookieStore.set(PASSWORD_RESET_COOKIE, data.user.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error && data?.user) {
      if (next === "/set-password" || type === "recovery" || type === "invite") {
        const cookieStore = await cookies();
        cookieStore.set(PASSWORD_RESET_COOKIE, data.user.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 600,
          path: "/",
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to login with link error
  return NextResponse.redirect(`${origin}/login?error=auth_code_error`);
}
