"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Clock, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatIstDateTime } from "@/lib/order-status";
import {
  type NotificationItem,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  getNotificationsAction,
} from "@/server/actions/notifications";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationsViewProps {
  userId: string;
  initialNotifications: NotificationItem[];
}

export function NotificationsView({ userId, initialNotifications }: NotificationsViewProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // Refresh notifications list
  const refreshList = async () => {
    try {
      const res = await getNotificationsAction(40);
      if (res.success) {
        setNotifications(res.notifications);
      }
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as NotificationItem;
          if (newNotif) {
            setNotifications((prev) => [newNotif, ...prev.filter((n) => n.id !== newNotif.id)]);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as NotificationItem;
          if (updated) {
            setNotifications((prev) =>
              prev.map((n) => (n.id === updated.id ? { ...n, is_read: updated.is_read } : n))
            );
          }
        }
      )
      .subscribe();

    // Polling fallback every 10s when document is visible
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      refreshList();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      await markNotificationReadAction(notif.id);
    }

    if (notif.order_id) {
      router.push(`/orders/${notif.order_id}`);
    }
  };

  const handleMarkAllRead = async () => {
    setIsMarkingAll(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    try {
      const res = await markAllNotificationsReadAction();
      if (!res.success) {
        toast.error("Failed to mark all as read");
        refreshList();
      } else {
        toast.success("All notifications marked as read");
      }
    } catch {
      toast.error("Network error");
      refreshList();
    } finally {
      setIsMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Notifications</h1>
          <p className="text-xs text-muted-foreground">
            Order progress updates and kitchen alerts
          </p>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isMarkingAll}
            className="min-h-[44px] px-3 text-xs font-semibold gap-1.5 text-primary hover:text-primary"
          >
            <CheckCheck className="h-4 w-4" />
            <span>Mark all read</span>
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-card p-8 text-center space-y-3 my-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Bell className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-sm font-bold">No notifications yet</h2>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              You will receive live alerts here when your orders are accepted, prepared, and ready for pickup.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/menu"
              className="inline-flex min-h-[44px] items-center gap-1.5 px-4 text-xs font-semibold text-primary hover:underline"
            >
              Browse Menu &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((notif) => {
            const isReady =
              notif.title.toLowerCase().includes("ready") ||
              notif.body.toLowerCase().includes("ready");

            return (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleNotificationClick(notif)}
                aria-label={`${notif.title}: ${notif.body}`}
                className={cn(
                  "relative group w-full cursor-pointer overflow-hidden rounded-xl border p-3.5 transition-all text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
                  isReady
                    ? "border-emerald-500/30 bg-emerald-500/10 hover:border-emerald-500/50 shadow-2xs"
                    : notif.is_read
                    ? "border-border/70 bg-card hover:border-foreground/20 hover:shadow-2xs"
                    : "border-primary/30 bg-primary/5 hover:border-primary/50 shadow-2xs"
                )}
              >
                {/* Unread indicator badge */}
                {!notif.is_read && (
                  <span className="absolute top-3.5 right-3.5 flex h-2 w-2 rounded-full bg-primary" />
                )}

                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      isReady
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : notif.is_read
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary text-primary-foreground shadow-2xs"
                    )}
                  >
                    {isReady ? (
                      <CheckCircle2 className="h-4 w-4 stroke-[2.25]" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                  </div>

                  <div className="flex-1 space-y-1 pr-3">
                    <div className="flex items-center gap-2">
                      <h2
                        className={cn(
                          "text-xs font-bold leading-none",
                          isReady ? "text-emerald-900 dark:text-emerald-200" : "text-foreground"
                        )}
                      >
                        {notif.title}
                      </h2>
                      {isReady && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-200">
                          <Sparkles className="h-2.5 w-2.5" /> Ready for Pickup
                        </span>
                      )}
                    </div>

                    <p
                      className={cn(
                        "text-xs leading-snug",
                        isReady
                          ? "text-emerald-800 dark:text-emerald-300 font-medium"
                          : "text-muted-foreground"
                      )}
                    >
                      {notif.body}
                    </p>

                    <div className="flex items-center justify-between pt-1">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {formatIstDateTime(notif.created_at)}
                      </span>

                      {notif.order_id && (
                        <span className="text-[10px] font-semibold text-primary inline-flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                          View Order <ArrowRight className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
