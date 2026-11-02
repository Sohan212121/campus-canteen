"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { Leaf } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getNotificationsAction } from "@/server/actions/notifications";
import { NotificationBell } from "@/components/student/notification-bell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";

interface StudentHeaderProps {
  userId: string;
  initialUnreadCount?: number;
}

export function StudentHeader({ userId, initialUnreadCount = 0 }: StudentHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { startTransition } = useNavigationTransition();
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
    <header className="flex items-center justify-between pb-3.5 mb-2 border-b border-[#ded5c4] dark:border-[#1E202B]">
      <Link href="/" prefetch={true} className="flex items-center gap-2.5 sm:gap-3 group min-h-[44px] py-1 select-none">
        <div className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl overflow-hidden shadow-sm group-hover:scale-105 transition-transform">
          <Image
            src="/brand/logo.png"
            alt="C@mpBite"
            width={48}
            height={48}
            className="w-full h-full object-cover"
            priority
          />
        </div>
        <div className="flex flex-col justify-center">
          <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-[#c2630d] dark:text-[#FBBF24] font-headline leading-tight">
            Good Food. Fast Vibes.
          </span>
          <h1 className="select-none pt-0.5 leading-none">
            <span className="sr-only">C@mpBite</span>
            <Image
              src="/brand/campbite-title-light.png"
              alt="C@MPBITE"
              width={180}
              height={29}
              className="h-6 sm:h-7 w-auto object-contain dark:hidden"
              priority
            />
            <Image
              src="/brand/campbite-title-dark.png"
              alt="C@MPBITE"
              width={180}
              height={29}
              className="h-6 sm:h-7 w-auto object-contain hidden dark:block"
              priority
            />
          </h1>
        </div>
      </Link>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <Link
          href={isHealthy ? "/" : "/healthy"}
          prefetch={true}
          onClick={() => {
            startTransition(isHealthy ? "/" : "/healthy", isHealthy ? "Campus Dining" : "Healthy Mode");
          }}
          className={`group/healthy h-10 sm:h-11 px-2.5 sm:px-3.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all select-none cursor-pointer ${
            isHealthy
              ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
              : "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 hover:border-emerald-500/60 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
          }`}
          title={isHealthy ? "Back to C@mpBite menu" : "Healthy Mode & High-Protein Fuel"}
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

        {/* Light & Dark Theme Toggle Button */}
        <ThemeToggle />

        <NotificationBell unreadCount={unreadCount} />
      </div>
    </header>
  );
}
