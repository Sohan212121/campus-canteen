"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Volume2,
  VolumeX,
  Clock,
  Bell,
  CookingPot,
  CheckCircle2,
  CheckCheck,
  QrCode,
  AlertTriangle,
  RotateCcw,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { formatPaise } from "@/lib/money";
import {
  formatIstTime,
  calculateStartPreparingBy,
} from "@/lib/order-status";
import {
  type BoardOrder,
  type StaffBoardData,
  type StaffOrderStatus,
  getStaffBoardDataAction,
  transitionOrderAction,
  sweepCanteenNoShowsAction,
} from "@/server/actions/staff";
import {
  optimisticTransition,
  rollbackTransition,
  reconcileBoardWithPending,
  isEchoIgnored,
  recordTransitionEcho,
  calculateReconnectBackoff,
} from "@/lib/staff-board-helpers";
import { OrderDetailDrawer } from "@/components/staff/order-detail-drawer";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { preloadQrScanner } from "@/components/staff/lazy-qr-scanner";
import { cn } from "@/lib/utils";

interface KitchenBoardProps {
  initialData: StaffBoardData;
}

/**
 * Plays a pleasant kitchen arrival chime using the Web Audio API.
 * Avoids external audio asset dependencies.
 */
function playKitchenChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // First tone (G5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(783.99, ctx.currentTime);
    gain1.gain.setValueAtTime(0.25, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.4);

    // Second tone (C6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.6);
  } catch {
    // Ignore audio permission/context errors
  }
}

