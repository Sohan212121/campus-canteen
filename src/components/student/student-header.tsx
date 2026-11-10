"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { User } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { getNotificationsAction } from "@/server/actions/notifications";
import { useAvatarSignedUrl } from "@/lib/use-avatar-signed-url";
import { BrandWordmark } from "@/components/ui/brand-wordmark";
import { NotificationBell } from "@/components/student/notification-bell";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";
import { isProfileHeaderActive } from "@/lib/student-nav";
import { cn } from "@/lib/utils";

interface StudentHeaderProps {
  userId: string;
  initialUnreadCount?: number;
  initialAvatarUrl?: string | null;
  avatarLookupTimedOut?: boolean;
  fullName?: string | null;
}

export function StudentHeader({
  userId,
  initialUnreadCount = 0,
  initialAvatarUrl = null,
  avatarLookupTimedOut = false,
  fullName = null,
}: StudentHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { startTransition } = useNavigationTransition();
  const isProfileActive = isProfileHeaderActive(pathname);
  const [unreadCount, setUnreadCount] = useState<number>(initialUnreadCount);
  const { avatarUrl, showAvatarImage, handleImageError } = useAvatarSignedUrl({
    initialAvatarUrl,
    avatarLookupTimedOut,
  });
  const toastedNotificationIds = useRef<Set<string>>(new Set());

  // Derive initials for fallback display
  const initials = (fullName || "")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Refresh notifications unread count
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
      <Link
        href="/"
        prefetch={true}
        className="flex items-center gap-2 sm:gap-3 group min-h-[44px] py-1 select-none min-w-0 transition-transform active:scale-95 duration-100"
      >
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
            <BrandWordmark
              priority
              imageClassName="h-5 xs:h-6 sm:h-7 w-auto object-contain"
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
            "relative flex h-10 w-10 sm:h-11 sm:w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border transition-all active:scale-95 shadow-xs select-none cursor-pointer overflow-hidden",
            isProfileActive
              ? "bg-[#FEE2E2] dark:bg-[#381B1B] text-[#DC2626] dark:text-[#EF4444] border-[#DC2626] dark:border-[#EF4444] shadow-[0_0_12px_rgba(220,38,38,0.25)]"
              : "bg-[#FFFDF5] dark:bg-[#231F1C] border-[#ded0be] dark:border-[#3D352B] text-[#DC2626] dark:text-[#EF4444] hover:border-[#DC2626]/60 dark:hover:border-[#EF4444]/60"
          )}
          aria-label="Profile"
          title="Profile"
          aria-current={isProfileActive ? "page" : undefined}
        >
          {showAvatarImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl!}
              alt={fullName || "Profile"}
              className="w-full h-full object-cover rounded-full"
              onError={handleImageError}
            />
          ) : initials ? (
            <span className="text-xs sm:text-sm font-bold tracking-tight text-[#DC2626] dark:text-[#EF4444] select-none">
              {initials}
            </span>
          ) : (
            <User className="h-4 w-4 sm:h-5 sm:w-5 text-[#DC2626] dark:text-[#EF4444]" />
          )}
          <span className="sr-only">Profile</span>
        </Link>
      </div>
    </header>
  );
}
