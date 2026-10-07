import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Route handler that signs out a deactivated user and redirects to
 * the login page with an error parameter.
 *
 * Called by requireRole() when it detects is_active === false.
 */
export async function GET() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?error=account_deactivated");
}