export function KitchenBoard({ initialData }: KitchenBoardProps) {
  const [board, setBoard] = useState<StaffBoardData>(initialData);
  const [selectedOrder, setSelectedOrder] = useState<BoardOrder | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "SUBSCRIBED" | "CONNECTING" | "RECONNECTING" | "DISCONNECTED"
  >("CONNECTING");

  // Per-order pending action & error states
  const [pendingActions, setPendingActions] = useState<
    Record<string, { toStatus: StaffOrderStatus; order: BoardOrder }>
  >({});
  const [orderErrors, setOrderErrors] = useState<
    Record<string, { toStatus: StaffOrderStatus; error: string }>
  >({});

  // Audio ref to prevent channel teardown on audio toggle
  const audioEnabledRef = useRef(audioEnabled);
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  // Echo suppression map & pending actions ref for background reconcile
  const recentTransitionsRef = useRef<Record<string, number>>({});
  const pendingActionsRef = useRef(pendingActions);
  useEffect(() => {
    pendingActionsRef.current = pendingActions;
  }, [pendingActions]);

  // Realtime reconnect backoff tracker
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracking refs to detect new orders without alerting on initial load
  const isInitialLoad = useRef(true);
  const knownOrderIds = useRef<Set<string>>(
    new Set([
      ...initialData.newOrders.map((o) => o.id),
      ...initialData.preparingOrders.map((o) => o.id),
      ...initialData.readyOrders.map((o) => o.id),
      ...initialData.completedOrders.map((o) => o.id),
    ])
  );

  // Preload scanner in background on board mount
  useEffect(() => {
    preloadQrScanner();
  }, []);

  // Debounced sweep trigger (at most once every 60 seconds)
  const lastSweepRef = useRef<number>(0);
  const triggerCanteenSweep = useCallback(async () => {
    const now = Date.now();
    if (now - lastSweepRef.current < 60000) return;
    lastSweepRef.current = now;
    try {
      await sweepCanteenNoShowsAction();
    } catch {
      // background sweep error non-blocking
    }
  }, []);

  // Debounced board refresh with pending protection
  const refreshBoard = useCallback(async () => {
    setIsRefreshing(true);
    triggerCanteenSweep();
    try {
      const data = await getStaffBoardDataAction();
      if (data.canteenId) {
        // Detect newly placed orders
        if (!isInitialLoad.current) {
          const newlyPlaced = data.newOrders.filter(
            (o) => !knownOrderIds.current.has(o.id)
          );
          if (newlyPlaced.length > 0) {
            toast.info(`${newlyPlaced.length} new order(s) placed!`, {
              description: newlyPlaced.map((o) => `#${o.order_code}`).join(", "),
              duration: 4000,
            });

            if (audioEnabledRef.current) {
              playKitchenChime();
            }
          }
        }

        // Update known IDs
        knownOrderIds.current = new Set([
          ...data.newOrders.map((o) => o.id),
          ...data.preparingOrders.map((o) => o.id),
          ...data.readyOrders.map((o) => o.id),
          ...data.completedOrders.map((o) => o.id),
        ]);

        // Reconcile freshly fetched data with any in-flight pending actions
        const reconciled = reconcileBoardWithPending(
          data,
          pendingActionsRef.current
        );
        setBoard(reconciled);
      }
    } catch {
      // Ignore background fetch error
    } finally {
      setIsRefreshing(false);
      isInitialLoad.current = false;
    }
  }, [triggerCanteenSweep]);

  // Tab visibility listener: refetch once when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        refreshBoard();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshBoard]);

  // Realtime subscription with single channel and exponential reconnect
  useEffect(() => {
    isInitialLoad.current = false;
    if (!board.canteenId) return;

    const supabase = createClient();
    const channelName = `kitchen-board-${board.canteenId}`;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerDebouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshBoard();
      }, 300);
    };

    const subscribeChannel = () => {
      const ch = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `canteen_id=eq.${board.canteenId}`,
          },
          (payload) => {
            // Skip refetching while document is hidden
            if (typeof document !== "undefined" && document.hidden) return;

            const changedId =
              (payload.new as { id?: string })?.id ||
              (payload.old as { id?: string })?.id;

            // Ignore echo for order recently updated by this client
            if (
              changedId &&
              isEchoIgnored(changedId, recentTransitionsRef.current)
            ) {
              return;
            }

            triggerDebouncedRefresh();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setRealtimeStatus("SUBSCRIBED");
            reconnectAttemptRef.current = 0;
          } else if (
            status === "CLOSED" ||
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT"
          ) {
            setRealtimeStatus("RECONNECTING");

            // Exponential backoff reconnect
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
            const delay = calculateReconnectBackoff(reconnectAttemptRef.current);
            reconnectAttemptRef.current += 1;
            reconnectTimeoutRef.current = setTimeout(() => {
              supabase.removeChannel(ch);
              subscribeChannel();
            }, delay);
          } else {
            setRealtimeStatus("CONNECTING");
          }
        });

      return ch;
    };

    const activeChannel = subscribeChannel();

    // Remove subscription on sign-out
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        supabase.removeChannel(activeChannel);
        setRealtimeStatus("DISCONNECTED");
      }
    });

    // 10s background polling fallback
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshBoard();
    }, 10000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      window.clearInterval(intervalId);
      authListener?.subscription?.unsubscribe();
      supabase.removeChannel(activeChannel);
    };
  }, [board.canteenId, refreshBoard]);

  // Per-order optimistic transition handler with rollback and retry
  const handleQuickTransition = useCallback(
    async (orderId: string, toStatus: StaffOrderStatus) => {
      // Guard against double submission for this specific order
      if (pendingActionsRef.current[orderId]) {
        return;
      }

      // Optimistically move the order card immediately
      let backupOrder: BoardOrder | null = null;
      setBoard((prev) => {
        const { nextBoard, previousOrder } = optimisticTransition(
          prev,
          orderId,
          toStatus
        );
        backupOrder = previousOrder;
        return nextBoard;
      });

      // Clear any previous error on this card
      setOrderErrors((prev) => {
        if (!prev[orderId]) return prev;
        const copy = { ...prev };
        delete copy[orderId];
        return copy;
      });

      // Track echo suppression timestamp
      recentTransitionsRef.current = recordTransitionEcho(
        orderId,
        recentTransitionsRef.current
      );

      // Set per-order pending state
      if (backupOrder) {
        setPendingActions((prev) => ({
          ...prev,
          [orderId]: { toStatus, order: backupOrder! },
        }));
      }

      // 20-second client-side timeout safeguard
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<{
        success: false;
        error: string;
      }>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error("Request timed out after 20 seconds. Please retry.")
            ),
          20000
        );
      });

      try {
        const res = await Promise.race([
          transitionOrderAction(orderId, toStatus),
          timeoutPromise,
        ]);
        clearTimeout(timeoutHandle!);

        if (!res.success) {
          // Revert optimistic transition
          if (backupOrder) {
            setBoard((prev) => rollbackTransition(prev, backupOrder!));
          }
          const errorMsg = res.error || "Failed to transition order";
          toast.error(errorMsg);
          setOrderErrors((prev) => ({
            ...prev,
            [orderId]: { toStatus, error: errorMsg },
          }));
        } else {
          toast.success(`Order updated to ${toStatus}`);
        }
      } catch (err: unknown) {
        clearTimeout(timeoutHandle!);
        if (backupOrder) {
          setBoard((prev) => rollbackTransition(prev, backupOrder!));
        }
        const errorMsg =
          err instanceof Error ? err.message : "Network error transitioning order";
        toast.error(errorMsg);
        setOrderErrors((prev) => ({
          ...prev,
          [orderId]: { toStatus, error: errorMsg },
        }));
      } finally {
        setPendingActions((prev) => {
          if (!prev[orderId]) return prev;
          const copy = { ...prev };
          delete copy[orderId];
          return copy;
        });
      }
    },
    []
  );

  const handleClearError = useCallback((orderId: string) => {
    setOrderErrors((prev) => {
      if (!prev[orderId]) return prev;
      const copy = { ...prev };
      delete copy[orderId];
      return copy;
    });
  }, []);

  // Memoised column lists
  const newOrdersList = useMemo(() => board.newOrders, [board.newOrders]);
  const preparingOrdersList = useMemo(
    () => board.preparingOrders,
    [board.preparingOrders]
  );
  const readyOrdersList = useMemo(() => board.readyOrders, [board.readyOrders]);
  const completedOrdersList = useMemo(
    () => board.completedOrders,
    [board.completedOrders]
  );

  if (!board.canteenId) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-8 text-center space-y-3 my-8 max-w-lg mx-auto">
        <AlertTriangle className="h-10 w-10 text-amber-600 dark:text-amber-400 mx-auto" />
        <h2 className="text-lg font-bold">No Canteen Assigned</h2>
        <p className="text-xs text-muted-foreground">
          Your staff account has not been assigned to a campus canteen. Please contact a campus administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      {/* Board Top Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight sm:text-2xl flex items-center gap-2">
            <span>Kitchen Board</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase px-2 py-0.5 rounded-md bg-muted">
              {board.canteenName}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time orders workflow &bull; Sorted by expected readiness
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live connection badge */}
          <div
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
              realtimeStatus === "SUBSCRIBED"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : realtimeStatus === "CONNECTING"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : realtimeStatus === "RECONNECTING"
                ? "border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-amber-200 animate-pulse"
                : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
            )}
          >
            {realtimeStatus === "SUBSCRIBED" ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>Live</span>
              </>
            ) : realtimeStatus === "CONNECTING" ? (
              <>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500 animate-pulse" />
                <span>Connecting...</span>
              </>
            ) : realtimeStatus === "RECONNECTING" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                <span>Reconnecting...</span>
              </>
            ) : (
              <>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                <span>Offline</span>
              </>
            )}
          </div>

          {/* Manual Refresh now button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refreshBoard();
              toast.info("Kitchen board refreshed");
            }}
            disabled={isRefreshing}
            className="min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold gap-2"
          >
            <RotateCcw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
            <span>Refresh now</span>
          </Button>

          {/* Audio toggle */}
          <Button
            variant={audioEnabled ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !audioEnabled;
              setAudioEnabled(next);
              if (next) {
                playKitchenChime();
                toast.success("Kitchen audio alerts enabled");
              } else {
                toast.info("Kitchen audio alerts muted");
              }
            }}
            className="min-h-[44px] px-3.5 rounded-xl text-xs sm:text-sm font-bold gap-2"
          >
            {audioEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {audioEnabled ? "Audio On" : "Enable Sound"}
            </span>
          </Button>
        </div>
      </div>

      {/* 4-Column Responsive Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Column 1: New (PLACED) */}
        <KanbanColumn
          title="New Orders"
          icon={<Bell className="h-4 w-4 text-blue-500" />}
          count={newOrdersList.length}
          badgeClass="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
          orders={newOrdersList}
          pendingActions={pendingActions}
          orderErrors={orderErrors}
          onSelectOrder={setSelectedOrder}
          onTransition={handleQuickTransition}
          onClearError={handleClearError}
        />

        {/* Column 2: Preparing (ACCEPTED + PREPARING) */}
        <KanbanColumn
          title="Preparing"
          icon={<CookingPot className="h-4 w-4 text-amber-500" />}
          count={preparingOrdersList.length}
          badgeClass="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
          orders={preparingOrdersList}
          pendingActions={pendingActions}
          orderErrors={orderErrors}
          onSelectOrder={setSelectedOrder}
          onTransition={handleQuickTransition}
          onClearError={handleClearError}
        />

        {/* Column 3: Ready for Pickup (READY) */}
        <KanbanColumn
          title="Ready for Pickup"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          count={readyOrdersList.length}
          badgeClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          orders={readyOrdersList}
          pendingActions={pendingActions}
          orderErrors={orderErrors}
          onSelectOrder={setSelectedOrder}
          onTransition={handleQuickTransition}
          onClearError={handleClearError}
        />

        {/* Column 4: Completed (COLLECTED, REJECTED, CANCELLED) */}
        <KanbanColumn
          title="Completed Today"
          icon={<CheckCheck className="h-4 w-4 text-muted-foreground" />}
          count={completedOrdersList.length}
          badgeClass="bg-muted text-muted-foreground border-border"
          orders={completedOrdersList}
          pendingActions={pendingActions}
          orderErrors={orderErrors}
          onSelectOrder={setSelectedOrder}
          onTransition={handleQuickTransition}
          onClearError={handleClearError}
          isCompletedColumn
        />
      </div>

      {/* Slide-over Detail Drawer */}
      <OrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onOrderUpdated={refreshBoard}
      />
    </div>
  );
}

