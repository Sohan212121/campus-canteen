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
        "group/bell relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-[#181615] border border-[#443b35] text-[#efe3cb] hover:text-[#ffb94e] hover:border-[#fe7543]/70 transition-colors shadow-sm active:scale-95",
        isRinging && "border-[#fe7543] shadow-[0_0_12px_rgba(254,117,67,0.4)] text-[#ffb94e]"
      )}
      aria-label={`Notifications (${unreadCount} unread)`}
    >
      <Bell
        className={cn(
          "h-4 w-4 sm:h-5 sm:w-5 origin-top transition-colors duration-200 group-hover/bell:text-[#ffb94e] group-hover/bell:animate-bell-ring",
          isRinging && "animate-bell-ring text-[#ffb94e]"
        )}
      />
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#fe7543] px-1 text-[10px] font-bold text-[#181615] ring-2 ring-[#181615] shadow-xs animate-in zoom-in-75 group-hover/bell:animate-bell-badge",
            isRinging && "animate-bell-badge"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

