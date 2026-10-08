import { User, LogOut, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/server/auth";
import { signOutAction } from "@/server/actions/auth";

export default async function ProfilePage() {
  const profile = await requireRole(["student", "staff", "admin"]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Your Profile</h1>
        <p className="text-xs text-muted-foreground">
          Manage your campus account credentials and session.
        </p>
      </header>

      {/* Profile Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-5 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <User className="h-6 w-6" />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-bold text-base">{profile.full_name ?? "Campus Member"}</h2>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="capitalize text-[10px]">
                {profile.role}
              </Badge>
              {profile.college_id && (
                <span className="text-xs text-muted-foreground">
                  ID: {profile.college_id}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <dl className="space-y-2.5 text-xs sm:text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Account Status</dt>
              <dd className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                Active
              </dd>
            </div>
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
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Security Layer</dt>
              <dd className="font-medium text-muted-foreground flex items-center gap-1">
                <Shield className="h-3.5 w-3.5 text-primary" />
                RBAC &amp; RLS Verified
              </dd>
            </div>
          </dl>
        </div>

        <form action={signOutAction} className="pt-2">
          <Button
            type="submit"
            variant="outline"
            className="w-full h-11 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20 font-semibold gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </form>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Campus Canteen &bull; Smart Pre-Order System
      </p>
    </div>
  );
}
