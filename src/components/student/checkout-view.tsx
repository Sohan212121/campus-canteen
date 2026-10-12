"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Clock,
  Wallet,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPaise } from "@/lib/money";
import { useCartStore } from "@/lib/cart-store";
import {
  getCartItemDetailsAction,
  type CartItemDetail,
} from "@/server/actions/cart";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import {
  placeOrderAction,
  getPickupEstimateAction,
} from "@/server/actions/order";

interface CheckoutViewProps {
  canteenId: string;
}

export function CheckoutView({ canteenId }: CheckoutViewProps) {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const hasHydrated = useCartStore((s) => s.hasHydrated);

  // Fresh server data
  const [serverDetails, setServerDetails] = useState<Record<string, CartItemDetail>>({});
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);

  // Pickup mode: "ASAP" | "SCHEDULED"
  const [mode, setMode] = useState<"ASAP" | "SCHEDULED">("ASAP");
  const [scheduledTimeString, setScheduledTimeString] = useState<string>("");

  // Live estimate state
  const [estimate, setEstimate] = useState<{
    estimatedReadyAt: string;
    pickupWindowEnd: string;
    prepMinutesTotal: number;
    fetchedAt: number;
  } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [isEstimateStale, setIsEstimateStale] = useState(false);

  // Idempotency & submission state
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [networkErrorOccurred, setNetworkErrorOccurred] = useState(false);
  const [suggestedEarliestAt, setSuggestedEarliestAt] = useState<string | null>(null);

  // 1. Load fresh prices and verify item availability
  useEffect(() => {
    if (!hasHydrated) return;

    if (items.length === 0) {
      router.replace("/menu");
      return;
    }

    let ignore = false;
    const itemIds = items.map((i) => i.menu_item_id);

    async function loadFreshDetails() {
      setIsLoadingDetails(true);
      const res = await getCartItemDetailsAction(itemIds);
      if (ignore) return;

      if (res.success && res.data) {
        const map: Record<string, CartItemDetail> = {};
        let hasUnavailable = false;

        res.data.forEach((item) => {
          map[item.id] = item;
          if (!item.is_active || !item.is_available || (item.stock !== null && item.stock <= 0)) {
            hasUnavailable = true;
          }
        });

        setServerDetails(map);

        if (hasUnavailable || res.data.length < itemIds.length) {
          toast.error("Some items became unavailable. Please review your cart.");
          router.replace("/cart");
          return;
        }
      } else {
        toast.error("Could not load fresh item details.");
        router.replace("/cart");
      }
      setIsLoadingDetails(false);
    }

    loadFreshDetails();
    return () => {
      ignore = true;
    };
  }, [hasHydrated, items, router]);

  // Format today's date in IST (YYYY-MM-DD)
  const todayIstString = useMemo(() => {
    const now = new Date();
    // Offset by +05:30
    const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return istTime.toISOString().split("T")[0];
  }, []);

  // Build full IST ISO string for scheduled pickup
  const requestedAtIso = useMemo(() => {
    if (mode !== "SCHEDULED" || !scheduledTimeString) {
      return null;
    }
    return `${todayIstString}T${scheduledTimeString}:00+05:30`;
  }, [mode, scheduledTimeString, todayIstString]);

  // 2. Fetch Readiness Estimate (debounced)
  const fetchEstimate = useCallback(
    async (targetRequestedAt: string | null) => {
      if (items.length === 0) return;
      setIsEstimating(true);
      setEstimateError(null);

      const res = await getPickupEstimateAction(
        canteenId,
        items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity })),
        targetRequestedAt
      );

      if (res.success && res.data) {
        setEstimate({
          estimatedReadyAt: res.data.estimated_ready_at,
          pickupWindowEnd: res.data.pickup_window_end,
          prepMinutesTotal: res.data.prep_minutes_total,
          fetchedAt: Date.now(),
        });
        setIsEstimateStale(false);
        setSuggestedEarliestAt(null);
      } else {
        setEstimateError(res.error || "Could not fetch estimate.");
        if (res.code === "SCHEDULE_TOO_EARLY" && res.suggestedEarliestAt) {
          setSuggestedEarliestAt(res.suggestedEarliestAt);
        }
      }
      setIsEstimating(false);
    },
    [canteenId, items]
  );

  // Debounced estimate trigger on mode or scheduled time change
  useEffect(() => {
    if (isLoadingDetails || items.length === 0) return;

    const timer = setTimeout(() => {
      fetchEstimate(requestedAtIso);
    }, 400);

    return () => clearTimeout(timer);
  }, [requestedAtIso, fetchEstimate, isLoadingDetails, items.length]);

  // 3. Stale Estimate Checker (Check if 3 minutes have passed since last estimate)
  useEffect(() => {
    if (!estimate) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - estimate.fetchedAt;
      if (elapsed > 180000) {
        // 3 minutes
        setIsEstimateStale(true);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [estimate]);

  // Helper to format ISO time in IST (HH:MM AM/PM)
  const formatTimeDisplay = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return isoString;
    }
  };

  // Calculate Subtotal & Total purely
  const lineItems = useMemo(() => {
    return items.map((cartItem) => {
      const detail = serverDetails[cartItem.menu_item_id];
      const effectiveQty = detail?.stock !== null && detail?.stock !== undefined
        ? Math.min(cartItem.quantity, detail.stock)
        : cartItem.quantity;
      const lineTotal = (detail?.price_paise ?? 0) * effectiveQty;

      return {
        cartItem,
        detail,
        effectiveQty,
        lineTotal,
      };
    });
  }, [items, serverDetails]);

  const subtotalPaise = lineItems.reduce((acc, l) => acc + l.lineTotal, 0);

  // 5. Submit Order Handler
  const handlePlaceOrder = async () => {
    if (isSubmitting) return;

    // Immediately disable button to prevent double-clicks
    setIsSubmitting(true);
    setNetworkErrorOccurred(false);

    try {
      const payload = {
        canteenId,
        items: lineItems.map((l) => ({
          menu_item_id: l.cartItem.menu_item_id,
          quantity: l.effectiveQty,
        })),
        paymentMethod: "PAY_AT_PICKUP" as const,
        idempotencyKey,
        requestedAt: requestedAtIso,
      };

      const result = await placeOrderAction(payload);

      if (result.success && result.data) {
        toast.success("Order placed successfully!");
        clearCart();
        router.replace(`/orders/${result.data.order_id}`);
        return;
      }

      // Handle specific error codes
      if (result.code === "SCHEDULE_TOO_EARLY") {
        toast.error(result.error);
        if (result.suggestedEarliestAt) {
          setSuggestedEarliestAt(result.suggestedEarliestAt);
        }
        setIsSubmitting(false);
        return;
      }

      if (result.code === "STOCK_CHANGED") {
        toast.error(result.error || "Menu stock changed. Returning to cart.");
        router.replace("/cart");
        return;
      }

      if (result.code === "TOO_MANY_ACTIVE_ORDERS") {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      if (result.code === "DATABASE_MIGRATION_REQUIRED") {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      toast.error(result.error || "Failed to place order.");
      // Regenerate idempotency key on logical rejection
      setIdempotencyKey(crypto.randomUUID());
      setIsSubmitting(false);
    } catch {
      // Network drop / unexpected client disconnection
      setNetworkErrorOccurred(true);
      setIsSubmitting(false);
    }
  };

  // Helper to accept suggested earliest time
  const handleApplySuggestedTime = () => {
    if (!suggestedEarliestAt) return;
    try {
      const date = new Date(suggestedEarliestAt);
      const istHours = date.toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        hour12: false,
      });
      const istMinutes = date.toLocaleString("en-US", {
        timeZone: "Asia/Kolkata",
        minute: "2-digit",
      });
      setScheduledTimeString(`${istHours}:${istMinutes}`);
      setSuggestedEarliestAt(null);
    } catch {
      toast.info("Please pick the suggested time in the picker.");
    }
  };

  if (!hasHydrated || isLoadingDetails) {
    return (
      <div className="space-y-5 py-4 animate-in fade-in duration-150" aria-label="Preparing checkout">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-muted animate-pulse" />
          <div className="h-6 w-32 rounded-lg bg-muted animate-pulse" />
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
          <div className="h-5 w-28 bg-muted animate-pulse rounded" />
          <div className="grid grid-cols-2 gap-2 h-11">
            <div className="rounded-lg bg-muted animate-pulse" />
            <div className="rounded-lg bg-muted animate-pulse" />
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-2">
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          <div className="h-10 w-full bg-muted animate-pulse rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
          <div className="h-4 w-28 bg-muted animate-pulse rounded" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
          </div>
        </div>
        <div className="h-12 w-full rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Top Navigation */}
      <div className="flex items-center gap-2">
        <Link
          href="/cart"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to Cart"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Checkout</h1>
      </div>

      {/* Network Error Retry Card */}
      {networkErrorOccurred && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 space-y-3">
          <div className="flex items-start gap-2.5 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">We could not confirm your order</p>
              <p className="opacity-90 leading-relaxed">
                A connection problem occurred while contacting the server. Tap to retry. This will safely reuse your order token and will not create a duplicate.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={handlePlaceOrder}
            disabled={isSubmitting}
            className="w-full min-h-[44px] h-11 font-bold text-xs sm:text-sm gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Tap to Retry Order
          </Button>
        </div>
      )}

      {/* Mode Selector: ASAP vs Schedule */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" />
          Pickup Timing
        </h2>

        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted/40 border border-border">
          <button
            type="button"
            onClick={() => {
              setMode("ASAP");
              setScheduledTimeString("");
              setIdempotencyKey(crypto.randomUUID());
              setNetworkErrorOccurred(false);
            }}
            className={`min-h-[44px] rounded-lg text-xs font-semibold transition-all flex flex-col items-center justify-center ${
              mode === "ASAP"
                ? "bg-card text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>ASAP</span>
            <span className="text-[10px] font-normal opacity-75">Earliest possible</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("SCHEDULED");
              setIdempotencyKey(crypto.randomUUID());
              setNetworkErrorOccurred(false);
            }}
            className={`min-h-[44px] rounded-lg text-xs font-semibold transition-all flex flex-col items-center justify-center ${
              mode === "SCHEDULED"
                ? "bg-card text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>Schedule for later</span>
            <span className="text-[10px] font-normal opacity-75">Today only</span>
          </button>
        </div>

        {/* Schedule Time Picker */}
        {mode === "SCHEDULED" && (
          <div className="space-y-2 pt-2 border-t border-border animate-in fade-in duration-150">
            <label htmlFor="scheduled-time" className="text-xs font-medium text-muted-foreground block">
              Select desired ready time (Today, 5-min steps):
            </label>
            <input
              id="scheduled-time"
              type="time"
              step="300"
              value={scheduledTimeString}
              onChange={(e) => {
                setScheduledTimeString(e.target.value);
                setIdempotencyKey(crypto.randomUUID());
                setNetworkErrorOccurred(false);
              }}
              className="w-full h-11 px-3 text-sm font-semibold rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {suggestedEarliestAt && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
                <p>
                  Requested time is earlier than kitchen readiness. Earliest possible is{" "}
                  <strong>{formatTimeDisplay(suggestedEarliestAt)}</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleApplySuggestedTime}
                  className="font-bold underline hover:no-underline text-primary min-h-[44px] inline-flex items-center"
                >
                  Use earliest available time ({formatTimeDisplay(suggestedEarliestAt)})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live Estimate Preview */}
        <div className="rounded-xl bg-muted/30 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated Ready Time:</span>
            {isEstimating ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> Calculating...
              </span>
            ) : estimate ? (
              <span className="font-bold text-foreground text-sm">
                Ready by {formatTimeDisplay(estimate.estimatedReadyAt)} (approx.)
              </span>
            ) : (
              <span className="text-muted-foreground">Unavailable</span>
            )}
          </div>

          {estimate && (
            <p className="text-[11px] text-muted-foreground">
              Pickup window: {formatTimeDisplay(estimate.estimatedReadyAt)} – {formatTimeDisplay(estimate.pickupWindowEnd)} (kept warm for 15 min).
            </p>
          )}

          {isEstimateStale && (
            <div className="pt-1 flex items-center justify-between text-[11px] text-amber-600 dark:text-amber-400 font-medium">
              <span>Estimate was calculated &gt;3 min ago.</span>
              <button
                type="button"
                onClick={() => fetchEstimate(requestedAtIso)}
                className="underline font-bold min-h-[44px] inline-flex items-center px-2 -mr-2"
              >
                Refresh
              </button>
            </div>
          )}

          {estimateError && (
            <p className="text-[11px] text-destructive font-medium pt-1">
              {estimateError}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/60 italic">
            Note: Final ready time is confirmed upon placing order based on current queue load.
          </p>
        </div>
      </section>

      {/* Payment Method Card */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-2 shadow-2xs">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <Wallet className="h-4 w-4 text-primary" />
          Payment Method
        </h2>
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
          <div className="space-y-0.5">
            <p className="font-semibold text-xs sm:text-sm">Pay at Pickup</p>
            <p className="text-[11px] text-muted-foreground">
              Pay via UPI or Cash directly at the canteen counter.
            </p>
          </div>
          <Badge variant="outline" className="border-primary/40 text-primary font-bold text-[10px]">
            Fixed
          </Badge>
        </div>
      </section>

      {/* Order Summary Lines */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-sm font-bold">Order Items ({lineItems.length})</h2>
        <div className="divide-y divide-border/60">
          {lineItems.map(({ cartItem, detail, effectiveQty, lineTotal }) => (
            <div key={cartItem.menu_item_id} className="py-2.5 flex items-center justify-between text-xs gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60">
                  <MenuItemImage
                    src={detail?.image_url}
                    alt={detail?.name ?? "Item"}
                    aspect="square"
                    sizes="44px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{detail?.name ?? "Item"}</p>
                  <p className="text-muted-foreground text-[11px]">
                    {effectiveQty} &times; {formatPaise(detail?.price_paise ?? 0)}
                  </p>
                </div>
              </div>
              <span className="font-bold text-foreground shrink-0">
                {formatPaise(lineTotal)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-border pt-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="font-medium text-foreground">{formatPaise(subtotalPaise)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Pre-order fee</span>
            <span className="font-medium text-foreground">₹0</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-border/60">
            <span>To Pay at Counter</span>
            <span className="text-primary">{formatPaise(subtotalPaise)}</span>
          </div>
        </div>
      </section>

      {/* Place Order CTA */}
      <div className="space-y-2 pt-2">
        <Button
          type="button"
          onClick={handlePlaceOrder}
          disabled={isSubmitting || isEstimating || (mode === "SCHEDULED" && !scheduledTimeString)}
          className="w-full h-12 text-base font-semibold shadow-xs gap-2"
        >
          {isSubmitting ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Placing Order...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              <span>Place Order &bull; {formatPaise(subtotalPaise)}</span>
            </>
          )}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          By placing your order, you agree to collect it within the 15-minute pickup window.
        </p>
      </div>
    </div>
  );
}
