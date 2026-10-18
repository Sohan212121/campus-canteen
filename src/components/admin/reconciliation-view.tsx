"use client";

import { useState, useCallback } from "react";
import {
  IndianRupee,
  Clock,
  AlertTriangle,
  Building,
  User,
  CreditCard,
  Banknote,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatPaise } from "@/lib/money";
import {
  type DailyReconciliationData,
  getDailyReconciliationAction,
} from "@/server/actions/admin";
import { LiveRefresh } from "@/components/ui/live-refresh";

interface ReconciliationViewProps {
  initialData: DailyReconciliationData;
}

export function ReconciliationView({ initialData }: ReconciliationViewProps) {
  const [data, setData] = useState<DailyReconciliationData>(initialData);
  const [selectedDate, setSelectedDate] = useState<string>(initialData.date);

  const fetchReconciliation = useCallback(
    async (dateStr?: string) => {
      const targetDate = dateStr ?? selectedDate;
      try {
        const res = await getDailyReconciliationAction(targetDate);
        if (res.success && res.data) {
          setData(res.data);
        }
      } catch {
        // Handled by refresh
      }
    },
    [selectedDate]
  );

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    fetchReconciliation(newDate);
  };

  const summary = data.summary;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Reconciliation</h1>
          <p className="text-xs text-muted-foreground">
            End-of-day audit of collections, payment methods, manual overrides, and expired orders.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-9 w-40 text-xs font-medium"
            />
          </div>
          <LiveRefresh
            onRefresh={() => fetchReconciliation()}
            label="Reconciliation refreshed"
          />
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Revenue */}
        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total Revenue
            </CardTitle>
            <IndianRupee className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {formatPaise(summary.total_collected_paise)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {summary.total_collected_count} collected orders
            </p>
          </CardContent>
        </Card>

        {/* Cash vs UPI */}
        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Payment Split
            </CardTitle>
            <Banknote className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between text-sm font-semibold">
              <span className="flex items-center gap-1 text-emerald-600">
                <Banknote className="h-3.5 w-3.5" /> Cash:
              </span>
              <span>{formatPaise(summary.total_cash_paise)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm font-semibold mt-1">
              <span className="flex items-center gap-1 text-indigo-600">
                <CreditCard className="h-3.5 w-3.5" /> UPI:
              </span>
              <span>{formatPaise(summary.total_upi_paise)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Manual Overrides & Late Handover */}
        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Manual Collections
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {summary.total_manual_count}
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
              {summary.total_late_handover_count} late handovers
            </p>
          </CardContent>
        </Card>

        {/* No-Shows / Expired */}
        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              No-Shows / Expired
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">
              {summary.total_no_show_count}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Orders uncollected past hold window
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Canteens Breakdown Table */}
      <Card className="border-border/80 shadow-2xs">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Building className="h-4 w-4 text-primary" />
            <span>Canteen Breakdown</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 text-muted-foreground font-semibold uppercase tracking-wider border-b">
                <tr>
                  <th className="py-2.5 px-4">Canteen</th>
                  <th className="py-2.5 px-4 text-right">Collected</th>
                  <th className="py-2.5 px-4 text-right">Cash (₹)</th>
                  <th className="py-2.5 px-4 text-right">UPI (₹)</th>
                  <th className="py-2.5 px-4 text-right">Total Revenue</th>
                  <th className="py-2.5 px-4 text-right">Manual</th>
                  <th className="py-2.5 px-4 text-right">Late</th>
                  <th className="py-2.5 px-4 text-right">No-Shows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.canteens.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No operational data for this date.
                    </td>
                  </tr>
                ) : (
                  data.canteens.map((c) => (
                    <tr key={c.canteen_id} className="hover:bg-muted/30">
                      <td className="py-2.5 px-4 font-bold text-foreground">
                        {c.canteen_name}
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium">
                        {c.collected_count}
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted-foreground">
                        {formatPaise(c.cash_collected_paise)} ({c.cash_collected_count})
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted-foreground">
                        {formatPaise(c.upi_collected_paise)} ({c.upi_collected_count})
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-foreground">
                        {formatPaise(c.total_collected_paise)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {c.manual_override_count > 0 ? (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                            {c.manual_override_count}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {c.late_handover_count > 0 ? (
                          <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-500/30">
                            {c.late_handover_count}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {c.no_show_count > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {c.no_show_count}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Staff Breakdown Table */}
      <Card className="border-border/80 shadow-2xs">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <span>Staff Collections & Override Rates</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 text-muted-foreground font-semibold uppercase tracking-wider border-b">
                <tr>
                  <th className="py-2.5 px-4">Staff Member</th>
                  <th className="py-2.5 px-4">Canteen</th>
                  <th className="py-2.5 px-4 text-right">Orders Collected</th>
                  <th className="py-2.5 px-4 text-right">Total (₹)</th>
                  <th className="py-2.5 px-4 text-right">Cash / UPI</th>
                  <th className="py-2.5 px-4 text-right">Manual Overrides</th>
                  <th className="py-2.5 px-4 text-right">Manual Rate</th>
                  <th className="py-2.5 px-4 text-right">Late Handovers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.staff.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No staff collection activity recorded on this date.
                    </td>
                  </tr>
                ) : (
                  data.staff.map((s) => (
                    <tr key={`${s.canteen_id}-${s.staff_id}`} className="hover:bg-muted/30">
                      <td className="py-2.5 px-4 font-bold text-foreground">
                        {s.staff_name}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">
                        {s.canteen_name}
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium">
                        {s.collected_count}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-foreground">
                        {formatPaise(s.total_collected_paise)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted-foreground">
                        {s.cash_count} / {s.upi_count}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold">
                        {s.manual_count}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={s.manual_rate_pct > 15 ? "text-amber-600 font-bold" : "text-muted-foreground"}>
                          {s.manual_rate_pct}%
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {s.late_handover_count > 0 ? (
                          <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-500/30">
                            {s.late_handover_count}
                          </Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
