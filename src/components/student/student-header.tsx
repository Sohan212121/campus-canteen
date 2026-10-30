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
  const [isRinging, setIsRinging] = useState(false);
  const ringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastedNotificationIds = useRef<Set<string>>(new Set());

  // Trigger bell ringing animation on hover, click, or when a new notification arrives
  const triggerRing = useCallback(() => {
    setIsRinging(true);
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    ringTimeoutRef.current = setTimeout(() => {
      setIsRinging(false);
    }, 850);
  }, []);

  const triggerRingRef = useRef(triggerRing);
  useEffect(() => {
    triggerRingRef.current = triggerRing;
  }, [triggerRing]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    };
  }, []);

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
            triggerRingRef.current();

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
      <Link href="/" prefetch={true} className="flex items-center gap-2 group min-h-[44px] py-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-2xs group-hover:scale-105 transition-transform">
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
          prefetch={true}
          onMouseEnter={triggerRing}
          onClick={triggerRing}
          className={cn(
            "group/bell relative flex h-11 w-11 items-center justify-center rounded-xl border border-border/80 bg-card text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-muted hover:border-amber-500/40 hover:shadow-[0_0_12px_rgba(245,158,11,0.15)] active:scale-95",
            isRinging && "border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)] text-foreground"
          )}
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell
            className={cn(
              "h-5 w-5 origin-top transition-colors duration-200 group-hover/bell:text-amber-500",
              isRinging && "animate-bell-ring text-amber-500",
              "group-hover/bell:animate-bell-ring"
            )}
          />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-xs animate-in zoom-in-75",
                isRinging && "animate-bell-badge",
                "group-hover/bell:animate-bell-badge"
              )}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