interface KanbanColumnProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  badgeClass: string;
  orders: BoardOrder[];
  pendingActions: Record<string, { toStatus: StaffOrderStatus; order: BoardOrder }>;
  orderErrors: Record<string, { toStatus: StaffOrderStatus; error: string }>;
  onSelectOrder: (order: BoardOrder) => void;
  onTransition: (orderId: string, toStatus: StaffOrderStatus) => void;
  onClearError: (orderId: string) => void;
  isCompletedColumn?: boolean;
}

const KanbanColumn = React.memo(function KanbanColumn({
  title,
  icon,
  count,
  badgeClass,
  orders,
  pendingActions,
  orderErrors,
  onSelectOrder,
  onTransition,
  onClearError,
  isCompletedColumn,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-border/70 bg-muted/20 p-3 min-h-[500px]">
      {/* Column Header */}
      <div className="flex items-center justify-between pb-3 px-1 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          {icon}
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
            {title}
          </h2>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[11px] font-bold h-5 px-2", badgeClass)}
        >
          {count}
        </Badge>
      </div>

      {/* Orders List */}
      <div className="space-y-3 pt-3 flex-1 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-center text-xs text-muted-foreground/60 border border-dashed border-border/60 rounded-xl">
            No orders
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              pendingStatus={pendingActions[order.id]?.toStatus}
              orderError={orderErrors[order.id]}
              onSelectOrder={onSelectOrder}
              onTransition={onTransition}
              onClearError={onClearError}
              isCompletedColumn={isCompletedColumn}
            />
          ))
        )}
      </div>
    </div>
  );
});

