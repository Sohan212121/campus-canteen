"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getNotificationsAction } from "@/server/actions/notifications";
import { cn } from "@/lib/utils";

interface StudentHeaderProps {
  userId: string;
  initialUnreadCount?: number;
}

export function StudentHeader({ userId, initialUnreadCount = 0 }: StudentHeaderProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState<number>(initialUnreadCount);
  const toastedNotificationIds = useRef<Set<string>>(new Set());

  // Function to fetch latest unread count during polling
  const refreshUnread = useCallback(async () => {
    try {
      const res = await getNotificationsAction(10);
      if (res.success) {
        setUnreadCount(res.unreadCount);
      }
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `student-notifs-${userId}`;

    // 1. Subscribe to Supabase Realtime notifications inserts
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as {
            id: string;
            order_id?: string | null;
            title: string;
            body: string;
            is_read: boolean;
          };

          if (newNotif && !newNotif.is_read) {
            setUnreadCount((prev) => prev + 1);

            // Dedupe toasts by notification ID
            if (!toastedNotificationIds.current.has(newNotif.id)) {
              toastedNotificationIds.current.add(newNotif.id);

              toast(newNotif.title, {
                description: newNotif.body,
                action: newNotif.order_id
                  ? {
                      label: "View Order",
                      onClick: () => router.push(`/orders/${newNotif.order_id}`),
                    }
                  : undefined,
              });
            }
          }
        }
      )
      .subscribe();

    // 2. Polling fallback every 10s, paused when document.hidden
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return; // Paused while backgrounded
      }
      refreshUnread();
    }, 10000);

    // 3. Remove channel and interval on unmount
    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [userId, router, refreshUnread]);

  return (
    <header className="flex items-center justify-between pb-3 mb-2 border-b border-border/60">
      <Link href="/" className="flex items-center gap-2 group">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs group-hover:scale-105 transition-transform">
          <UtensilsCrossed className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight leading-none text-foreground">
            Campus Canteen
          </span>
          <span className="text-[10px] text-muted-foreground font-medium">
            Smart Pickup
          </span>
        </div>
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href="/notifications"
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground transition-colors hover:text-foreground hover:bg-muted active:scale-95"
          )}
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-xs animate-in zoom-in-75">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
