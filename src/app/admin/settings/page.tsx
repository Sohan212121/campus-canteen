import { getAdminCanteensAction } from "@/server/actions/admin";
import { SettingsView } from "@/components/admin/settings-view";
import { Store } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const result = await getAdminCanteensAction();

  if (!result.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <Store className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Failed to Load Canteens</h2>
        <p className="text-xs text-muted-foreground">
          {result.error}
        </p>
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <Store className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">No Active Canteen Found</h2>
        <p className="text-xs text-muted-foreground">
          Please initialize at least one canteen in the system.
        </p>
      </div>
    );
  }

  // Primary canteen
  const canteen = result.data[0];

  return <SettingsView canteen={canteen} />;
}
