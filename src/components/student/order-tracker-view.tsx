"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Clock,
  AlertCircle,
  RotateCcw,
  Store,
  Receipt,
  Loader2,
  KeyRound,
  ShieldAlert,
  X,
  RefreshCw,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatPaise } from "@/lib/money";
import { useCartStore } from "@/lib/cart-store";
import {
  formatIstTime,
  formatIstDateTime,
  isOrderCancellable,
  getStatusBadgeConfig,
  ORDER_LIFECYCLE_STEPS,
} from "@/lib/order-status";
import {
  cancelOrderAction,
  getReorderItemsAction,
  reportUnauthorizedCollectionAction,
} from "@/server/actions/order";
import {
  computeExpiresAtMonotonic,
  calculateSecondsRemaining,
  calculateNextRefreshDelayMs,
} from "@/lib/pickup-countdown";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { RateOrderItemsSection } from "@/components/student/rate-order-items-section";
import { cn } from "@/lib/utils";

export interface PickupCodeData {
  order_id: string;
  order_code: string;
  code: string;
  seconds_remaining: number;
  pin: string;
  pickup_for_name?: string | null;
}

export interface PickupErrorInfo {
  message: string;
  isAuthError?: boolean;
  canRetryManually?: boolean;
}

export interface OrderDetailData {
  id: string;
  order_code: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total_paise: number;
  pickup_for_name?: string | null;
  placed_at: string;
  ready_at?: string | null;
  collected_at?: string | null;
  requested_pickup_at: string | null;
  estimated_ready_at: string;
  pickup_window_end: string;
  canteens: {
    name: string;
    location: string | null;
    hold_minutes?: number;
  } | null;
  order_items: Array<{
    id: string;
    menu_item_id: string;
    name_snapshot: string;
    unit_price_paise: number;
    quantity: number;
    image_url?: string | null;
  }>;
}

interface OrderTrackerViewProps {
  initialOrder: OrderDetailData;
}

