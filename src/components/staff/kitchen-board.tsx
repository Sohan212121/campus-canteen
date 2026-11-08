"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import { OrderDetailDrawer } from "@/components/staff/order-detail-drawer";
import { MenuItemImage } from "@/components/ui/menu-item-image";
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
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"SUBSCRIBED" | "CONNECTING" | "DISCONNECTED">("CONNECTING");

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

  // Debounced board refresh
  const refreshBoard = useCallback(async () => {
    setIsRefreshing(true);
    triggerCanteenSweep();
    try {
      const data = await getStaffBoardDataAction();
      if (data.canteenId) {
        // Detect newly placed orders
        if (!isInitialLoad.current) {
          const newlyPlaced = data.newOrders.filter((o) => !knownOrderIds.current.has(o.id));
          if (newlyPlaced.length > 0) {
            toast.info(`${newlyPlaced.length} new order(s) placed!`, {
              description: newlyPlaced.map((o) => `#${o.order_code}`).join(", "),
              duration: 4000,
            });

            if (audioEnabled) {
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

        setBoard(data);
      }
    } catch {
      // Ignore background fetch error
    } finally {
      setIsRefreshing(false);
      isInitialLoad.current = false;
    }
  }, [audioEnabled, triggerCanteenSweep]);

  // Realtime subscription & 10s polling fallback
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

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `canteen_id=eq.${board.canteenId}`,
        },
        () => {
          triggerDebouncedRefresh();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("SUBSCRIBED");
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeStatus("DISCONNECTED");
        } else {
          setRealtimeStatus("CONNECTING");
        }
      });

    // Remove subscription on sign-out
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        supabase.removeChannel(channel);
        setRealtimeStatus("DISCONNECTED");
      }
    });

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshBoard();
    }, 10000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.clearInterval(intervalId);
      authListener?.subscription?.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [board.canteenId, refreshBoard]);

  const handleQuickTransition = async (orderId: string, toStatus: StaffOrderStatus) => {
    setTransitioningId(orderId);
    try {
      const res = await transitionOrderAction(orderId, toStatus);
      if (!res.success) {
        toast.error(res.error || "Failed to transition order");
      } else {
        toast.success(`Order updated to ${toStatus}`);
        refreshBoard();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setTransitioningId(null);
    }
  };

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
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors shadow-2xs",
              realtimeStatus === "SUBSCRIBED"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : realtimeStatus === "CONNECTING"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
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
            <RotateCcw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
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
            {audioEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
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
          count={board.newOrders.length}
          badgeClass="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
          orders={board.newOrders}
          onSelectOrder={setSelectedOrder}
          renderActions={(order) => (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleQuickTransition(order.id, "ACCEPTED");
              }}
              disabled={transitioningId === order.id}
              className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 shadow-xs"
            >
              {transitioningId === order.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4 stroke-[2.5]" />
              )}
              <span>Accept Order</span>
            </Button>
          )}
        />

        {/* Column 2: Preparing (ACCEPTED + PREPARING) */}
        <KanbanColumn
          title="Preparing"
          icon={<CookingPot className="h-4 w-4 text-amber-500" />}
          count={board.preparingOrders.length}
          badgeClass="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
          orders={board.preparingOrders}
          onSelectOrder={setSelectedOrder}
          renderActions={(order) =>
            order.status === "ACCEPTED" ? (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickTransition(order.id, "PREPARING");
                }}
                disabled={transitioningId === order.id}
                className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
              >
                {transitioningId === order.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CookingPot className="h-4 w-4" />
                )}
                <span>Start Preparing</span>
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuickTransition(order.id, "READY");
                }}
                disabled={transitioningId === order.id}
                className="w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              >
                {transitioningId === order.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>Mark Ready</span>
              </Button>
            )
          }
        />

        {/* Column 3: Ready for Pickup (READY) */}
        <KanbanColumn
          title="Ready for Pickup"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          count={board.readyOrders.length}
          badgeClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          orders={board.readyOrders}
          onSelectOrder={setSelectedOrder}
          renderActions={() => (
            <Link
              href="/staff/pickup"
              onClick={(e) => e.stopPropagation()}
              className={buttonVariants({
                size: "sm",
                className: "w-full min-h-[44px] h-11 sm:h-12 rounded-xl text-xs sm:text-sm font-bold gap-2 shadow-xs bg-primary text-primary-foreground",
              })}
            >
              <QrCode className="h-4 w-4" />
              <span>Verify & Collect</span>
            </Link>
          )}
        />

        {/* Column 4: Completed (COLLECTED, REJECTED, CANCELLED) */}
        <KanbanColumn
          title="Completed Today"
          icon={<CheckCheck className="h-4 w-4 text-muted-foreground" />}
          count={board.completedOrders.length}
          badgeClass="bg-muted text-muted-foreground border-border"
          orders={board.completedOrders}
          onSelectOrder={setSelectedOrder}
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
  onSelectOrder: (order: BoardOrder) => void;
  renderActions?: (order: BoardOrder) => React.ReactNode;
  isCompletedColumn?: boolean;
}

function KanbanColumn({
  title,
  icon,
  count,
  badgeClass,
  orders,
  onSelectOrder,
  renderActions,
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
        <Badge variant="outline" className={cn("text-[11px] font-bold h-5 px-2", badgeClass)}>
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
          orders.map((order) => {
            const startPrepBy = calculateStartPreparingBy(
              order.estimated_ready_at,
              order.prep_minutes_total
            );

            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className={cn(
                  "cursor-pointer rounded-xl border p-3.5 space-y-2.5 transition-all shadow-2xs hover:shadow-xs",
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
                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
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

                {/* Bottom Action Button */}
                {renderActions && (
                  <div className="pt-1">{renderActions(order)}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
