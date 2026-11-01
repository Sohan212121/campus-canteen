"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
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
  Copy,
  Check,
  CheckCircle2,
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
  sendMyPickupRemindersAction,
} from "@/server/actions/order";
import {
  computeExpiresAtMonotonic,
  calculateSecondsRemaining,
  calculateNextRefreshDelayMs,
} from "@/lib/pickup-countdown";
import {
  formatRelativeReadyCountdown,
  calculateHoldWindowProgress,
  calculateProgressOffset,
  getStepTimestampText,
} from "@/lib/order-countdown";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { RateOrderItemsSection } from "@/components/student/rate-order-items-section";
import { CelebrationOverlay } from "@/components/celebration/celebration-overlay";
import { CollectedCelebration } from "@/components/celebration/collected-celebration";
import {
  getPlacedSessionKey,
  getCollectedStorageKey,
  shouldShowPlacedCelebration,
  shouldShowCollectedCelebration,
} from "@/lib/celebration";
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

let currentSecondSnapshot = typeof window !== "undefined" ? Math.floor(Date.now() / 1000) : 0;
const clockListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.setInterval(() => {
    const nextSec = Math.floor(Date.now() / 1000);
    if (nextSec !== currentSecondSnapshot) {
      currentSecondSnapshot = nextSec;
      clockListeners.forEach((listener) => {
        try {
          listener();
        } catch {
          // Ignore listener errors
        }
      });
    }
  }, 1000);
}

function subscribeClock(callback: () => void): () => void {
  clockListeners.add(callback);
  return () => {
    clockListeners.delete(callback);
  };
}

function getClockSnapshot(): number {
  return currentSecondSnapshot;
}

function getServerClockSnapshot(): number {
  return 0;
}

