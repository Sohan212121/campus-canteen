"use client";

import { useState } from "react";
import {
  TrendingUp,
  ShoppingBag,
  Clock,
  Ban,
  UtensilsCrossed,
} from "lucide-react";
import { LazyHourlyOrdersChart } from "./lazy-hourly-orders-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaise } from "@/lib/money";
import {
  getAdminDashboardStatsAction,
  type DashboardStats,
} from "@/server/actions/admin";

interface DashboardViewProps {
  initialStats: DashboardStats;
  initialPreset: string;
}

export function DashboardView({ initialStats, initialPreset }: DashboardViewProps) {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [preset, setPreset] = useState<string>(initialPreset);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handlePresetChange = async (newPreset: string) => {
    if (newPreset === preset || isLoading) return;
    setPreset(newPreset);
    setIsLoading(true);

    try {
      const res = await getAdminDashboardStatsAction(newPreset);
      if (res.success && res.data) {
        setStats(res.data);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Derive active orders from status counts
  const activeOrdersCount =
    (stats.orders_by_status["PLACED"] || 0) +
    (stats.orders_by_status["ACCEPTED"] || 0) +
    (stats.orders_by_status["PREPARING"] || 0) +
    (stats.orders_by_status["READY"] || 0);

  const collectedCount = stats.orders_by_status["COLLECTED"] || 0;

  // Format chart data
  const chartData = stats.orders_by_hour.map((item) => ({
    hourLabel: `${String(item.hour).padStart(2, "0")}:00`,
    count: item.count,
  }));

  return (
    <div className="space-y-6">
      {/* Header & Range Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Platform performance and order metrics across Asia/Kolkata (IST).
          </p>
        </div>

        {/* Range Presets */}
        <div className="flex items-center gap-1.5 rounded-lg border bg-muted p-1">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handlePresetChange("today")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              preset === "today"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Today (IST)
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handlePresetChange("7d")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              preset === "7d"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handlePresetChange("30d")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              preset === "30d"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Last 30 Days
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Orders */}
        <Card className="border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Orders Placed
            </CardTitle>
            <ShoppingBag className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {stats.total_placed.toLocaleString()}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {collectedCount}
              </span>{" "}
              collected & completed
            </p>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card className="border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Collected Revenue
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {formatPaise(stats.revenue_paise)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              From settled collected orders
            </p>
          </CardContent>
        </Card>

        {/* Active Queue */}
        <Card className="border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Live Queue Load
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {activeOrdersCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Avg prep duration: <span className="font-semibold">{stats.avg_prep_minutes}m</span>
            </p>
          </CardContent>
        </Card>

        {/* Cancellation Rate */}
        <Card className="border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Cancellations
            </CardTitle>
            <Ban className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-rose-500">
              {stats.cancellation_rate}%
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="font-semibold">{stats.total_cancelled}</span> orders cancelled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Orders Distribution Chart */}
      <Card className="border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Orders by Hour of Day (Asia/Kolkata)</span>
            <Badge variant="outline" className="text-xs font-mono font-medium">
              24-Hour Distribution
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LazyHourlyOrdersChart data={chartData} />
        </CardContent>
      </Card>

      {/* Top 10 Popular Items */}
      <Card className="border shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UtensilsCrossed className="h-4 w-4 text-primary" />
            Top 10 Menu Items by Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.top_items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No orders placed in this time range.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {stats.top_items.map((item, idx) => (
                <div
                  key={`${item.name}-${idx}`}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold font-mono">
                      {idx + 1}
                    </span>
                    <span className="font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <span className="text-xs text-muted-foreground font-semibold">
                      {item.quantity.toLocaleString()} units
                    </span>
                    <span className="font-mono font-semibold text-xs sm:text-sm text-primary w-24">
                      {formatPaise(item.revenue_paise)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
