import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { StaffNav } from "@/components/staff/staff-nav";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["staff", "admin"]);

  let canteenId: string | null = null;
  let canteenName: string | null = null;

  if (profile.role === "staff") {
    canteenId = profile.canteen_id;
  } else if (profile.role === "admin") {
    canteenId = (await getActiveCanteenId()) ?? profile.canteen_id;
  }

  if (canteenId) {
    const supabase = await createReadOnlyClient();
    const { data } = await supabase
      .from("canteens")
      .select("name")
      .eq("id", canteenId)
      .maybeSingle();

    if (data) {
      canteenName = data.name;
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffNav
        canteenName={canteenName}
        canteenId={canteenId}
        userRole={profile.role}
      />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}
