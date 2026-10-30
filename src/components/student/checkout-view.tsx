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
  Zap,
  CalendarClock,
  ShieldCheck,
  CheckCircle2,
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
import { CelebrationOverlay } from "@/components/celebration/celebration-overlay";
import { getPlacedSessionKey, getTrackOrderPath } from "@/lib/celebration";
import {
  placeOrderAction,
  getPickupEstimateAction,
  getMyAccountStatusAction,
  type AccountStatusData,
} from "@/server/actions/order";

interface CheckoutViewProps {
  canteenId: string;
}

export function CheckoutView({ canteenId }: CheckoutViewProps) {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);
  const hasHydrated = useCartStore((s) => s.hasHydrated);

  // Placed order celebration state & navigation lock
  const [placedOrder, setPlacedOrder] = useState<{
    order_id: string;
    order_code: string;
    estimated_ready_at: string;
    total_paise: number;
  } | null>(null);
  const [frozenLineItems, setFrozenLineItems] = useState<
    Array<{
      cartItem: (typeof items)[number];
      detail: CartItemDetail | undefined;
      effectiveQty: number;
      lineTotal: number;
    }> | null
  >(null);
  const [isNavigating, setIsNavigating] = useState(false);

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

  // Account Status & Limits (Strikes & Active Order Cap)
  const [accountStatus, setAccountStatus] = useState<AccountStatusData | null>(null);

  useEffect(() => {
    getMyAccountStatusAction().then((res) => {
      if (res.success && res.data) {
        setAccountStatus(res.data);
      }
    });
  }, []);

  // 1. Load fresh prices and verify item availability
  useEffect(() => {
    if (!hasHydrated) return;

    if (items.length === 0) {
      if (!placedOrder) {
        router.replace("/menu");
      }
      return;
    }

    if (placedOrder) return;

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
  }, [hasHydrated, items, router, placedOrder]);

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

  // Calculate Subtotal & Total purely (preserving previous lineItems when placedOrder is active)
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

  const displayLineItems = placedOrder && frozenLineItems ? frozenLineItems : lineItems;
  const subtotalPaise = displayLineItems.reduce((acc, l) => acc + l.lineTotal, 0);
  const totalItemCount = displayLineItems.reduce((acc, l) => acc + l.effectiveQty, 0);
  const exceedsItemLimit = Boolean(accountStatus?.is_limited && totalItemCount > (accountStatus?.max_items_allowed ?? 2));
  const exceedsPriceLimit = Boolean(accountStatus?.is_limited && subtotalPaise > (accountStatus?.max_order_paise ?? 20000));
  const reachedActiveOrderLimit = Boolean(accountStatus && accountStatus.active_orders_count >= accountStatus.active_order_limit);

  // Prefetch order tracker page once order is placed
  useEffect(() => {
    if (placedOrder) {
      router.prefetch(getTrackOrderPath(placedOrder.order_id));
    }
  }, [placedOrder, router]);

  // Navigation handlers with double-click guard (isNavigating)
  const handleTrackOrder = useCallback(() => {
    if (isNavigating || !placedOrder) return;
    setIsNavigating(true);
    router.replace(getTrackOrderPath(placedOrder.order_id));
  }, [isNavigating, placedOrder, router]);

  const handleBackToMenu = useCallback(() => {
    if (isNavigating) return;
    setIsNavigating(true);
    router.replace("/menu");
  }, [isNavigating, router]);

  // 5. Submit Order Handler
  const handlePlaceOrder = async () => {
    if (isSubmitting || placedOrder) return;

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
        // Ensure no placed session flag is set so tracker never replays celebration
        try {
          sessionStorage.removeItem(getPlacedSessionKey(result.data.order_id));
        } catch {
          // Gracefully continue in storage-restricted environments
        }

        setFrozenLineItems(lineItems);
        setPlacedOrder({
          order_id: result.data.order_id,
          order_code: result.data.order_code,
          estimated_ready_at: result.data.estimated_ready_at,
          total_paise: result.data.total_paise,
        });

        clearCart();
        // Keep isSubmitting true: do NOT reset it on success
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

      if (result.code === "ACCOUNT_LIMITED") {
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

  if (!hasHydrated || (isLoadingDetails && !placedOrder)) {
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
    <>
      <div
        className="space-y-6 pb-24"
        inert={Boolean(placedOrder)}
        aria-hidden={Boolean(placedOrder)}
      >
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

      {/* Account Limit Proactive Alerts */}
      {accountStatus?.is_limited && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Account Limited ({accountStatus.strikes} uncollected {accountStatus.strikes === 1 ? "order" : "orders"})</span>
          </div>
          <p className="leading-relaxed">
            Due to uncollected orders within the 30-day window, your account is restricted to a maximum of {accountStatus.max_items_allowed ?? 2} items and {formatPaise(accountStatus.max_order_paise ?? 20000)} per order.
          </p>
          {(exceedsItemLimit || exceedsPriceLimit) && (
            <p className="font-semibold text-destructive mt-1">
              {exceedsItemLimit && `Your cart has ${totalItemCount} items (max ${accountStatus.max_items_allowed ?? 2}). `}
              {exceedsPriceLimit && `Subtotal is ${formatPaise(subtotalPaise)} (max ${formatPaise(accountStatus.max_order_paise ?? 20000)}). `}
              Please adjust your cart before proceeding.
            </p>
          )}
        </div>
      )}

      {reachedActiveOrderLimit && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 space-y-1 text-xs text-destructive">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Active Order Limit Reached</span>
          </div>
          <p className="leading-relaxed">
            You currently have {accountStatus?.active_orders_count} active orders (limit is {accountStatus?.active_order_limit}). Please collect your ready orders or wait for them to finish before placing a new one.
          </p>
        </div>
      )}

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
      <section className="rounded-3xl border border-border/80 bg-card p-4 sm:p-5 space-y-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Clock className="h-4 w-4" />
            </div>
            <span>Pickup Timing</span>
          </h2>
          {isEstimating ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Updating...</span>
            </span>
          ) : estimate ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-muted text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live Queue
            </span>
          ) : null}
        </div>

        {/* Tactile Mode Switcher Cards */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setMode("ASAP");
              setScheduledTimeString("");
              setIdempotencyKey(crypto.randomUUID());
              setNetworkErrorOccurred(false);
            }}
            className={`min-h-[56px] rounded-2xl p-3 text-left transition-all duration-200 flex items-center gap-3 border relative overflow-hidden active:scale-[0.98] ${
              mode === "ASAP"
                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-xs ring-1 ring-primary/20"
                : "border-border/80 bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            <div
              className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                mode === "ASAP"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Zap className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs sm:text-sm font-bold block ${
                    mode === "ASAP" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  ASAP
                </span>
                {mode === "ASAP" && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Earliest possible
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("SCHEDULED");
              setIdempotencyKey(crypto.randomUUID());
              setNetworkErrorOccurred(false);
            }}
            className={`min-h-[56px] rounded-2xl p-3 text-left transition-all duration-200 flex items-center gap-3 border relative overflow-hidden active:scale-[0.98] ${
              mode === "SCHEDULED"
                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-xs ring-1 ring-primary/20"
                : "border-border/80 bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            <div
              className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                mode === "SCHEDULED"
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <CalendarClock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs sm:text-sm font-bold block ${
                    mode === "SCHEDULED" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Schedule
                </span>
                {mode === "SCHEDULED" && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Today only
              </p>
            </div>
          </button>
        </div>

        {/* Schedule Time Picker (When Scheduled Mode Selected) */}
        {mode === "SCHEDULED" && (
          <div className="space-y-2.5 p-3.5 rounded-2xl border border-border/80 bg-muted/20 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <label htmlFor="scheduled-time" className="text-xs font-bold text-foreground">
                Desired Ready Time
              </label>
              <span className="text-[10px] font-medium text-muted-foreground">Today • 5-min steps</span>
            </div>
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
              className="w-full h-11 px-3.5 text-sm font-bold rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
            />
            {suggestedEarliestAt && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    Kitchen readiness conflict: Earliest achievable slot is{" "}
                    <strong>{formatTimeDisplay(suggestedEarliestAt)}</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleApplySuggestedTime}
                  className="w-full min-h-[44px] rounded-lg bg-amber-600 text-white dark:bg-amber-500 dark:text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs hover:opacity-90 active:scale-[0.98] transition-all"
                >
                  <Clock className="h-3.5 w-3.5" />
                  Use earliest time ({formatTimeDisplay(suggestedEarliestAt)})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Live Estimate Showcase: Large Hero-Style Card */}
        <div className="rounded-2xl border border-border/80 bg-gradient-to-b from-muted/30 via-card to-card p-4 sm:p-5 space-y-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Estimated Ready Time
            </span>
            {estimate && !isEstimating && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                <Zap className="h-3 w-3" />
                ~{estimate.prepMinutesTotal} min prep
              </span>
            )}
          </div>

          <div>
            {isEstimating ? (
              <div className="space-y-2 py-1">
                <div className="h-10 w-44 rounded-xl bg-muted animate-pulse" />
                <div className="h-4 w-60 rounded bg-muted/60 animate-pulse" />
              </div>
            ) : estimate ? (
              <div>
                <div className="text-3xl sm:text-4xl font-black tracking-tight text-foreground flex items-baseline gap-2">
                  <span>Ready by {formatTimeDisplay(estimate.estimatedReadyAt)}</span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-normal">
                    (approx)
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted/30 px-3 py-2 rounded-xl border border-border/50">
                    <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>
                      Window: <strong className="text-foreground font-semibold">{formatTimeDisplay(estimate.estimatedReadyAt)} – {formatTimeDisplay(estimate.pickupWindowEnd)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground bg-muted/30 px-3 py-2 rounded-xl border border-border/50">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>Kept warm for <strong>15 min</strong></span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                Timing estimate unavailable
              </p>
            )}
          </div>

          {/* Stale Estimate Warning Card & Unique Tactile Refresh Button */}
          {isEstimateStale && (
            <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Estimate was calculated &gt;3 min ago
                  </p>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                    Live queue may have shifted. Refresh for the freshest time.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fetchEstimate(requestedAtIso)}
                disabled={isEstimating}
                className="min-h-[44px] px-4 py-2 rounded-xl font-bold text-xs bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-zinc-950 shadow-xs flex items-center justify-center gap-2 shrink-0 active:scale-95 transition-all duration-150"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${isEstimating ? "animate-spin" : ""}`} />
                <span>{isEstimating ? "Refreshing..." : "Refresh Estimate"}</span>
              </button>
            </div>
          )}

          {estimateError && (
            <p className="text-xs text-destructive font-medium pt-1">
              {estimateError}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60 italic flex items-center gap-1.5">
            <span>ℹ️</span>
            <span>Final ready time is confirmed upon placing order based on current queue load.</span>
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
        <h2 className="text-sm font-bold">Order Items ({displayLineItems.length})</h2>
        <div className="divide-y divide-border/60">
          {displayLineItems.map(({ cartItem, detail, effectiveQty, lineTotal }) => (
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
          disabled={
            isSubmitting ||
            Boolean(placedOrder) ||
            isEstimating ||
            (mode === "SCHEDULED" && !scheduledTimeString) ||
            exceedsItemLimit ||
            exceedsPriceLimit ||
            reachedActiveOrderLimit
          }
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

    {/* Celebration Overlay mounted directly on Checkout */}
    {placedOrder && (
      <CelebrationOverlay
        isOpen={true}
        order={placedOrder}
        heading="Order placed successfully!"
        dismissOnBackdrop={false}
        isNavigating={isNavigating}
        onClose={handleTrackOrder}
        onBackToMenu={handleBackToMenu}
      />
    )}
  </>
  );
}
