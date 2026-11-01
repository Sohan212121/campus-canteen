"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface NotificationBellProps {
  unreadCount: number;
}

export function NotificationBell({ unreadCount }: NotificationBellProps) {
  const [isRinging, setIsRinging] = useState(false);
  const ringTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerRing = () => {
    setIsRinging(true);
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      setIsRinging(false);
    }, 850);
  };

  useEffect(() => {
    return () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      prefetch={true}
      onMouseEnter={triggerRing}
      onClick={triggerRing}
      className={cn(
        "group/bell relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-[#1b1917] dark:bg-[#121319] border border-[#36322e] dark:border-[#222533] text-[#ded5c4] dark:text-slate-300 hover:text-[#f5efe4] dark:hover:text-white hover:border-[#d9531e]/70 dark:hover:border-[#FBBF24]/50 transition-colors shadow-sm active:scale-95",
        isRinging && "border-[#d9531e] dark:border-[#FBBF24] shadow-[0_0_12px_rgba(217,83,30,0.4)] text-[#d9531e] dark:text-[#FBBF24]"
      )}
      aria-label={`Notifications (${unreadCount} unread)`}
    >
      <Bell
        className={cn(
          "h-4 w-4 sm:h-5 sm:w-5 origin-top transition-colors duration-200 group-hover/bell:text-[#d9531e] dark:group-hover/bell:text-[#FBBF24] group-hover/bell:animate-bell-ring",
          isRinging && "animate-bell-ring text-[#d9531e] dark:text-[#FBBF24]"
        )}
      />
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#d9531e] dark:bg-red-600 px-1 text-[10px] font-bold text-[#f5efe4] dark:text-white ring-2 ring-[#1b1917] dark:ring-[#090A0F] shadow-xs animate-in zoom-in-75 group-hover/bell:animate-bell-badge",
            isRinging && "animate-bell-badge"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

