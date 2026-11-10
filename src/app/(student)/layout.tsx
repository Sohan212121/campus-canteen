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
  const supabase = await createReadOnlyClient();

  // 1. Existing notifications count behaves exactly as before
  const notifsPromise = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("is_read", false);

  // 2. Avatar lookup: strictly isolated with its own 2-second timeout & try/catch
  // Never affects notifications count, never throws, and never triggers retry state
  let avatarUrl: string | null = null;
  try {
    const avatarFetchPromise = (async () => {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("avatar_path")
        .eq("id", profile.id)
        .single();

      if (profileRow?.avatar_path) {
        const { data: signedData } = await supabase.storage
          .from("avatars")
          .createSignedUrl(profileRow.avatar_path, 3600);
        return signedData?.signedUrl ?? null;
      }
      return null;
    })();

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 2000)
    );

    avatarUrl = await Promise.race([avatarFetchPromise, timeoutPromise]);
  } catch (err) {
    console.error("Non-blocking error loading student avatar:", err);
    avatarUrl = null;
  }

  // Await notifications count separately so avatar timeout never alters it
  const { count } = await notifsPromise;

  return (
    <NavigationTransitionProvider>
      <div className="flex min-h-screen flex-col bg-background dark:bg-[#050507] overflow-x-hidden selection:bg-[#F59E0B] selection:text-black">
        <CartUserSync userId={profile.id} />
        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[calc(6rem+env(safe-area-inset-bottom,0px))] dark:bg-[#090A0F] dark:border-x dark:border-[#1A1C24] dark:shadow-2xl">
          <StudentHeader
            userId={profile.id}
            initialUnreadCount={count ?? 0}
            initialAvatarUrl={avatarUrl}
            fullName={profile.full_name}
          />
          {children}
        </main>
        <StudentInstallPrompt />
        <StudentBottomNav />
      </div>
    </NavigationTransitionProvider>
  );
}
