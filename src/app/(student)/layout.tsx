import { requireRole } from "@/server/auth";
import { StudentBottomNav } from "@/components/student/bottom-nav";
import { CartUserSync } from "@/components/student/cart-user-sync";
import { StudentHeader } from "@/components/student/student-header";
import { StudentInstallPrompt } from "@/components/student/install-prompt";
import { NavigationTransitionProvider } from "@/components/navigation/navigation-transition-provider";
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
    <NavigationTransitionProvider>
      <div className="flex min-h-screen flex-col bg-background dark:bg-[#050507] overflow-x-hidden selection:bg-[#F59E0B] selection:text-black">
        <CartUserSync userId={profile.id} />
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[calc(6rem+env(safe-area-inset-bottom,0px))] dark:bg-[#090A0F] dark:border-x dark:border-[#1A1C24] dark:shadow-2xl">
          <StudentHeader userId={profile.id} initialUnreadCount={count ?? 0} />
          {children}
        </main>
        <StudentInstallPrompt />
        <StudentBottomNav />
      </div>
    </NavigationTransitionProvider>
  );
}
