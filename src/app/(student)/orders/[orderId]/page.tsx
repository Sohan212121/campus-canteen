import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, MapPin, ArrowRight, UtensilsCrossed } from "lucide-react";
import * as z from "zod";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/money";
import { OrderConfirmationCleanup } from "@/components/student/order-confirmation-cleanup";

const uuidSchema = z.string().uuid();

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export default async function OrderConfirmationPage({
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
      total_paise,
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

  // Canteen details (Supabase query joins array/single)
  const canteen = Array.isArray(order.canteens) ? order.canteens[0] : order.canteens;
  const orderItems = (order.order_items || []) as Array<{
    id: string;
    name_snapshot: string;
    unit_price_paise: number;
    quantity: number;
  }>;

  return (
    <div className="space-y-6 pb-24">
      {/* Client component to ensure cart is wiped cleanly */}
      <OrderConfirmationCleanup />

      {/* Success Header Banner */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-center space-y-3">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
          <CheckCircle2 className="h-8 w-8 stroke-[2.25]" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-emerald-900 dark:text-emerald-200">
            Order Confirmed!
          </h1>
          <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
            Your order has been successfully placed.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg bg-card/80 px-3 py-1.5 border border-border shadow-2xs">
          <span className="text-xs text-muted-foreground font-medium">Order Reference:</span>
          <span className="font-mono font-bold text-sm text-foreground">{order.order_code}</span>
        </div>
      </div>

      {/* Pickup Schedule & Location */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" />
          Pickup Schedule
        </h2>

        <div className="rounded-xl bg-muted/30 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated Ready:</span>
            <span className="font-bold text-sm text-foreground">
              {formatTime(order.estimated_ready_at)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pickup Window:</span>
            <span className="font-medium text-foreground">
              {formatTime(order.estimated_ready_at)} – {formatTime(order.pickup_window_end)}
            </span>
          </div>

          <div className="border-t border-border/60 pt-2 flex items-start gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">{canteen?.name ?? "Main Canteen"}</p>
              {canteen?.location && <p className="text-[11px]">{canteen.location}</p>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs">
          <span className="text-muted-foreground">Current Status:</span>
          <Badge variant="outline" className="font-bold border-primary text-primary capitalize text-[11px]">
            {order.status.toLowerCase()}
          </Badge>
        </div>
      </section>

      {/* Order Items Snapshot */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-sm font-bold">Ordered Items</h2>

        <div className="divide-y divide-border/60">
          {orderItems.map((item) => (
            <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
              <div>
                <p className="font-semibold text-foreground">{item.name_snapshot}</p>
                <p className="text-muted-foreground text-[11px]">
                  {item.quantity} &times; {formatPaise(item.unit_price_paise)}
                </p>
              </div>
              <span className="font-bold text-foreground">
                {formatPaise(item.unit_price_paise * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-3 flex items-center justify-between text-sm font-bold">
          <span>Amount Payable at Counter</span>
          <span className="text-primary text-base">{formatPaise(order.total_paise)}</span>
        </div>
      </section>

      {/* Bottom Actions */}
      <div className="space-y-2 pt-2">
        <Link
          href="/menu"
          className={buttonVariants({
            size: "lg",
            className: "w-full h-12 text-sm font-semibold rounded-xl gap-2 inline-flex items-center justify-center",
          })}
        >
          <UtensilsCrossed className="h-4 w-4" />
          <span>Back to Menu</span>
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Link>
        <p className="text-center text-[11px] text-muted-foreground">
          Show your order code at the pickup counter when your food is ready.
        </p>
      </div>
    </div>
  );
}
