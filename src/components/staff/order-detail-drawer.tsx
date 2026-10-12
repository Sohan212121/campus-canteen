"use client";

import { useState } from "react";
import Link from "next/link";
import {
  X,
  Clock,
  User,
  ShoppingBag,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Loader2,
  CookingPot,
  Check,
  Ban,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPaise } from "@/lib/money";
import {
  formatIstTime,
  formatIstDateTime,
  getStatusBadgeConfig,
  calculateStartPreparingBy,
} from "@/lib/order-status";
import {
  type BoardOrder,
  type StaffOrderStatus,
  transitionOrderAction,
} from "@/server/actions/staff";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { cn } from "@/lib/utils";

interface OrderDetailDrawerProps {
  order: BoardOrder | null;
  onClose: () => void;
  onOrderUpdated: () => void;
}

export function OrderDetailDrawer({
  order,
  onClose,
  onOrderUpdated,
}: OrderDetailDrawerProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  if (!order) return null;

  const badge = getStatusBadgeConfig(order.status);
  const startPrepBy = calculateStartPreparingBy(
    order.estimated_ready_at,
    order.prep_minutes_total
  );

  const handleTransition = async (toStatus: StaffOrderStatus) => {
    setIsUpdating(true);
    setShowRejectConfirm(false);

    try {
      const res = await transitionOrderAction(order.id, toStatus);
      if (!res.success) {
        toast.error(res.error || "Failed to update order status");
      } else {
        toast.success(
          res.was_noop
            ? `Order #${order.order_code} is already ${toStatus}`
            : `Order #${order.order_code} updated to ${toStatus}`
        );
        onOrderUpdated();
        onClose();
      }
    } catch {
      toast.error("Network error updating order");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-drawer-title"
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      {/* Backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer content */}
      <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-background p-5 shadow-2xl border-l border-border animate-in slide-in-from-right duration-200 overflow-y-auto">
        {/* Drawer Header */}
        <div className="flex items-start justify-between pb-3 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="order-drawer-title" className="text-lg font-black tracking-tight">
                Order #{order.order_code}
              </h2>
              <Badge variant={badge.variant} className={cn("text-[10px]", badge.className)}>
                {badge.label}
              </Badge>
              {order.is_stale && (
                <Badge variant="destructive" className="text-[9px]">
                  Stale
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed on {formatIstDateTime(order.placed_at)}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Customer & Timing info */}
        <div className="space-y-4 py-4 text-xs">
          <div className="rounded-xl border border-border/70 bg-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                <User className="h-3.5 w-3.5 text-primary" /> Customer:
              </span>
              <span className="font-bold text-foreground text-sm">{order.customer_name}</span>
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" /> Expected Ready:
              </span>
              <span className="font-bold text-foreground">
                {formatIstTime(order.estimated_ready_at)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Start Preparing By:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {startPrepBy}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Est. Prep Time:</span>
              <span className="font-medium text-foreground">
                ~{order.prep_minutes_total} mins
              </span>
            </div>
          </div>

          {/* Itemized list */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ShoppingBag className="h-3.5 w-3.5 text-primary" /> Ordered Items ({order.order_items.length})
            </h3>

            <div className="rounded-xl border border-border/70 bg-card divide-y divide-border/60">
              {order.order_items.map((item) => (
                <div key={item.id} className="p-3 flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60">
                      <MenuItemImage
                        src={item.image_url}
                        alt={item.name_snapshot}
                        aspect="square"
                        sizes="40px"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm leading-snug truncate">
                        {item.quantity} &times; {item.name_snapshot}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {formatPaise(item.unit_price_paise)} each
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-foreground shrink-0">
                    {formatPaise(item.unit_price_paise * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-1 pt-1 font-bold">
              <span>Total Payable</span>
              <span className="text-base text-primary">{formatPaise(order.total_paise)}</span>
            </div>

            <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
              <span>Payment Mode:</span>
              <Badge
                variant={order.payment_status === "PAID" ? "default" : "secondary"}
                className={cn(
                  "text-[10px]",
                  order.payment_status === "PAID"
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-500/20 text-amber-800 dark:text-amber-200"
                )}
              >
                {order.payment_status === "PAID" ? "PAID" : "COLLECT CASH AT PICKUP"}
              </Badge>
            </div>
          </div>
        </div>

        {/* Action Buttons Section */}
        <div className="mt-auto pt-4 border-t border-border space-y-2">
          {order.status === "PLACED" && !showRejectConfirm && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="destructive"
                size="lg"
                onClick={() => setShowRejectConfirm(true)}
                disabled={isUpdating}
                className="col-span-1 rounded-xl text-xs font-semibold h-12"
              >
                <Ban className="h-4 w-4 mr-1" />
                Reject
              </Button>

              <Button
                size="lg"
                onClick={() => handleTransition("ACCEPTED")}
                disabled={isUpdating}
                className="col-span-2 rounded-xl text-xs font-bold h-12 shadow-sm gap-2"
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 stroke-[2.5]" />
                )}
                <span>Accept Order</span>
              </Button>
            </div>
          )}

          {order.status === "PLACED" && showRejectConfirm && (
            <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Reject Order #{order.order_code}?</span>
              </div>
              <p className="text-[11px] text-destructive/90">
                This will reject the pre-order and restore item inventory stock immediately.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRejectConfirm(false)}
                  disabled={isUpdating}
                  className="h-8 text-xs rounded-lg"
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleTransition("REJECTED")}
                  disabled={isUpdating}
                  className="h-8 text-xs font-bold rounded-lg"
                >
                  {isUpdating && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Confirm Reject
                </Button>
              </div>
            </div>
          )}

          {order.status === "ACCEPTED" && (
            <Button
              size="lg"
              onClick={() => handleTransition("PREPARING")}
              disabled={isUpdating}
              className="w-full rounded-xl text-sm font-bold h-12 shadow-sm gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CookingPot className="h-4 w-4" />
              )}
              <span>Start Preparing</span>
            </Button>
          )}

          {order.status === "PREPARING" && (
            <Button
              size="lg"
              onClick={() => handleTransition("READY")}
              disabled={isUpdating}
              className="w-full rounded-xl text-sm font-bold h-12 shadow-sm gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>Mark Ready for Pickup</span>
            </Button>
          )}

          {order.status === "READY" && (
            <Link
              href="/staff/pickup"
              className={buttonVariants({
                size: "lg",
                className: "w-full rounded-xl text-sm font-bold h-12 shadow-sm gap-2 bg-primary text-primary-foreground",
              })}
            >
              <QrCode className="h-4 w-4" />
              <span>Verify & Collect (Scan Token)</span>
            </Link>
          )}

          {["COLLECTED", "REJECTED", "CANCELLED"].includes(order.status) && (
            <div className="rounded-xl bg-muted/60 p-3 text-center text-xs font-medium text-muted-foreground">
              Order is finalized ({order.status.toLowerCase()}). No further kitchen action required.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
