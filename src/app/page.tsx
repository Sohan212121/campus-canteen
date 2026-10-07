import { UtensilsCrossed, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireRole } from "@/server/auth";
import { signOutAction } from "@/server/actions/auth";

/**
 * Student Home — placeholder page for Phase 3.
 *
 * Replaces the Phase 1 landing page. This is a protected route that
 * requires the user to have a "student" role (though staff & admin
 * will get their own dashboards in future phases).
 */
export default async function StudentHomePage() {
  const profile = await requireRole(["student", "staff", "admin"]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <UtensilsCrossed className="h-7 w-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome, {profile.full_name ?? "Student"}!
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Your campus canteen dashboard is coming soon. You&apos;ll be able to
            browse the menu, pre-order meals, and pick up without the queue.
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-6 text-left shadow-xs">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-medium capitalize">{profile.role}</dd>
            </div>
            {profile.college_id && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">College ID</dt>
                <dd className="font-medium">{profile.college_id}</dd>
              </div>
            )}
          </dl>
        </div>

        <form action={signOutAction} className="pt-2">
          <Button variant="outline" size="sm" type="submit" className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Campus Canteen &bull; Smart
          Pre-Order System
        </p>
      </div>
    </main>
  );
}
