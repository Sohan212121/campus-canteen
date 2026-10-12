import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { OrdersListView, type OrderSummaryItem } from "@/components/student/orders-list-view";
import { extractMenuItemImageUrl } from "@/lib/image-utils";

export default async function OrdersPage() {
  const profile = await requireRole(["student"]);
  const supabase = await createReadOnlyClient();

  // 1. Fetch active orders (PLACED, ACCEPTED, PREPARING, READY)
  const { data: activeData } = await supabase
    .from("orders")
    .select(`
      id,
      order_code,
      status,
      total_paise,
      placed_at,
      estimated_ready_at,
      pickup_window_end,
      canteens (
        name,
        location
      ),
      order_items (
        id,
        name_snapshot,
        quantity,
        unit_price_paise,
        menu_items (
          image_url
        )
      )
    `)
    .eq("user_id", profile.id)
    .in("status", ["PLACED", "ACCEPTED", "PREPARING", "READY"])
    .order("placed_at", { ascending: false });

  // 2. Fetch past orders (first 20) with total count for pagination
  const { data: pastData, count: pastCount } = await supabase
    .from("orders")
    .select(`
      id,
      order_code,
      status,
      total_paise,
      placed_at,
      estimated_ready_at,
      pickup_window_end,
      canteens (
        name,
        location
      ),
      order_items (
        id,
        name_snapshot,
        quantity,
        unit_price_paise,
        menu_items (
          image_url
        )
      )
    `, { count: "exact" })
    .eq("user_id", profile.id)
    .not("status", "in", '("PLACED","ACCEPTED","PREPARING","READY")')
    .order("placed_at", { ascending: false })
    .range(0, 19);

  type RawItemRow = {
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price_paise: number;
    menu_items?: { image_url?: string | null } | Array<{ image_url?: string | null }> | null;
  };

  type RawOrderRow = {
    id: string;
    order_code: string;
    status: string;
    total_paise: number;
    placed_at: string;
    estimated_ready_at: string;
    pickup_window_end: string;
    canteens: { name: string; location: string | null } | Array<{ name: string; location: string | null }> | null;
    order_items: RawItemRow[] | null;
  };

  const rawActive = (activeData || []) as unknown as RawOrderRow[];
  const rawPast = (pastData || []) as unknown as RawOrderRow[];

  const initialActiveOrders: OrderSummaryItem[] = rawActive.map((o) => ({
    ...o,
    canteens: Array.isArray(o.canteens) ? o.canteens[0] : o.canteens,
    order_items: (o.order_items || []).map((item) => ({
      id: item.id,
      name_snapshot: item.name_snapshot,
      quantity: item.quantity,
      unit_price_paise: item.unit_price_paise,
      image_url: extractMenuItemImageUrl(item.menu_items),
    })),
  }));

  const initialPastOrders: OrderSummaryItem[] = rawPast.map((o) => ({
    ...o,
    canteens: Array.isArray(o.canteens) ? o.canteens[0] : o.canteens,
    order_items: (o.order_items || []).map((item) => ({
      id: item.id,
      name_snapshot: item.name_snapshot,
      quantity: item.quantity,
      unit_price_paise: item.unit_price_paise,
      image_url: extractMenuItemImageUrl(item.menu_items),
    })),
  }));

  return (
    <OrdersListView
      userId={profile.id}
      initialActiveOrders={initialActiveOrders}
      initialPastOrders={initialPastOrders}
      totalPastCount={pastCount ?? initialPastOrders.length}
    />
  );
}
