"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LiveRefreshProps {
  onRefresh: () => Promise<void> | void;
  intervalMs?: number; // default: 15000 (15 seconds)
  label?: string;
  className?: string;
  pollingOnly?: boolean;
}

export function LiveRefresh({
  onRefresh,
  intervalMs = 15000,
  label = "Data updated",
  className,
  pollingOnly = true,
}: LiveRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const handleRefresh = useCallback(
    async (showToast: boolean = false) => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      try {
        await Promise.resolve(onRefreshRef.current());
        setLastRefreshedAt(new Date());
        if (showToast) {
          toast.success(label);
        }
      } catch {
        if (showToast) {
          toast.error("Failed to refresh data.");
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [isRefreshing, label]
  );

  // Background polling timer
  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;

    const timer = setInterval(() => {
      handleRefresh(false);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, handleRefresh]);

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      {/* Live / Polling badge */}
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shadow-2xs"
        title={`Auto-refreshes every ${Math.round(intervalMs / 1000)}s. Last updated: ${lastRefreshedAt.toLocaleTimeString()}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span>{pollingOnly ? "Live Polling" : "Live"}</span>
      </div>

      {/* Manual refresh button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleRefresh(true)}
        disabled={isRefreshing}
        className="h-8 px-2.5 rounded-lg text-xs font-semibold gap-1.5"
      >
        <RotateCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
        <span>Refresh</span>
      </Button>
    </div>
  );
}
