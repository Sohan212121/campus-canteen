import { getAdminDashboardStatsAction } from "@/server/actions/admin";
import { DashboardView } from "@/components/admin/dashboard-view";
import { AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const result = await getAdminDashboardStatsAction("today");

  if (!result.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold">Unable to Load Dashboard</h2>
        <p className="text-xs text-muted-foreground max-w-sm">
          {result.error}
        </p>
      </div>
    );
  }

  return <DashboardView initialStats={result.data} initialPreset="today" />;
}
