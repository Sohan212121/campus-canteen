import { getAdminOrdersAction } from "@/server/actions/admin";
import { OrdersView } from "@/components/admin/orders-view";
import { AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const result = await getAdminOrdersAction({ page: 1, limit: 25 });

  if (!result.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <h2 className="text-lg font-bold">Unable to Load Orders</h2>
        <p className="text-xs text-muted-foreground">
          {result.error}
        </p>
      </div>
    );
  }

  return <OrdersView initialData={result.data} />;
}
