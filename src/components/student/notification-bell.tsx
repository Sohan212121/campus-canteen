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
        "group/bell relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-border/80 bg-card text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-muted hover:border-amber-500/40 hover:shadow-[0_0_12px_rgba(245,158,11,0.15)] dark:bg-[#201c19] dark:border-[#352f2a] dark:text-stone-300 dark:hover:text-white dark:hover:border-amber-500/50 active:scale-95",
        isRinging && "border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)] text-foreground"
      )}
      aria-label={`Notifications (${unreadCount} unread)`}
    >
      <Bell
        className={cn(
          "h-4 w-4 sm:h-5 sm:w-5 origin-top transition-colors duration-200 group-hover/bell:text-amber-500 group-hover/bell:animate-bell-ring",
          isRinging && "animate-bell-ring text-amber-500"
        )}
      />
      {unreadCount > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground dark:bg-amber-500 dark:text-stone-950 shadow-xs animate-in zoom-in-75 group-hover/bell:animate-bell-badge",
            isRinging && "animate-bell-badge"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

