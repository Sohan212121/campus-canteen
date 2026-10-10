import { getAdminUsersAction, getAdminCanteensAction } from "@/server/actions/admin";
import { UsersView } from "@/components/admin/users-view";
import { AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [usersRes, canteensRes] = await Promise.all([
    getAdminUsersAction({ page: 1, limit: 25 }),
    getAdminCanteensAction(),
  ]);

  if (!usersRes.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <h2 className="text-lg font-bold">Unable to Load Users</h2>
        <p className="text-xs text-muted-foreground">
          {usersRes.error}
        </p>
      </div>
    );
  }

  return (
    <UsersView
      initialData={usersRes.data}
      canteens={canteensRes.success ? canteensRes.data : []}
    />
  );
}
