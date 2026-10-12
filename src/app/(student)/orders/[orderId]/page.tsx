import { notFound } from "next/navigation";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { OrderConfirmationCleanup } from "@/components/student/order-confirmation-cleanup";
import { OrderTrackerView, type OrderDetailData } from "@/components/student/order-tracker-view";
import { extractMenuItemImageUrl } from "@/lib/image-utils";

const uuidSchema = z.string().uuid();

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireRole(["student"]);
  const { orderId } = await params;

  // 1. Validate UUID format
  const parsedId = uuidSchema.safeParse(orderId);
  if (!parsedId.success) {
    notFound();
  }

  // 2. Fetch order using user's session client with RLS
  const supabase = await createReadOnlyClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      id,
      order_code,
      status,
      payment_method,
      payment_status,
      total_paise,
      pickup_token,
      placed_at,
      requested_pickup_at,
      estimated_ready_at,
      pickup_window_end,
      canteens (
        name,
        location
      ),
      order_items (
        id,
        menu_item_id,
        name_snapshot,
        unit_price_paise,
        quantity,
        menu_items (
          image_url
        )
      )
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    notFound();
  }

  const canteen = Array.isArray(order.canteens) ? order.canteens[0] : order.canteens;
  const rawItems = (order.order_items || []) as Array<{
    id: string;
    menu_item_id: string;
    name_snapshot: string;
    unit_price_paise: number;
    quantity: number;
    menu_items?: { image_url?: string | null } | Array<{ image_url?: string | null }> | null;
  }>;

  const orderItems: OrderDetailData["order_items"] = rawItems.map((item) => ({
    id: item.id,
    menu_item_id: item.menu_item_id,
    name_snapshot: item.name_snapshot,
    unit_price_paise: item.unit_price_paise,
    quantity: item.quantity,
    image_url: extractMenuItemImageUrl(item.menu_items),
  }));

  const orderData: OrderDetailData = {
    id: order.id,
    order_code: order.order_code,
    status: order.status,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    total_paise: order.total_paise,
    pickup_token: order.pickup_token,
    placed_at: order.placed_at,
    requested_pickup_at: order.requested_pickup_at,
    estimated_ready_at: order.estimated_ready_at,
    pickup_window_end: order.pickup_window_end,
    canteens: canteen || null,
    order_items: orderItems,
  };

  return (
    <>
      <OrderConfirmationCleanup />
      <OrderTrackerView initialOrder={orderData} />
    </>
  );
}
