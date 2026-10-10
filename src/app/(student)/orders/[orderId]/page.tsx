import { notFound } from "next/navigation";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { OrderConfirmationCleanup } from "@/components/student/order-confirmation-cleanup";
import { OrderTrackerView, type OrderDetailData } from "@/components/student/order-tracker-view";

const uuidSchema = z.string().uuid();

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireRole(["student", "staff", "admin"]);
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
        quantity
      )
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    notFound();
  }

  const canteen = Array.isArray(order.canteens) ? order.canteens[0] : order.canteens;
  const orderItems = (order.order_items || []) as OrderDetailData["order_items"];

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
