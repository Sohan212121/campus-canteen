"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  Clock,
  MapPin,
  UtensilsCrossed,
  Copy,
  Check,
  AlertCircle,
  XCircle,
  Sparkles,
  ShoppingBag,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { formatPaise } from "@/lib/money";
import { useCartStore } from "@/lib/cart-store";
import {
  formatIstTime,
  formatIstDateTime,
  canShowPickupToken,
  isOrderCancellable,
  getStatusBadgeConfig,
  ORDER_LIFECYCLE_STEPS,
} from "@/lib/order-status";
import { cancelOrderAction, getReorderItemsAction } from "@/server/actions/order";
import { cn } from "@/lib/utils";

export interface OrderDetailData {
  id: string;
  order_code: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total_paise: number;
  pickup_token: string;
  placed_at: string;
  requested_pickup_at: string | null;
  estimated_ready_at: string;
  pickup_window_end: string;
  canteens: {
    name: string;
    location: string | null;
  } | null;
  order_items: Array<{
    id: string;
    menu_item_id: string;
    name_snapshot: string;
    unit_price_paise: number;
    quantity: number;
  }>;
}

interface OrderTrackerViewProps {
  initialOrder: OrderDetailData;
}

export function OrderTrackerView({ initialOrder }: OrderTrackerViewProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetailData>(initialOrder);
  const [hasCopiedToken, setHasCopiedToken] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Subscribes to Realtime updates on public.orders for this specific order
  useEffect(() => {
    const supabase = createClient();
    const channelName = `order-track-${order.id}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${order.id}`,
        },
        (payload) => {
          const updated = payload.new as Partial<OrderDetailData>;
          if (updated && updated.status) {
            setOrder((prev) => ({
              ...prev,
              status: updated.status || prev.status,
              estimated_ready_at: updated.estimated_ready_at || prev.estimated_ready_at,
              pickup_window_end: updated.pickup_window_end || prev.pickup_window_end,
              payment_status: updated.payment_status || prev.payment_status,
            }));
          }
        }
      )
      .subscribe();

    // Polling fallback every 10s if tab is active
    const intervalId = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;

      const { data } = await supabase
        .from("orders")
        .select("status, estimated_ready_at, pickup_window_end, payment_status")
        .eq("id", order.id)
        .maybeSingle();

      if (data) {
        setOrder((prev) => ({
          ...prev,
          status: data.status,
          estimated_ready_at: data.estimated_ready_at,
          pickup_window_end: data.pickup_window_end,
          payment_status: data.payment_status,
        }));
      }
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [order.id]);

  const copyTokenToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(order.pickup_token);
      setHasCopiedToken(true);
      toast.success("Pickup token copied!");
      setTimeout(() => setHasCopiedToken(false), 2000);
    } catch {
      toast.error("Could not copy token");
    }
  };

  const handleCancelOrder = async () => {
    setIsCancelling(true);
    setShowCancelConfirm(false);

    try {
      const res = await cancelOrderAction(order.id);
      if (!res.success) {
        toast.error(res.error || "Failed to cancel order");
      } else {
        setOrder((prev) => ({ ...prev, status: "CANCELLED" }));
        toast.success(
          res.data?.was_already_cancelled
            ? "Order was already cancelled."
            : "Order cancelled successfully. Reserved stock has been restored."
        );
      }
    } catch {
      toast.error("Network error while cancelling order");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleReorder = async () => {
    setIsReordering(true);

    try {
      const res = await getReorderItemsAction(order.id);

      if (!res.success) {
        toast.error(res.error || "Could not reorder items");
        return;
      }

      if (res.skippedItems.length > 0) {
        const skippedNames = res.skippedItems.map((item) => item.name).join(", ");
        toast.warning(`Skipped unavailable items: ${skippedNames}`, {
          duration: 5000,
        });
      }

      if (res.itemsToReorder.length > 0) {
        useCartStore.getState().addItems(
          res.itemsToReorder.map((i) => ({
            menu_item_id: i.menu_item_id,
            quantity: i.quantity,
          }))
        );

        toast.success(`Added ${res.itemsToReorder.length} item(s) to cart`);
        router.push("/cart");
      } else {
        toast.error("All items in this order are currently unavailable or out of stock.");
      }
    } catch {
      toast.error("Failed to reorder items");
    } finally {
      setIsReordering(false);
    }
  };

  const badgeConfig = getStatusBadgeConfig(order.status);
  const showToken = canShowPickupToken(order.status);
  const cancellable = isOrderCancellable(order.status);

  // Stepper calculations
  const stepIndex = ORDER_LIFECYCLE_STEPS.findIndex((s) => s.status === order.status);
  const isTerminal = ["CANCELLED", "REJECTED"].includes(order.status);

  return (
    <div className="space-y-5 pb-24">
      {/* Header Info */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Order #{order.order_code}</h1>
            <Badge variant={badgeConfig.variant} className={cn("text-[11px]", badgeConfig.className)}>
              {badgeConfig.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Placed on {formatIstDateTime(order.placed_at)}
          </p>
        </div>

        {/* Reorder Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleReorder}
          disabled={isReordering}
          className="h-9 gap-1.5 text-xs font-semibold rounded-xl"
        >
          {isReordering ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          <span>Reorder</span>
        </Button>
      </div>

      {/* Terminal Status Alert (CANCELLED / REJECTED) */}
      {isTerminal && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-bold text-sm">
            <XCircle className="h-5 w-5" />
            <span>Order {order.status === "CANCELLED" ? "Cancelled" : "Rejected"}</span>
          </div>
          <p className="text-xs text-destructive/90 leading-relaxed">
            {order.status === "CANCELLED"
              ? "This order was cancelled and inventory stock was restored. You will not be charged."
              : "This order was rejected by the canteen due to unexpected kitchen closure or stock-out."}
          </p>
        </div>
      )}

      {/* Progress Stepper (Only for active / collected states) */}
      {!isTerminal && (
        <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Preparation Progress
            </h2>
            {order.status === "READY" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <Sparkles className="h-3 w-3" /> Ready at Counter
              </span>
            )}
          </div>

          <div className="relative pt-2 pb-1">
            <div className="grid grid-cols-5 gap-1 text-center">
              {ORDER_LIFECYCLE_STEPS.map((step, idx) => {
                const isPassed = stepIndex >= idx;
                const isCurrent = stepIndex === idx;

                return (
                  <div key={step.status} className="flex flex-col items-center space-y-1.5">
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all",
                        isCurrent
                          ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-110 shadow-xs"
                          : isPassed
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground/60"
                      )}
                    >
                      {isPassed && !isCurrent ? (
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-medium leading-tight",
                        isCurrent
                          ? "text-foreground font-bold"
                          : isPassed
                          ? "text-foreground/80"
                          : "text-muted-foreground/60"
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Prominent QR & Pickup Token (RENDERED ONLY WHILE NOT CANCELLED/REJECTED/COLLECTED) */}
      {showToken && (
        <section className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 via-card to-card p-5 text-center space-y-4 shadow-xs">
          <div className="space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Present for Smart Pickup
            </p>
            <h2 className="text-base font-bold">Counter Pickup Token</h2>
          </div>

          {/* QR Code Container */}
          <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-2xl bg-white p-3 shadow-sm border border-border/40">
            <QRCodeSVG
              value={order.pickup_token}
              size={168}
              level="M"
              className="h-full w-full"
            />
          </div>

          {/* Numeric Monospace Token */}
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-xl bg-muted/60 px-4 py-2 border border-border shadow-2xs">
              <span className="font-mono text-2xl font-black tracking-widest text-foreground">
                {order.pickup_token}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyTokenToClipboard}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Copy token"
              >
                {hasCopiedToken ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Show this QR code or 6-digit numeric token at the counter to collect your order.
            </p>
          </div>
        </section>
      )}

      {/* Schedule & Canteen Info */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-primary" /> Pickup Timings
        </h2>

        <div className="rounded-xl bg-muted/30 p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated Ready:</span>
            <span className="font-bold text-sm text-foreground">
              {formatIstTime(order.estimated_ready_at)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pickup Window:</span>
            <span className="font-medium text-foreground">
              {formatIstTime(order.estimated_ready_at)} – {formatIstTime(order.pickup_window_end)}
            </span>
          </div>

          <div className="border-t border-border/60 pt-2 flex items-start gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">
                {order.canteens?.name ?? "Campus Canteen"}
              </p>
              {order.canteens?.location && (
                <p className="text-[11px]">{order.canteens.location}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Itemized Line Items */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ShoppingBag className="h-3.5 w-3.5 text-primary" /> Order Items
        </h2>

        <div className="divide-y divide-border/60">
          {order.order_items.map((item) => (
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
          <span>Total ({order.payment_method === "PAY_AT_PICKUP" ? "Pay at Counter" : "Paid"})</span>
          <span className="text-primary text-base">{formatPaise(order.total_paise)}</span>
        </div>
      </section>

      {/* Cancellation Section (Available only in PLACED stage) */}
      {cancellable && (
        <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
          {!showCancelConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-foreground">Need to cancel?</h3>
                <p className="text-[11px] text-muted-foreground">
                  Cancellations are allowed while kitchen preparation has not started.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelConfirm(true)}
                className="rounded-xl h-8 text-xs font-semibold"
              >
                Cancel Order
              </Button>
            </div>
          ) : (
            <div className="space-y-3 p-2 rounded-xl bg-destructive/10 border border-destructive/20 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Confirm Order Cancellation</span>
              </div>
              <p className="text-xs text-destructive/90">
                Are you sure you want to cancel order #{order.order_code}? This will release the food items back into stock.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isCancelling}
                  className="rounded-lg h-8 text-xs"
                >
                  Keep Order
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelOrder}
                  disabled={isCancelling}
                  className="rounded-lg h-8 text-xs font-semibold gap-1.5"
                >
                  {isCancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Navigation Links */}
      <div className="space-y-2 pt-2">
        <Link
          href="/orders"
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "w-full h-11 text-xs font-semibold rounded-xl gap-2 inline-flex items-center justify-center",
          })}
        >
          <span>View All Orders</span>
        </Link>
        <Link
          href="/menu"
          className={buttonVariants({
            variant: "ghost",
            size: "sm",
            className: "w-full h-9 text-xs font-semibold text-muted-foreground hover:text-foreground",
          })}
        >
          <UtensilsCrossed className="h-3.5 w-3.5 mr-1.5" />
          <span>Back to Menu</span>
        </Link>
      </div>
    </div>
  );
}
