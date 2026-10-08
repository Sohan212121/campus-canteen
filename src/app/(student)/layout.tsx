import { requireRole } from "@/server/auth";
import { StudentBottomNav } from "@/components/student/bottom-nav";
import { CartUserSync } from "@/components/student/cart-user-sync";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["student", "staff", "admin"]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <CartUserSync userId={profile.id} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-24">
        {children}
      </main>
      <StudentBottomNav />
    </div>
  );
}