export function OrderTrackerView({ initialOrder }: OrderTrackerViewProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetailData>(initialOrder);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Dynamic TOTP code & countdown state for READY orders
  const [pickupData, setPickupData] = useState<PickupCodeData | null>(null);
  const [expiresAtPerf, setExpiresAtPerf] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [pickupError, setPickupError] = useState<PickupErrorInfo | null>(null);
  const [isPickupLoading, setIsPickupLoading] = useState<boolean>(false);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<string>("");
  const [holdRemainingSeconds, setHoldRemainingSeconds] = useState<number | null>(null);

  // Hold window countdown effect
  useEffect(() => {
    if (order.status !== "READY") {
      return;
    }

    const holdMins = order.canteens?.hold_minutes ?? 15;
    const baseMs = order.ready_at ? new Date(order.ready_at).getTime() : new Date(order.pickup_window_end).getTime();
    const expiryMs = order.ready_at ? baseMs + holdMins * 60 * 1000 : baseMs;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      setHoldRemainingSeconds(remaining);
      if (remaining === 0 && order.status === "READY") {
        setOrder((prev) => ({ ...prev, status: "NO_SHOW" }));
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [order.status, order.ready_at, order.pickup_window_end, order.canteens?.hold_minutes]);

  // Refs for StrictMode, race conditions, request sequencing, and retries
  const isFetchingRef = useRef<boolean>(false);
  const requestIdRef = useRef<number>(0);
  const sameCodeRetryCountRef = useRef<number>(0);
  const networkRetryCountRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestOrderRef = useRef(order);
  const fetchPickupCodeRef = useRef<((isManualRetry?: boolean) => Promise<void>) | null>(null);

  // Sync latest order into ref safely in an effect
  useEffect(() => {
    latestOrderRef.current = order;
  }, [order]);

  // Adjust state during render when status leaves READY (per React 19 recommended pattern)
  const [prevStatus, setPrevStatus] = useState(order.status);
  if (order.status !== prevStatus) {
    setPrevStatus(order.status);
    if (order.status !== "READY") {
      setPickupData(null);
      setExpiresAtPerf(null);
      setPickupError(null);
      setIsPickupLoading(false);
      setHoldRemainingSeconds(null);
    }
  }

  // Dispute "Not Me" modal state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [hasDisputed, setHasDisputed] = useState(false);

  // Realtime updates subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`order_realtime_${order.id}`)
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
              collected_at: updated.collected_at || prev.collected_at,
            }));
          }
        }
      )
      .subscribe();

    const intervalId = window.setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;

      const { data } = await supabase
        .from("orders")
        .select("status, estimated_ready_at, pickup_window_end, payment_status, collected_at")
        .eq("id", order.id)
        .maybeSingle();

      if (data) {
        setOrder((prev) => ({
          ...prev,
          status: data.status,
          estimated_ready_at: data.estimated_ready_at,
          pickup_window_end: data.pickup_window_end,
          payment_status: data.payment_status,
          collected_at: data.collected_at,
        }));
      }
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [order.id]);

  const isReady = order.status === "READY";

  const fetchPickupCode = useCallback(async (isManualRetry = false) => {
    const currentOrder = latestOrderRef.current;
    if (currentOrder.status !== "READY") return;

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsPickupLoading(true);

    if (isManualRetry) {
      networkRetryCountRef.current = 0;
      sameCodeRetryCountRef.current = 0;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 8000);

    const thisRequestId = ++requestIdRef.current;

    try {
      const response = await fetch(`/api/orders/${currentOrder.id}/pickup-code`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      if (
        thisRequestId !== requestIdRef.current ||
        latestOrderRef.current.status !== "READY" ||
        latestOrderRef.current.id !== currentOrder.id
      ) {
        return;
      }

      if (response.status === 401) {
        setPickupError({
          message: "Please sign in again to view your pickup code.",
          isAuthError: true,
          canRetryManually: false,
        });
        setPickupData(null);
        setExpiresAtPerf(null);
        return;
      }

      if (response.status === 403) {
        setPickupError({
          message: "You do not have permission to view this order's pickup code.",
          isAuthError: false,
          canRetryManually: false,
        });
        setPickupData(null);
        setExpiresAtPerf(null);
        return;
      }

      if (response.status === 404) {
        setPickupError({
          message: "Pickup code details could not be found.",
          isAuthError: false,
          canRetryManually: false,
        });
        setPickupData(null);
        setExpiresAtPerf(null);
        return;
      }

      let json: { ok: boolean; code?: string; error?: string; data?: PickupCodeData };
      try {
        json = await response.json();
      } catch {
        throw new Error("Invalid response from server");
      }

      if (!response.ok || !json.ok) {
        let message = json?.error || "Pickup code is currently unavailable.";
        let canRetryManually = true;
        if (errCode === "ORDER_NOT_READY") {
          message = "Order is not ready for pickup yet. Please wait for the canteen to call your order.";
        } else if (errCode === "ALREADY_COLLECTED") {
          message = "This order has already been collected.";
          canRetryManually = false;
        } else if (errCode === "PICKUP_EXPIRED") {
          message = "Pickup window has expired. This order was marked as uncollected.";
          canRetryManually = false;
        } else if (errCode === "PICKUP_UNAVAILABLE") {
          message = "Counter pickup verification is temporarily unavailable. Please show your order code to staff.";
        } else if (errCode === "NO_PICKUP_SECRET") {
          message = "Digital pickup code could not be verified. Please collect directly at the counter.";
        }

        setPickupError({
          message,
          canRetryManually,
        });
        setPickupData(null);
        setExpiresAtPerf(null);
        return;
      }

      const newData = json.data;
      if (!newData || !newData.code) {
        throw new Error("Incomplete pickup code data received");
      }

      // Check if server returned identical code as before (fetched slightly early)
      if (pickupData && newData.code === pickupData.code && sameCodeRetryCountRef.current < 3) {
        sameCodeRetryCountRef.current++;
        window.setTimeout(() => {
          fetchPickupCodeRef.current?.();
        }, 1000);
        return;
      }

      sameCodeRetryCountRef.current = 0;
      networkRetryCountRef.current = 0;

      const nowPerf = performance.now();
      const expiresAt = computeExpiresAtMonotonic(newData.seconds_remaining, nowPerf);

      setPickupData(newData);
      setPickupError(null);
      setExpiresAtPerf(expiresAt);
      setSecondsRemaining(calculateSecondsRemaining(expiresAt, nowPerf));

      // Trigger screen reader live announcement only when code rotates
      setScreenReaderAnnouncement("Code refreshed");
    } catch (err: unknown) {
      window.clearTimeout(timeoutId);

      if (
        thisRequestId !== requestIdRef.current ||
        latestOrderRef.current.status !== "READY" ||
        latestOrderRef.current.id !== currentOrder.id
      ) {
        return;
      }

      if (err instanceof DOMException && err.name === "AbortError" && thisRequestId !== requestIdRef.current) {
        return;
      }

      const currentNetworkRetries = networkRetryCountRef.current;
      if (currentNetworkRetries < 3) {
        const backoffDelays = [3000, 6000, 12000];
        const nextDelay = backoffDelays[currentNetworkRetries] ?? 12000;
        networkRetryCountRef.current = currentNetworkRetries + 1;

        setPickupError({
          message: "Can't refresh the code. Retrying...",
          canRetryManually: false,
        });

        window.setTimeout(() => {
          fetchPickupCodeRef.current?.();
        }, nextDelay);
      } else {
        setPickupError({
          message: "Unable to refresh pickup code. Please check your connection.",
          canRetryManually: true,
        });
      }
    } finally {
      isFetchingRef.current = false;
      setIsPickupLoading(false);
    }
  }, [pickupData]);

  // Keep fetchPickupCodeRef in sync
  useEffect(() => {
    fetchPickupCodeRef.current = fetchPickupCode;
  }, [fetchPickupCode]);

  // Initial fetch when status becomes READY or order.id changes
  useEffect(() => {
    if (!isReady) {
      isFetchingRef.current = false;
      requestIdRef.current++;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      return;
    }

    fetchPickupCodeRef.current?.();

    return () => {
      // Cleanup: avoid leaving isFetchingRef stuck in StrictMode!
      isFetchingRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [isReady, order.id]);

  // Pure countdown display interval (zero network calls, pure monotonic calculation)
  useEffect(() => {
    if (!isReady || expiresAtPerf === null) return;

    const intervalId = window.setInterval(() => {
      setSecondsRemaining(calculateSecondsRemaining(expiresAtPerf));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isReady, expiresAtPerf]);

  // Schedule next refresh right after expiry (+1000ms buffer, clamped 1000-61000ms)
  useEffect(() => {
    if (!isReady || expiresAtPerf === null) return;

    const delay = calculateNextRefreshDelayMs(expiresAtPerf);
    const timerId = window.setTimeout(() => {
      fetchPickupCode();
    }, delay);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isReady, expiresAtPerf, fetchPickupCode]);

  // Refresh immediately when tab becomes visible if code is expired
  useEffect(() => {
    if (!isReady) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const remaining = calculateSecondsRemaining(expiresAtPerf);
        if (expiresAtPerf === null || remaining <= 0) {
          fetchPickupCode();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isReady, expiresAtPerf, fetchPickupCode]);

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

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disputeReason.trim().length < 5) {
      toast.error("Please explain the issue with at least 5 characters.");
      return;
    }

    setIsSubmittingDispute(true);
    try {
      const res = await reportUnauthorizedCollectionAction(order.id, disputeReason.trim());
      if (res.success) {
        setHasDisputed(true);
        setShowDisputeModal(false);
        toast.success("Dispute reported to canteen admin. We are investigating this collection.");
      } else {
        toast.error(res.error || "Failed to file report");
      }
    } catch {
      toast.error("Network error submitting dispute");
    } finally {
      setIsSubmittingDispute(false);
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
  const cancellable = isOrderCancellable(order.status);

  return (
    <div className="space-y-5 pb-16 max-w-lg mx-auto">
      {/* Top Breadcrumb & Status Header */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/orders"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>&larr; Back to My Orders</span>
        </Link>
        <Badge variant={badgeConfig.variant} className={cn("text-xs font-bold", badgeConfig.className)}>
          {badgeConfig.label}
        </Badge>
      </div>

      {/* Main Order Identification Card */}
      <section className="rounded-2xl border border-border/80 bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Order Reference
            </p>
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              #{order.order_code}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed {formatIstDateTime(order.placed_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Amount
            </p>
            <p className="text-xl font-black text-primary">
              {formatPaise(order.total_paise)}
            </p>
            <Badge variant="outline" className="text-[10px] font-semibold mt-0.5">
              {order.payment_method === "PAY_AT_PICKUP" ? "Pay at Counter" : order.payment_method}
            </Badge>
          </div>
        </div>
      </section>

      {/* Dynamic Progress Stepper */}
      {!["CANCELLED", "REJECTED"].includes(order.status) && (
        <section className="rounded-2xl border border-border/80 bg-card p-5 space-y-4 shadow-2xs">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Preparation Progress
          </h2>
          <div className="relative flex justify-between">
            {ORDER_LIFECYCLE_STEPS.map((step, idx) => {
              const currentIdx = ORDER_LIFECYCLE_STEPS.findIndex((s) => s.status === order.status);
              const isDone = currentIdx >= idx;
              const isCurrent = currentIdx === idx;

              return (
                <div key={step.status} className="flex flex-col items-center text-center flex-1 z-10">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all",
                      isDone
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted text-muted-foreground border border-border",
                      isCurrent && "ring-4 ring-primary/20 scale-110"
                    )}
                  >
                    {idx + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold mt-2 leading-tight",
                      isDone ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
            <div className="absolute top-3.5 left-6 right-6 h-0.5 bg-muted -z-0">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${Math.max(
                    0,
                    (ORDER_LIFECYCLE_STEPS.findIndex((s) => s.status === order.status) /
                      (ORDER_LIFECYCLE_STEPS.length - 1)) *
                      100
                  )}%`,
                }}
              />
            </div>
          </div>
        </section>
      )}

      {/* DYNAMIC SECURE SMART PICKUP QR & ROTATING CODE (SHOWN ONLY AT READY STATUS) */}
      {order.status === "READY" && (
        <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 via-card to-card p-5 text-center space-y-4 shadow-sm animate-in fade-in zoom-in-95 duration-200">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Badge className="bg-emerald-600 text-white font-bold uppercase tracking-wider text-[10px]">
                Ready for Collection
              </Badge>
              {holdRemainingSeconds !== null && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-semibold gap-1",
                    holdRemainingSeconds <= 300
                      ? "border-destructive text-destructive bg-destructive/10 animate-pulse font-bold"
                      : "border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {holdRemainingSeconds > 0
                    ? `Collect within ${Math.floor(holdRemainingSeconds / 60)}m ${String(holdRemainingSeconds % 60).padStart(2, "0")}s`
                    : "Hold window expired"}
                </Badge>
              )}
            </div>
            <h2 className="text-base font-bold text-foreground">Dynamic Counter Pickup QR</h2>
            <p className="text-xs text-muted-foreground">
              Show this QR code at the counter to collect your food before the hold window ends.
            </p>
          </div>

          {pickupData?.code ? (
            <div className="space-y-4">
              {/* Screen reader polite live region: announced ONLY when code rotates */}
              <div className="sr-only" aria-live="polite" aria-atomic="true">
                {screenReaderAnnouncement}
              </div>

              {/* QR Code Container with accessibility attributes */}
              <div
                role="img"
                aria-label={`Counter Pickup QR Code for Order #${order.order_code}`}
                className="mx-auto flex h-48 w-48 items-center justify-center rounded-2xl bg-white p-3 shadow-sm border border-border/40"
              >
                <QRCodeSVG
                  value={`CC1:${order.id}:${pickupData.code}`}
                  size={168}
                  level="M"
                  className="h-full w-full"
                />
              </div>

              {/* Text alternative for QR */}
              <p className="sr-only">
                Order reference #{order.order_code}, Pickup rotating code: {pickupData.code}, Backup PIN: {pickupData.pin}
              </p>

              {/* 60s Countdown Ring & Rotating 6-Digit Code */}
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="inline-flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-2 border border-border shadow-2xs">
                  <div className="relative flex items-center justify-center h-8 w-8" aria-hidden="true">
                    <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-muted/40"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray="94.2"
                        strokeDashoffset={94.2 * (1 - Math.max(0, secondsRemaining) / 60)}
                        className="text-primary transition-all duration-1000 ease-linear"
                      />
                    </svg>
                    <span className="absolute text-[10px] font-mono font-bold">
                      {secondsRemaining}s
                    </span>
                  </div>
                  <span className="font-mono text-2xl font-black tracking-widest text-foreground">
                    {pickupData.code}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Rotating security code refreshes every 60 seconds.
                </p>
              </div>

              {/* Fallback 4-Digit PIN */}
              {pickupData.pin && (
                <div className="max-w-xs mx-auto p-2.5 rounded-xl border border-border/80 bg-muted/30 text-xs flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    Counter Backup PIN:
                  </span>
                  <span className="font-mono font-bold tracking-widest text-sm bg-background px-2.5 py-0.5 rounded border border-border">
                    {pickupData.pin}
                  </span>
                </div>
              )}

              {/* Pickup for Name banner */}
              {(pickupData.pickup_for_name || order.pickup_for_name) && (
                <div className="p-2 rounded-lg bg-primary/5 text-primary text-xs font-semibold">
                  Authorized collector: {pickupData.pickup_for_name || order.pickup_for_name}
                </div>
              )}
            </div>
          ) : pickupError ? (
            <div className="py-6 px-4 flex flex-col items-center justify-center space-y-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  Pickup Code Unavailable
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  {pickupError.message}
                </p>
              </div>
              {pickupError.isAuthError ? (
                <Link
                  href="/login"
                  className={buttonVariants({
                    size: "sm",
                    className: "text-xs font-semibold h-8 rounded-lg",
                  })}
                >
                  Sign In Again
                </Link>
              ) : pickupError.canRetryManually ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPickupLoading}
                  onClick={() => fetchPickupCode(true)}
                  className="text-xs font-semibold h-8 rounded-lg gap-1.5"
                >
                  {isPickupLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      Retry Code
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center space-y-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs">Generating secure pickup code...</p>
            </div>
          )}
        </section>
      )}

      {/* NO_SHOW Alert Section */}
      {order.status === "NO_SHOW" && (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center space-y-3 shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mx-auto">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-foreground">Pickup Window Expired (No-Show)</h2>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              This order was marked as a no-show because it was not collected within the canteen&apos;s hold window. 
              Prepared items cannot be refunded. If you are already at the counter within 6 hours, ask canteen staff to perform a manual handover.
            </p>
          </div>
        </section>
      )}

      {/* Canteen & Pickup Timings */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Store className="h-3.5 w-3.5 text-primary" />
          <span>Canteen & Pickup Details</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40">
            <span className="text-muted-foreground block text-[11px]">Location:</span>
            <span className="font-bold text-foreground">
              {order.canteens?.name || "Campus Canteen"}
            </span>
            {order.canteens?.location && (
              <span className="text-muted-foreground block text-[10px] mt-0.5">
                {order.canteens.location}
              </span>
            )}
          </div>
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40">
            <span className="text-muted-foreground block text-[11px]">Estimated Ready:</span>
            <span className="font-bold text-foreground flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary" />
              {formatIstTime(order.estimated_ready_at)}
            </span>
            <span className="text-muted-foreground block text-[10px] mt-0.5">
              Collect before {formatIstTime(order.pickup_window_end)}
            </span>
          </div>
        </div>
      </section>

      {/* Order Items Breakdown */}
      <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Receipt className="h-3.5 w-3.5 text-primary" />
          <span>Items Ordered ({order.order_items.length})</span>
        </h2>
        <div className="divide-y divide-border/60">
          {order.order_items.map((item) => (
            <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60">
                  <MenuItemImage
                    src={item.image_url}
                    alt={item.name_snapshot}
                    aspect="square"
                    sizes="40px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{item.name_snapshot}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Qty: {item.quantity} &times; {formatPaise(item.unit_price_paise)}
                  </p>
                </div>
              </div>
              <span className="font-bold text-foreground">
                {formatPaise(item.unit_price_paise * item.quantity)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Dispute Section (For COLLECTED orders within 24h) */}
      {order.status === "COLLECTED" && (
        <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-2 text-xs shadow-2xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-foreground">Did someone else collect this?</p>
              <p className="text-muted-foreground text-[11px]">
                If you did not receive your food, file a dispute within 24 hours of collection.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={hasDisputed}
              onClick={() => setShowDisputeModal(true)}
              className="min-h-[36px] text-xs font-semibold text-destructive hover:bg-destructive/10"
            >
              {hasDisputed ? "Dispute Reported" : "Not Me / Dispute"}
            </Button>
          </div>
        </section>
      )}

      {/* Reviews (Only in COLLECTED state) */}
      {order.status === "COLLECTED" && (
        <RateOrderItemsSection orderItems={order.order_items} />
      )}

      {/* Cancellation Section (Only in PLACED stage) */}
      {cancellable && (
        <section className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
          {!showCancelConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-foreground">Need to cancel?</h3>
                <p className="text-[11px] text-muted-foreground">
                  Allowed while kitchen has not started preparing your food.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelConfirm(true)}
                className="rounded-xl min-h-[44px] px-4 text-xs font-semibold"
              >
                Cancel Order
              </Button>
            </div>
          ) : (
            <div className="space-y-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Confirm Order Cancellation</span>
              </div>
              <p className="text-xs text-destructive/90">
                Cancel order #{order.order_code}? This will release the food items back into stock.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isCancelling}
                  className="min-h-[40px] text-xs"
                >
                  Keep Order
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelOrder}
                  disabled={isCancelling}
                  className="min-h-[40px] text-xs font-bold gap-1.5"
                >
                  {isCancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Reorder Button */}
      {["COLLECTED", "CANCELLED", "REJECTED"].includes(order.status) && (
        <Button
          onClick={handleReorder}
          disabled={isReordering}
          size="lg"
          className="w-full min-h-[48px] rounded-xl font-bold gap-2 shadow-xs"
        >
          {isReordering ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking availability...
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" />
              Reorder Items
            </>
          )}
        </Button>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-background border p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b">
              <div className="flex items-center gap-2 text-destructive font-bold text-sm">
                <ShieldAlert className="h-4 w-4" />
                Dispute Unauthorized Collection
              </div>
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleDisputeSubmit} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Please describe what happened. Canteen managers review all collection disputes against pickup counter logs.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Reason for dispute (min 5 characters):
                </label>
                <Input
                  placeholder="e.g. I was in class and did not collect this order."
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="text-xs"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisputeModal(false)}
                  disabled={isSubmittingDispute}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={isSubmittingDispute}
                  className="gap-1.5"
                >
                  {isSubmittingDispute && <Loader2 className="h-3 w-3 animate-spin" />}
                  Submit Dispute
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
