import { getStaffBoardDataAction } from "@/server/actions/staff";
import { KitchenBoard } from "@/components/staff/kitchen-board";
import { Store } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const data = await getStaffBoardDataAction();

  if (!data.canteenId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
        <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
          <Store className="h-8 w-8" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-xl font-bold tracking-tight">
            No Canteen Assigned
          </h2>
          <p className="text-sm text-muted-foreground">
            Your staff account has not been assigned to a canteen yet. Please contact a canteen administrator to assign you to a canteen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Kitchen Board</h1>
          <p className="text-sm text-muted-foreground">
            Track, accept, prepare, and manage orders in real time.
          </p>
        </div>
      </div>

      <KitchenBoard initialData={data} />
    </div>
  );
}
