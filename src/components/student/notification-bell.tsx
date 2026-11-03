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
        "group/bell relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-[#FFFDF5] dark:bg-[#231F1C] border border-[#ded0be] dark:border-[#3D352B] text-[#DC2626] dark:text-[#EF4444] hover:border-[#DC2626]/60 dark:hover:border-[#EF4444]/60 transition-colors shadow-xs active:scale-95 cursor-pointer",
        isRinging && "border-[#DC2626] dark:border-[#EF4444] shadow-[0_0_12px_rgba(220,38,38,0.35)]"
      )}
      aria-label={`Notifications (${unreadCount} unread)`}
    >
      <Bell
        className={cn(
          "h-4 w-4 sm:h-5 sm:w-5 origin-top transition-transform duration-200 text-[#DC2626] dark:text-[#EF4444] group-hover/bell:animate-bell-ring",
          isRinging && "animate-bell-ring"
        )}
      />
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#DC2626] dark:bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-[#FFFDF5] dark:ring-[#231F1C] shadow-xs animate-in zoom-in-75 group-hover/bell:animate-bell-badge",
            isRinging && "animate-bell-badge"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

