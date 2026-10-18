"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Clock,
  Settings,
  Building,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminUpdateCanteenSettingsAction,
  type CanteenData,
} from "@/server/actions/admin";

interface SettingsViewProps {
  canteen: CanteenData;
}

export function SettingsView({ canteen }: SettingsViewProps) {
  const [opensAt, setOpensAt] = useState(canteen.opens_at);
  const [closesAt, setClosesAt] = useState(canteen.closes_at);
  const [lastOrderTime, setLastOrderTime] = useState(canteen.last_order_time);
  const [kitchenCapacity, setKitchenCapacity] = useState(String(canteen.kitchen_capacity));
  const [minLeadMinutes, setMinLeadMinutes] = useState(String(canteen.min_lead_minutes));
  const [holdMinutes, setHoldMinutes] = useState(String(canteen.hold_minutes));
  const [isSaving, setIsSaving] = useState(false);

  // Live IST Time
  const [currentIstTime, setCurrentIstTime] = useState("");
  const [isOpenNow, setIsOpenNow] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Formatter in Asia/Kolkata
      const istString = now.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
      setCurrentIstTime(istString);

      // 24h format for open comparison
      const istTime24 = now.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const openTime = opensAt.slice(0, 8);
      const closeTime = closesAt.slice(0, 8);
      setIsOpenNow(istTime24 >= openTime && istTime24 <= closeTime);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [opensAt, closesAt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validations
    if (closesAt <= opensAt) {
      toast.error("Closing time must be strictly after opening time.");
      return;
    }

    if (lastOrderTime > closesAt || lastOrderTime < opensAt) {
      toast.error("Last order cutoff time must be within canteen operating hours.");
      return;
    }

    const capacityNum = parseInt(kitchenCapacity, 10);
    if (isNaN(capacityNum) || capacityNum < 1 || capacityNum > 50) {
      toast.error("Kitchen capacity must be between 1 and 50.");
      return;
    }

    const leadNum = parseInt(minLeadMinutes, 10);
    if (isNaN(leadNum) || leadNum < 0 || leadNum > 120) {
      toast.error("Minimum lead buffer must be between 0 and 120 minutes.");
      return;
    }

    const holdNum = parseInt(holdMinutes, 10);
    if (isNaN(holdNum) || holdNum < 5 || holdNum > 120) {
      toast.error("Hold window must be between 5 and 120 minutes.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await adminUpdateCanteenSettingsAction(canteen.id, {
        opens_at: opensAt,
        closes_at: closesAt,
        last_order_time: lastOrderTime,
        kitchen_capacity: capacityNum,
        min_lead_minutes: leadNum,
        hold_minutes: holdNum,
      });

      if (res.success) {
        toast.success("Canteen operational settings saved successfully");
      } else {
        toast.error(res.error || "Failed to save settings");
      }
    } catch {
      toast.error("Network error saving settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Canteen Configuration</h1>
          <p className="text-xs text-muted-foreground">
            Configure daily operating schedules, throughput capacity, and food warming windows.
          </p>
        </div>

        <Badge variant="outline" className="text-xs font-mono font-medium self-start sm:self-auto gap-1.5">
          <Building className="h-3.5 w-3.5" />
          {canteen.name}
        </Badge>
      </div>

      {/* Live Operational Status Banner */}
      <Card className="border shadow-xs overflow-hidden">
        <div className="p-4 bg-muted/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                isOpenNow
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-500"
              }`}
            >
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">Live Canteen Status:</span>
                {isOpenNow ? (
                  <Badge className="bg-emerald-600 text-white font-bold text-[10px]">
                    OPEN NOW
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="font-bold text-[10px]">
                    CLOSED NOW
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Current Time:{" "}
                <span className="font-mono font-bold text-foreground">
                  {currentIstTime || "Calculating..."}
                </span>{" "}
                (Asia/Kolkata)
              </p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground sm:text-right font-mono">
            Hours: {opensAt.slice(0, 5)} - {closesAt.slice(0, 5)} IST
          </div>
        </div>
      </Card>

      {/* Settings Form */}
      <form onSubmit={handleSubmit}>
        <Card className="border shadow-xs">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              Schedule & Kitchen Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-5">
            {/* Operating Times */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Operating Schedule (IST)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Opening Time (Opens At)</label>
                  <Input
                    type="time"
                    step="1"
                    required
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Canteen opens for orders.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Closing Time (Closes At)</label>
                  <Input
                    type="time"
                    step="1"
                    required
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Kitchen stops all operations.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Order Cutoff Time</label>
                  <Input
                    type="time"
                    step="1"
                    required
                    value={lastOrderTime}
                    onChange={(e) => setLastOrderTime(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Cutoff for pre-order placement.</p>
                </div>
              </div>
            </div>

            {/* Kitchen Capacity & Buffers */}
            <div className="space-y-3 pt-3 border-t">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Throughput & Buffer Windows
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Kitchen Capacity (Units)</label>
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={kitchenCapacity}
                    onChange={(e) => setKitchenCapacity(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Throughput factor for load calculation (1-50).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Min Lead Buffer (Minutes)</label>
                  <Input
                    type="number"
                    min="0"
                    max="120"
                    required
                    value={minLeadMinutes}
                    onChange={(e) => setMinLeadMinutes(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Buffer before preparation begins (0-120m).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Hold Window (Minutes)</label>
                  <Input
                    type="number"
                    min="5"
                    max="120"
                    required
                    value={holdMinutes}
                    onChange={(e) => setHoldMinutes(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Duration food is kept warm after readiness before expiring as NO_SHOW (5-120m).
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t flex justify-end">
              <Button type="submit" disabled={isSaving} className="gap-2 font-semibold">
                <Save className="h-4 w-4" />
                {isSaving ? "Saving Settings..." : "Save Canteen Settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
