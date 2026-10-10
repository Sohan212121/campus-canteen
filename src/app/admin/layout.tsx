import { requireRole } from "@/server/auth";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["admin"]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AdminNav adminName={profile.full_name} />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