export function OrderTrackerView({ initialOrder }: OrderTrackerViewProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetailData>(initialOrder);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Monotonic 1-second clock via external store to ensure pure React 19 rendering
  const currentSec = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getServerClockSnapshot
  );
  const currentTimeMs = currentSec > 0 ? currentSec * 1000 : undefined;

  // Dynamic TOTP code & countdown state for READY orders
  const [pickupData, setPickupData] = useState<PickupCodeData | null>(null);
  const [expiresAtPerf, setExpiresAtPerf] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);
  const [pickupError, setPickupError] = useState<PickupErrorInfo | null>(null);
  const [isPickupLoading, setIsPickupLoading] = useState<boolean>(false);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<string>("");

  // Derived hold window progress
  const holdProgress = calculateHoldWindowProgress(
    order.ready_at,
    order.pickup_window_end,
    order.canteens?.hold_minutes ?? 15,
    currentTimeMs
  );
  const holdRemainingSeconds =
    order.status === "READY" && currentSec > 0
      ? holdProgress.remainingSeconds
      : null;

  // Transition to NO_SHOW when hold window expires
  useEffect(() => {
    if (order.status === "READY" && holdRemainingSeconds === 0) {
      const timer = setTimeout(() => {
        setOrder((prev) => (prev.status === "READY" ? { ...prev, status: "NO_SHOW" } : prev));
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [order.status, holdRemainingSeconds]);

  // Opportunistic student pickup reminder trigger:
  // Runs when status is READY and document is visible (about once per minute)
  useEffect(() => {
    if (order.status !== "READY") {
      return;
    }

    const triggerReminders = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      try {
        await sendMyPickupRemindersAction();
      } catch {
        // Non-blocking background call
      }
    };

    triggerReminders();
    const interval = setInterval(triggerReminders, 60000);
    return () => clearInterval(interval);
  }, [order.status]);

  // Copy order reference code with accessible fallback and visual feedback
  const handleCopyCode = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(order.order_code);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = order.order_code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(0, textarea.value.length);
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedCode(true);
      toast.success(`Copied #${order.order_code} to clipboard`);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Failed to copy order code");
    }
  };

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
    }
  }

  // Dispute "Not Me" modal state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [hasDisputed, setHasDisputed] = useState(false);

  // Celebration state (Order Placed Overlay & Order Collected Moment)
  const [showPlacedCelebration, setShowPlacedCelebration] = useState(false);
  const [showCollectedCelebration, setShowCollectedCelebration] = useState(false);
  const prevStatusRef = useRef(order.status);

  // Initial check for celebration triggers (placed overlay and collected moment)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const hasPlacedParam = params.get("placed") === "1";
      const isDev = process.env.NODE_ENV !== "production";
      const previewPlacedParam =
        isDev &&
        (params.get("previewPlaced") === "1" ||
          params.get("previewCelebration") === "placed");
      const previewCollectedParam =
        isDev &&
        (params.get("previewCollected") === "1" ||
          params.get("previewCelebration") === "collected");

      const placedKey = getPlacedSessionKey(order.id);
      let hasSessionFlag = false;
      try {
        hasSessionFlag = sessionStorage.getItem(placedKey) === "1";
      } catch {}

      const collectedKey = getCollectedStorageKey(order.id);
      let hasSeenCollected = false;
      try {
        hasSeenCollected = localStorage.getItem(collectedKey) === "1";
      } catch {}

      // Check order placed celebration
      if (
        shouldShowPlacedCelebration({
          status: order.status,
          placedAt: order.placed_at,
          hasSessionFlag,
          isDev,
          previewPlacedParam,
        })
      ) {
        setShowPlacedCelebration(true);
        try {
          sessionStorage.removeItem(placedKey);
        } catch {}
      }

      // Check collected celebration for already collected orders opened recently
      if (
        shouldShowCollectedCelebration({
          currentStatus: order.status,
          collectedAt: order.collected_at,
          hasSeenCollected,
          isDev,
          previewCollectedParam,
        })
      ) {
        setShowCollectedCelebration(true);
        try {
          localStorage.setItem(collectedKey, "1");
        } catch {}
      }

      // Clean URL params if any celebration query flags were present
      if (hasPlacedParam || previewPlacedParam || previewCollectedParam) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, "", cleanUrl);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [order.id, order.status, order.placed_at, order.collected_at]);

  // Track status transitions while the user is on the page (e.g. READY -> COLLECTED)
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== order.status) {
      prevStatusRef.current = order.status;

      const collectedKey = getCollectedStorageKey(order.id);
      let hasSeenCollected = false;
      try {
        hasSeenCollected = localStorage.getItem(collectedKey) === "1";
      } catch {}

      if (
        shouldShowCollectedCelebration({
          currentStatus: order.status,
          prevStatus: prev,
          collectedAt: order.collected_at,
          hasSeenCollected,
        })
      ) {
        const timer = setTimeout(() => {
          setShowCollectedCelebration(true);
          try {
            localStorage.setItem(collectedKey, "1");
          } catch {}
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [order.status, order.id, order.collected_at]);

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
        const errCode = json?.code;
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
    <div className="space-y-6 pb-24 max-w-md mx-auto">
      {/* Top Breadcrumb & Status Header */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <Link
          href="/orders"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>&larr; Back to My Orders</span>
        </Link>
        <Badge variant={badgeConfig.variant} className={cn("text-xs font-bold px-3 py-1", badgeConfig.className)}>
          {badgeConfig.label}
        </Badge>
      </div>

      {/* Order Collected Moment Celebration */}
      {showCollectedCelebration && order.status === "COLLECTED" && (
        <CollectedCelebration
          orderCode={order.order_code}
          onDismiss={() => setShowCollectedCelebration(false)}
        />
      )}

      {/* In-App Pickup Window Reminder Banner (Visible when hold window is closing) */}
      {order.status === "READY" && holdRemainingSeconds !== null && holdRemainingSeconds <= 300 && (
        <div
          role="alert"
          className={cn(
            "p-4 rounded-2xl flex items-start gap-3.5 shadow-sm transition-all duration-300",
            holdRemainingSeconds <= 120
              ? "bg-destructive/15 border-2 border-destructive text-destructive motion-safe:animate-pulse"
              : "bg-amber-500/15 border border-amber-500/40 text-amber-900 dark:text-amber-200"
          )}
        >
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-extrabold uppercase tracking-wide text-xs">
              {holdRemainingSeconds <= 120
                ? "🚨 Final Call — Under 2 Minutes Left!"
                : "⚡ Pickup Window Closing Soon"}
            </p>
            <p className="text-xs mt-1 leading-relaxed opacity-90">
              {holdRemainingSeconds <= 120
                ? `Order #${order.order_code} will expire in ${Math.floor(holdRemainingSeconds / 60)}m ${String(holdRemainingSeconds % 60).padStart(2, "0")}s. Please collect your food immediately at the counter.`
                : `Please collect your food within the next ${Math.ceil(holdRemainingSeconds / 60)} minutes before the hold window ends.`}
            </p>
          </div>
        </div>
      )}

      {/* STATE-DRIVEN HERO CARD */}
      {/* 1. In-Progress Hero: PLACED, ACCEPTED, PREPARING */}
      {["PLACED", "ACCEPTED", "PREPARING"].includes(order.status) && (
        <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-primary" />
              Ready By
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary">
              <span className="h-2 w-2 rounded-full bg-primary motion-safe:animate-ping" />
              {formatRelativeReadyCountdown(order.estimated_ready_at, currentTimeMs)}
            </span>
          </div>

          <div>
            <div className="text-4xl sm:text-5xl font-black tracking-tight text-foreground">
              {formatIstTime(order.estimated_ready_at)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Pickup window ends at <span className="font-semibold text-foreground">{formatIstTime(order.pickup_window_end)}</span>
            </p>
          </div>

          <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Store className="h-3.5 w-3.5 text-primary" />
              {order.canteens?.name || "Campus Canteen"}
            </span>
            {order.canteens?.location && <span>{order.canteens.location}</span>}
          </div>
        </section>
      )}

      {/* 2. Ready Hero: Dynamic Counter Pickup QR & Rotating Code */}
      {order.status === "READY" && (
        <section className="rounded-3xl border border-emerald-500/40 bg-gradient-to-b from-emerald-500/10 via-card to-card p-6 text-center space-y-5 shadow-md animate-in fade-in zoom-in-95 duration-200">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-black uppercase tracking-wider shadow-xs">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ready For Collection
            </div>

            <h2 className="text-xl font-black tracking-tight text-foreground">
              Dynamic Counter Pickup QR
            </h2>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Show this QR code at the counter to collect your food before the hold window ends.
            </p>

            {/* Circular Hold Window Countdown Timer */}
            {holdRemainingSeconds !== null && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <div className="relative flex items-center justify-center h-12 w-12" aria-hidden="true">
                  <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      className="text-muted/30"
                    />
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.5"
                      strokeDasharray="113.1"
                      strokeDashoffset={calculateProgressOffset(
                        ((holdRemainingSeconds ?? 0) / Math.max(1, (order.canteens?.hold_minutes ?? 15) * 60)) * 100,
                        113.1
                      )}
                      className={cn(
                        "transition-all duration-1000 ease-linear",
                        holdRemainingSeconds <= 120
                          ? "text-destructive"
                          : holdRemainingSeconds <= 300
                          ? "text-amber-500"
                          : "text-emerald-500"
                      )}
                    />
                  </svg>
                  <Clock className={cn(
                    "absolute h-4 w-4",
                    holdRemainingSeconds <= 120 ? "text-destructive motion-safe:animate-pulse" : "text-primary"
                  )} />
                </div>
                <div className="text-left text-xs">
                  <p className={cn(
                    "font-black text-sm",
                    holdRemainingSeconds <= 120
                      ? "text-destructive"
                      : holdRemainingSeconds <= 300
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-foreground"
                  )}>
                    {holdRemainingSeconds > 0
                      ? `Collect within ${Math.floor(holdRemainingSeconds / 60)}m ${String(holdRemainingSeconds % 60).padStart(2, "0")}s`
                      : "Hold window expired"}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    Hold window ends at {formatIstTime(order.pickup_window_end)}
                  </p>
                </div>
              </div>
            )}
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
                <div className="inline-flex items-center gap-3 rounded-2xl bg-muted/60 px-5 py-2.5 border border-border shadow-2xs">
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
                <div className="max-w-xs mx-auto p-3 rounded-2xl border border-border/80 bg-muted/30 text-xs flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    Counter Backup PIN:
                  </span>
                  <span className="font-mono font-black tracking-widest text-sm bg-background px-3 py-1 rounded-lg border border-border">
                    {pickupData.pin}
                  </span>
                </div>
              )}

              {/* Pickup for Name banner */}
              {(pickupData.pickup_for_name || order.pickup_for_name) && (
                <div className="p-2.5 rounded-xl bg-primary/5 text-primary text-xs font-semibold">
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
                    className: "text-xs font-semibold min-h-[44px] rounded-xl px-4",
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
                  className="text-xs font-semibold min-h-[44px] rounded-xl px-4 gap-1.5"
                >
                  {isPickupLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
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

          {/* Canteen Location Footer */}
          <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Store className="h-3.5 w-3.5 text-primary" />
              {order.canteens?.name || "Campus Canteen"}
            </span>
            {order.canteens?.location && <span>{order.canteens.location}</span>}
          </div>
        </section>
      )}

      {/* 3. Terminal Hero: COLLECTED */}
      {order.status === "COLLECTED" && (
        <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-3 shadow-xs">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mx-auto">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-black text-foreground">Order Collected</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Collected {order.collected_at ? formatIstDateTime(order.collected_at) : "at the counter"}. Thank you for ordering!
          </p>
        </section>
      )}

      {/* 4. Terminal Hero: NO_SHOW */}
      {order.status === "NO_SHOW" && (
        <section className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3 shadow-xs">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive mx-auto">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-black text-foreground">Pickup Window Expired (No-Show)</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              This order was marked as a no-show because it was not collected within the canteen&apos;s hold window. 
              Prepared items cannot be refunded. If you are already at the counter within 6 hours, ask canteen staff to perform a manual handover.
            </p>
          </div>
        </section>
      )}

      {/* 5. Terminal Hero: CANCELLED / REJECTED */}
      {["CANCELLED", "REJECTED"].includes(order.status) && (
        <section className="rounded-3xl border border-border bg-muted/30 p-6 text-center space-y-2 shadow-xs">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto">
            <X className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-black text-foreground">
            Order {order.status === "CANCELLED" ? "Cancelled" : "Rejected"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {order.status === "CANCELLED"
              ? "This order was cancelled before preparation commenced."
              : "The canteen was unable to fulfill this order due to kitchen constraints."}
          </p>
        </section>
      )}

      {/* Main Order Identification Card */}
      <section className="rounded-3xl border border-border/80 bg-card p-6 space-y-4 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Order Reference
            </p>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-2xl font-black tracking-tight text-foreground">
                #{order.order_code}
              </h1>
              <button
                type="button"
                onClick={handleCopyCode}
                title="Copy order code"
                aria-label="Copy order code to clipboard"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl p-2 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              >
                {copiedCode ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed {formatIstDateTime(order.placed_at)}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Total Amount
            </p>
            <p className="text-2xl font-black text-primary mt-1">
              {formatPaise(order.total_paise)}
            </p>
            <Badge variant="outline" className="text-xs font-semibold mt-1">
              {order.payment_method === "PAY_AT_PICKUP" ? "Pay at Counter" : order.payment_method}
            </Badge>
          </div>
        </div>
      </section>

      {/* Dynamic Progress Stepper */}
      {!["CANCELLED", "REJECTED"].includes(order.status) && (
        <section className="rounded-3xl border border-border/80 bg-card p-6 space-y-4 shadow-xs">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Preparation Progress
          </h2>
          <div className="relative flex justify-between" role="list" aria-label="Order lifecycle stages">
            {ORDER_LIFECYCLE_STEPS.map((step, idx) => {
              const currentIdx = ORDER_LIFECYCLE_STEPS.findIndex((s) => s.status === order.status);
              const isDone = currentIdx >= idx;
              const isCurrent = currentIdx === idx;
              const stepTime = getStepTimestampText(step.status, order);

              return (
                <div
                  key={step.status}
                  role="listitem"
                  aria-current={isCurrent ? "step" : undefined}
                  className="flex flex-col items-center text-center flex-1 z-10"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all",
                      isDone
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted text-muted-foreground border border-border",
                      isCurrent && "ring-4 ring-primary/20 scale-110 motion-safe:animate-pulse"
                    )}
                  >
                    {isDone && !isCurrent ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-bold mt-2 leading-tight",
                      isDone ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  {stepTime && (
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {stepTime}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="absolute top-4 left-6 right-6 h-0.5 bg-muted -z-0">
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

      {/* Order Items Breakdown */}
      <section className="rounded-3xl border border-border/80 bg-card p-5 space-y-3 shadow-xs">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Receipt className="h-4 w-4 text-primary" />
          <span>Items Ordered ({order.order_items.length})</span>
        </h2>
        <div className="divide-y divide-border/60">
          {order.order_items.map((item) => (
            <div key={item.id} className="py-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted border border-border/60">
                  <MenuItemImage
                    src={item.image_url}
                    alt={item.name_snapshot}
                    aspect="square"
                    sizes="48px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p className="font-bold text-foreground text-sm">{item.name_snapshot}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Qty: {item.quantity} &times; {formatPaise(item.unit_price_paise)}
                  </p>
                </div>
              </div>
              <span className="font-bold text-foreground text-sm">
                {formatPaise(item.unit_price_paise * item.quantity)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Dispute Section (For COLLECTED orders within 24h) */}
      {order.status === "COLLECTED" && (
        <section className="rounded-3xl border border-border/80 bg-card p-5 space-y-2 text-xs shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm text-foreground">Did someone else collect this?</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                If you did not receive your food, file a dispute within 24 hours of collection.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={hasDisputed}
              onClick={() => setShowDisputeModal(true)}
              className="min-h-[44px] text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-xl px-3"
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
        <section className="rounded-3xl border border-border/80 bg-card p-5 space-y-3 shadow-xs">
          {!showCancelConfirm ? (
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Need to cancel?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
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
            <div className="space-y-3 p-4 rounded-2xl bg-destructive/10 border border-destructive/20 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Confirm Order Cancellation</span>
              </div>
              <p className="text-xs text-destructive/90 leading-relaxed">
                Cancel order #{order.order_code}? This will release the food items back into stock.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={isCancelling}
                  className="min-h-[44px] text-xs rounded-xl px-4"
                >
                  Keep Order
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelOrder}
                  disabled={isCancelling}
                  className="min-h-[44px] text-xs font-bold gap-1.5 rounded-xl px-4"
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
          className="w-full min-h-[50px] rounded-2xl font-bold gap-2 shadow-xs text-base"
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
      {showDisputeModal && !showPlacedCelebration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-background border p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2 text-destructive font-bold text-sm">
                <ShieldAlert className="h-4 w-4" />
                Dispute Unauthorized Collection
              </div>
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleDisputeSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Please describe what happened. Canteen managers review all collection disputes against pickup counter logs.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Reason for dispute (min 5 characters):
                </label>
                <Input
                  placeholder="e.g. I was in class and did not collect this order."
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="text-sm min-h-[44px] rounded-xl"
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
                  className="min-h-[44px] rounded-xl px-4 text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={isSubmittingDispute}
                  className="min-h-[44px] rounded-xl px-4 text-xs font-bold gap-1.5"
                >
                  {isSubmittingDispute && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Submit Dispute
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Placed Full-screen Celebration Overlay */}
      <CelebrationOverlay
        isOpen={showPlacedCelebration}
        order={order}
        onClose={() => setShowPlacedCelebration(false)}
        onBackToMenu={() => router.push("/menu")}
      />
    </div>
  );
}
