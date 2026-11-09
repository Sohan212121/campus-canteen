"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Receipt,
  Clock,
  ArrowRight,
  RotateCcw,
  Loader2,
  ChevronRight,
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
  getStatusBadgeConfig,
} from "@/lib/order-status";
import { getReorderItemsAction } from "@/server/actions/order";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { extractMenuItemImageUrl } from "@/lib/image-utils";
import {
  ACTIVE_ORDER_STATUSES,
  mergePastOrders,
  createResumeDebouncer,
} from "@/lib/orders-list-helpers";
import { cn } from "@/lib/utils";

export interface OrderSummaryItem {
  id: string;
  order_code: string;
  status: string;
  total_paise: number;
  placed_at: string;
  estimated_ready_at: string;
  pickup_window_end: string;
  canteens: {
    name: string;
    location: string | null;
  } | null;
  order_items: Array<{
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price_paise: number;
    image_url?: string | null;
  }>;
};

interface OrdersListViewProps {
  userId: string;
  initialActiveOrders: OrderSummaryItem[];
  initialPastOrders: OrderSummaryItem[];
  totalPastCount: number;
}

export function OrdersListView({
  userId,
  initialActiveOrders,
  initialPastOrders,
  totalPastCount,
}: OrdersListViewProps) {
  const router = useRouter();
  const [activeOrders, setActiveOrders] = useState<OrderSummaryItem[]>(initialActiveOrders);
  const [pastOrders, setPastOrders] = useState<OrderSummaryItem[]>(initialPastOrders);
  const [hasMorePast, setHasMorePast] = useState<boolean>(initialPastOrders.length < totalPastCount);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const isRefreshingRef = useRef(false);

  // Helper to format raw order query results
  const formatOrderRow = useCallback((d: {
    id: string;
    order_code: string;
    status: string;
    total_paise: number;
    placed_at: string;
    estimated_ready_at: string;
    pickup_window_end: string;
    canteens: { name: string; location: string | null } | Array<{ name: string; location: string | null }> | null;
    order_items?: Array<{
      id: string;
      name_snapshot: string;
      quantity: number;
      unit_price_paise: number;
      menu_items?: { image_url?: string | null } | Array<{ image_url?: string | null }> | null;
    }> | null;
  }): OrderSummaryItem => ({
    ...d,
    canteens: Array.isArray(d.canteens) ? d.canteens[0] : d.canteens,
    order_items: (d.order_items || []).map((item) => ({
      id: item.id,
      name_snapshot: item.name_snapshot,
      quantity: item.quantity,
      unit_price_paise: item.unit_price_paise,
      image_url: extractMenuItemImageUrl(item.menu_items),
    })),
  }), []);

  // Refresh active and latest past orders, merging without flicker
  const refreshOrders = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      const supabase = createClient();
      const [activeRes, pastRes] = await Promise.all([
        supabase
          .from("orders")
          .select(`
            id,
            order_code,
            status,
            total_paise,
            placed_at,
            estimated_ready_at,
            pickup_window_end,
            canteens (name, location),
            order_items (
              id,
              name_snapshot,
              quantity,
              unit_price_paise,
              menu_items (image_url)
            )
          `)
          .eq("user_id", userId)
          .in("status", ACTIVE_ORDER_STATUSES)
          .order("placed_at", { ascending: false }),

        supabase
          .from("orders")
          .select(`
            id,
            order_code,
            status,
            total_paise,
            placed_at,
            estimated_ready_at,
            pickup_window_end,
            canteens (name, location),
            order_items (
              id,
              name_snapshot,
              quantity,
              unit_price_paise,
              menu_items (image_url)
            )
          `, { count: "exact" })
          .eq("user_id", userId)
          .not("status", "in", '("PLACED","ACCEPTED","PREPARING","READY")')
          .order("placed_at", { ascending: false })
          .range(0, 19),
      ]);

      if (activeRes.data) {
        const formattedActive = activeRes.data.map(formatOrderRow);
        setActiveOrders(formattedActive);
      }

      if (pastRes.data) {
        const formattedPast = pastRes.data.map(formatOrderRow);
        setPastOrders((prev) => mergePastOrders(prev, formattedPast));
      }
    } catch {
      // Ignore background refresh errors
    } finally {
      isRefreshingRef.current = false;
    }
  }, [userId, formatOrderRow]);

  // 1. Refresh on mount (guarantees fresh data even if client router cache served initial props)
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        refreshOrders();
      }
    });
    return () => {
      active = false;
    };
  }, [refreshOrders]);

  // 2. Resume handling: visibilitychange, pageshow (bfcache), focus, and online (leading + trailing debounced)
  useEffect(() => {
    const debouncer = createResumeDebouncer(() => {
      refreshOrders();
    }, 750);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        debouncer.trigger();
      }
    };
    const handlePageShow = () => {
      debouncer.trigger();
    };
    const handleFocus = () => {
      debouncer.trigger();
    };
    const handleOnline = () => {
      debouncer.trigger();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      debouncer.cancel();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshOrders]);

  // 3. Realtime subscription on public.orders for user_id + 10s background polling fallback
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`orders-list-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refreshOrders();
        }
      )
      .subscribe();

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshOrders();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [userId, refreshOrders]);

  const handleLoadMorePast = async () => {
    setIsLoadingMore(true);
    try {
      const supabase = createClient();
      const { data, count } = await supabase
        .from("orders")
        .select(`
          id,
          order_code,
          status,
          total_paise,
          placed_at,
          estimated_ready_at,
          pickup_window_end,
          canteens (name, location),
          order_items (
            id,
            name_snapshot,
            quantity,
            unit_price_paise,
            menu_items (image_url)
          )
        `, { count: "exact" })
        .eq("user_id", userId)
        .not("status", "in", '("PLACED","ACCEPTED","PREPARING","READY")')
        .order("placed_at", { ascending: false })
        .range(pastOrders.length, pastOrders.length + 19);

      if (data && data.length > 0) {
        const formatted = data.map(formatOrderRow);
        const updated = mergePastOrders(pastOrders, formatted);
        setPastOrders(updated);
        setHasMorePast(updated.length < (count ?? totalPastCount));
      } else {
        setHasMorePast(false);
      }
    } catch {
      toast.error("Failed to load more orders");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleReorder = async (orderId: string) => {
    setReorderingId(orderId);
    try {
      const res = await getReorderItemsAction(orderId);

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
      setReorderingId(null);
    }
  };

  const hasAnyOrders = activeOrders.length > 0 || pastOrders.length > 0;

  if (!hasAnyOrders) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Your Orders</h1>
          <p className="text-xs text-muted-foreground">
            Track active kitchen prep and view past pickup tokens.
          </p>
        </header>

        <div className="rounded-2xl border border-dashed border-border/80 bg-card p-8 text-center space-y-4 my-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Receipt className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold">No orders yet</h2>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              When you place pre-orders, your live order status and pickup tokens will appear here.
            </p>
          </div>
          <Link
            href="/menu"
            className={buttonVariants({
              className: "rounded-xl h-11 px-6 font-semibold gap-2 inline-flex items-center",
            })}
          >
            Browse Menu <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Your Orders</h1>
        <p className="text-xs text-muted-foreground">
          Track active kitchen prep and reorder your campus favorites.
        </p>
      </header>

      {/* SECTION 1: ACTIVE ORDERS (PINNED ON TOP) */}
      {activeOrders.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Active Pre-Orders ({activeOrders.length})
            </h2>
          </div>

          <div className="space-y-3">
            {activeOrders.map((order) => {
              const badge = getStatusBadgeConfig(order.status);
              const isReady = order.status === "READY";

              return (
                <div
                  key={order.id}
                  className={cn(
                    "relative overflow-hidden rounded-2xl border p-4 shadow-2xs space-y-3 transition-all",
                    isReady
                      ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-card to-card ring-1 ring-emerald-500/30"
                      : "border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">
                          #{order.order_code}
                        </span>
                        <Badge variant={badge.variant} className={cn("text-[10px]", badge.className)}>
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {order.canteens?.name ?? "C@mpBite"}
                      </p>
                    </div>

                    <span className="text-sm font-bold text-foreground">
                      {formatPaise(order.total_paise)}
                    </span>
                  </div>

                  {/* Pickup Window Highlight */}
                  <div className="flex items-center gap-1.5 rounded-xl bg-muted/60 p-2.5 text-xs">
                    <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-muted-foreground">Expected Ready:</span>
                    <span className="font-bold text-foreground">
                      {formatIstTime(order.estimated_ready_at)}
                    </span>
                    <span className="text-muted-foreground text-[11px] ml-auto">
                      ({formatIstTime(order.estimated_ready_at)} – {formatIstTime(order.pickup_window_end)})
                    </span>
                  </div>

                  {/* Line Items Preview with Thumbnails */}
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
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {order.order_items
                        .map((item) => `${item.quantity}× ${item.name_snapshot}`)
                        .join(", ")}
                    </p>
                  </div>

                  {/* Direct Link to Track & View QR */}
                  <Link
                    href={`/orders/${order.id}`}
                    className={buttonVariants({
                      className: cn(
                        "w-full min-h-[44px] h-11 text-xs font-bold rounded-xl gap-2 inline-flex items-center justify-center shadow-xs",
                        isReady
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                          : ""
                      ),
                    })}
                  >
                    <span>Track Order & View Token</span>
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECTION 2: PAST ORDERS (PAGINATED 20 WITH LOAD MORE) */}
      {pastOrders.length > 0 && (
        <section className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Past Orders
            </h2>
          </div>

          <div className="space-y-3">
            {pastOrders.map((order) => {
              const badge = getStatusBadgeConfig(order.status);
              const isReorderingThis = reorderingId === order.id;

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs hover:border-foreground/20 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">
                          #{order.order_code}
                        </span>
                        <Badge variant={badge.variant} className={cn("text-[10px]", badge.className)}>
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatIstDateTime(order.placed_at)} &bull; {order.canteens?.name ?? "C@mpBite"}
                      </p>
                    </div>

                    <span className="text-xs font-bold text-foreground">
                      {formatPaise(order.total_paise)}
                    </span>
                  </div>

                  {/* Items summary with Thumbnails */}
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
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {order.order_items
                        .map((item) => `${item.quantity}× ${item.name_snapshot}`)
                        .join(", ")}
                    </div>
                  </div>

                  {/* Bottom Action Buttons */}
                  <div className="flex items-center justify-between pt-1 gap-2 border-t border-border/60">
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-xs font-semibold text-primary hover:underline min-h-[44px] inline-flex items-center gap-1 px-1"
                    >
                      View Details &rarr;
                    </Link>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReorder(order.id)}
                      disabled={isReorderingThis}
                      className="min-h-[44px] h-11 px-3.5 rounded-xl text-xs font-bold gap-1.5"
                    >
                      {isReorderingThis ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      <span>Reorder</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load More Button */}
          {hasMorePast && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMorePast}
                disabled={isLoadingMore}
                className="w-full min-h-[44px] h-11 rounded-xl text-xs font-bold gap-2"
              >
                {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Load More Past Orders</span>
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