interface OrderCardProps {
  order: BoardOrder;
  pendingStatus?: StaffOrderStatus;
  orderError?: { toStatus: StaffOrderStatus; error: string };
  onSelectOrder: (order: BoardOrder) => void;
  onTransition: (orderId: string, toStatus: StaffOrderStatus) => void;
  onClearError: (orderId: string) => void;
  isCompletedColumn?: boolean;
}

const OrderCard = React.memo(function OrderCard({
  order,
  pendingStatus,
  orderError,
  onSelectOrder,
  onTransition,
  isCompletedColumn,
}: OrderCardProps) {
  const isPending = Boolean(pendingStatus);
  const startPrepBy = calculateStartPreparingBy(
    order.estimated_ready_at,
    order.prep_minutes_total
  );

  return (
    <div
      onClick={() => onSelectOrder(order)}
      className={cn(
        "cursor-pointer rounded-xl border p-3.5 space-y-2.5 transition-all select-none active:scale-[0.99]",
        order.is_stale
          ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
          : order.status === "READY"
          ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50"
          : isCompletedColumn
          ? "border-border/60 bg-card/60 opacity-80 hover:opacity-100"
          : "border-border/80 bg-card hover:border-foreground/20"
      )}
    >
      {/* Top Reference & Stale Badge */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-black text-foreground">
              #{order.order_code}
            </span>
            {order.is_stale && (
              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                <AlertTriangle className="h-2.5 w-2.5" /> Stale
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-foreground/80 leading-snug">
            {order.customer_name}
          </p>
        </div>

        <span className="text-xs font-bold text-foreground">
          {formatPaise(order.total_paise)}
        </span>
      </div>

      {/* Items summary with thumbnails */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none">
          {order.order_items.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60"
              title={`${item.quantity}× ${item.name_snapshot}`}
            >
              <MenuItemImage
                src={item.image_url}
                alt={item.name_snapshot}
                aspect="square"
                sizes="40px"
                className="h-full w-full object-cover"
              />
            </div>
          ))}
          {order.order_items.length > 3 && (
            <div className="h-10 w-10 shrink-0 rounded-lg bg-muted/80 border border-border/60 flex items-center justify-center text-[11px] font-bold text-muted-foreground">
              +{order.order_items.length - 3}
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
          {order.order_items
            .map((item) => `${item.quantity}× ${item.name_snapshot}`)
            .join(", ")}
        </div>
      </div>

      {/* Timings */}
      {!isCompletedColumn && (
        <div className="rounded-lg bg-muted/50 p-2 text-[11px] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary" /> Ready by:
            </span>
            <span className="font-bold text-foreground">
              {formatIstTime(order.estimated_ready_at)}
            </span>
          </div>

          {order.status !== "READY" && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Start prep by:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {startPrepBy}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Inline Error strip with Retry */}
      {orderError && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 flex items-center justify-between text-xs text-destructive gap-2"
        >
          <div className="flex items-center gap-1 min-w-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-[11px] font-medium">
              {orderError.error}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onTransition(order.id, orderError.toStatus);
            }}
            disabled={isPending}
            className="h-7 px-2 text-xs font-bold rounded-md shrink-0 border-destructive/40 hover:bg-destructive/15"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Bottom Action Button */}
      {!isCompletedColumn && (
        <div className="pt-1">
          {order.status === "PLACED" && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onTransition(order.id, "ACCEPTED");
              }}
              disabled={isPending}
              className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 active:scale-[0.98] transition-transform"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4 stroke-[2.5]" />
              )}
              <span>{isPending ? "Accepting..." : "Accept Order"}</span>
            </Button>
          )}

          {order.status === "ACCEPTED" && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onTransition(order.id, "PREPARING");
              }}
              disabled={isPending}
              className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 bg-amber-600 hover:bg-amber-700 text-white active:scale-[0.98] transition-transform"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CookingPot className="h-4 w-4" />
              )}
              <span>{isPending ? "Updating..." : "Start Preparing"}</span>
            </Button>
          )}

          {order.status === "PREPARING" && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onTransition(order.id, "READY");
              }}
              disabled={isPending}
              className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.98] transition-transform"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>{isPending ? "Marking Ready..." : "Mark Ready"}</span>
            </Button>
          )}

          {order.status === "READY" && (
            <Link
              href="/staff/pickup"
              onClick={(e) => e.stopPropagation()}
              className={buttonVariants({
                size: "sm",
                className:
                  "w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 bg-primary text-primary-foreground active:scale-[0.98] transition-transform",
              })}
            >
              <QrCode className="h-4 w-4" />
              <span>Verify & Collect</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
});
