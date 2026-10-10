import { getAdminMenuDataAction, getAdminCanteensAction } from "@/server/actions/admin";
import { MenuView } from "@/components/admin/menu-view";
import { AlertCircle, Store } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const canteensRes = await getAdminCanteensAction();
  if (!canteensRes.success || !canteensRes.data || canteensRes.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <Store className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">No Active Canteen Found</h2>
        <p className="text-xs text-muted-foreground">
          Please initialize a canteen before managing categories and menu items.
        </p>
      </div>
    );
  }

  const primaryCanteenId = canteensRes.data[0].id;
  const menuRes = await getAdminMenuDataAction(primaryCanteenId);

  if (!menuRes.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <h2 className="text-lg font-bold">Unable to Load Menu</h2>
        <p className="text-xs text-muted-foreground">
          {menuRes.error}
        </p>
      </div>
    );
  }

  return (
    <MenuView
      canteenId={primaryCanteenId}
      initialCategories={menuRes.data.categories}
      initialItems={menuRes.data.items}
    />
  );
}
