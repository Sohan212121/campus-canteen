"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { UtensilsCrossed, Leaf } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getNotificationsAction } from "@/server/actions/notifications";
import { NotificationBell } from "@/components/student/notification-bell";

interface StudentHeaderProps {
  userId: string;
  initialUnreadCount?: number;
}

export function StudentHeader({ userId, initialUnreadCount = 0 }: StudentHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isHealthy = pathname === "/healthy";
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
          href={isHealthy ? "/" : "/healthy"}
          prefetch={true}
          className={`group/healthy h-11 px-3 sm:px-3.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all select-none cursor-pointer ${
            isHealthy
              ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
              : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 hover:border-emerald-500/60 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
          }`}
          title={isHealthy ? "Back to Campus Canteen menu" : "Healthy Mode & High-Protein Fuel"}
          aria-label="Healthy Mode"
        >
          <Leaf
            className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover/healthy:rotate-12 ${
              isHealthy ? "text-white" : "text-emerald-600 dark:text-emerald-400"
            }`}
          />
          <span className="font-extrabold tracking-tight">Healthy</span>
          <span className="hidden sm:inline font-extrabold tracking-tight">
            {isHealthy ? "Active" : "Mode"}
          </span>
        </Link>

        <NotificationBell unreadCount={unreadCount} />
      </div>
    </header>
  );
}
