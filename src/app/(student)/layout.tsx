import { requireRole } from "@/server/auth";
import { StudentBottomNav } from "@/components/student/bottom-nav";
import { CartUserSync } from "@/components/student/cart-user-sync";
import { StudentHeader } from "@/components/student/student-header";
import { createReadOnlyClient } from "@/lib/supabase/server";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["student"]);

  // Fetch initial unread notifications count for header badge
  const supabase = await createReadOnlyClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("is_read", false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <CartUserSync userId={profile.id} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-3 pb-24">
        <StudentHeader userId={profile.id} initialUnreadCount={count ?? 0} />
        {children}
      </main>
      <StudentBottomNav />
    </div>
  );
}
