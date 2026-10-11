import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { StaffNav } from "@/components/staff/staff-nav";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["staff"]);

  const canteenId: string | null = profile.canteen_id;
  let canteenName: string | null = null;

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
      />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}
