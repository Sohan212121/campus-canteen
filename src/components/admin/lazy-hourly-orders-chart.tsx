"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

export const LazyHourlyOrdersChart = dynamic<React.ComponentProps<typeof import("./hourly-orders-chart").HourlyOrdersChart>>(
  () => import("./hourly-orders-chart").then((mod) => mod.HourlyOrdersChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] w-full pt-4 flex flex-col items-center justify-center bg-muted/20 rounded-xl text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-xs">Loading analytics chart...</span>
      </div>
    ),
  }
);
