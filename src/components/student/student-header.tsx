"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { User } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getNotificationsAction } from "@/server/actions/notifications";
import { NotificationBell } from "@/components/student/notification-bell";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";
import { isProfileHeaderActive } from "@/lib/student-nav";
import { cn } from "@/lib/utils";

interface StudentHeaderProps {
  userId: string;
  initialUnreadCount?: number;
}

export function StudentHeader({ userId, initialUnreadCount = 0 }: StudentHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { startTransition } = useNavigationTransition();
  const isProfileActive = isProfileHeaderActive(pathname);
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
      <Link href="/" prefetch={true} className="flex items-center gap-2 sm:gap-3 group min-h-[44px] py-1 select-none min-w-0">
        <div className="relative flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl overflow-hidden shadow-xs group-hover:scale-105 transition-transform bg-[#FFFDF5] dark:bg-[#1E202B] p-0.5 border border-black/5 dark:border-white/10">
          <Image
            src="/brand/campbite-logo.png"
            alt="C@mpBite"
            width={48}
            height={48}
            className="w-full h-full object-contain"
            priority
          />
        </div>
        <div className="flex flex-col justify-center min-w-0">
          <span className="text-[9.5px] xs:text-[10.5px] sm:text-xs font-brand tracking-[0.05em] sm:tracking-[0.12em] text-[#7a4500] dark:text-[#FACC15] font-medium leading-none uppercase select-none truncate">
            SKIP THE QUEUE, GRAB THE FOOD
          </span>
          <h1 className="select-none pt-1 leading-none">
            <span className="sr-only">C@mpBite</span>
            <Image
              src="/brand/campbite-title-light.png"
              alt="C@MPBITE"
              width={180}
              height={29}
              className="h-5 xs:h-6 sm:h-7 w-auto object-contain dark:hidden"
              priority
            />
            <Image
              src="/brand/campbite-title-dark.png"
              alt="C@MPBITE"
              width={180}
              height={29}
              className="h-5 xs:h-6 sm:h-7 w-auto object-contain hidden dark:block"
              priority
            />
          </h1>
        </div>
      </Link>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Notification Bell with unread badge */}
        <NotificationBell unreadCount={unreadCount} />

        {/* Profile Button (far right) */}
        <Link
          href="/profile"
          prefetch={true}
          onClick={() => {
            if (!isProfileActive) {
              startTransition("/profile", "Student Profile");
            }
          }}
          className={cn(
            "relative flex h-10 w-10 sm:h-11 sm:w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border transition-all active:scale-95 shadow-sm select-none cursor-pointer",
            isProfileActive
              ? "bg-[#181615] text-[#fe7543] border-[#fe7543] dark:bg-[#121319] dark:text-[#FBBF24] dark:border-[#FBBF24] shadow-[0_0_12px_rgba(254,117,67,0.3)] dark:shadow-[0_0_12px_rgba(251,191,36,0.25)]"
              : "bg-[#1b1917] dark:bg-[#121319] border-[#36322e] dark:border-[#222533] text-[#ded5c4] dark:text-slate-300 hover:text-[#f5efe4] dark:hover:text-white hover:border-[#d9531e]/70 dark:hover:border-[#FBBF24]/50"
          )}
          aria-label="Profile"
          title="Profile"
          aria-current={isProfileActive ? "page" : undefined}
        >
          <User className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="sr-only">Profile</span>
        </Link>
      </div>
    </header>
  );
}
