"use client";

import { useState, useCallback } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Lock,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type StudentStrikeRow,
  adminListStudentStrikesAction,
  adminClearStudentStrikesAction,
} from "@/server/actions/admin";
import { formatIstDateTime } from "@/lib/order-status";
import { LiveRefresh } from "@/components/ui/live-refresh";

interface StrikesViewProps {
  initialStrikes: StudentStrikeRow[];
}

export function StrikesView({ initialStrikes }: StrikesViewProps) {
  const [strikes, setStrikes] = useState<StudentStrikeRow[]>(initialStrikes);
  const [search, setSearch] = useState("");
  const [clearingId, setClearingId] = useState<string | null>(null);

  const fetchStrikes = useCallback(async () => {
    const res = await adminListStudentStrikesAction();
    if (res.success && res.data) {
      setStrikes(res.data);
    }
  }, []);

  const handleClearStrikes = async (studentId: string, studentName: string) => {
    if (!window.confirm(`Clear all strikes for ${studentName}? This will immediately lift account restrictions.`)) {
      return;
    }

    setClearingId(studentId);
    try {
      const res = await adminClearStudentStrikesAction(studentId, "Cleared by admin");
      if (res.success) {
        toast.success(`Strikes cleared for ${studentName}`);
        await fetchStrikes();
      } else {
        toast.error(res.error || "Failed to clear strikes");
      }
    } catch {
      toast.error("Network error while clearing strikes");
    } finally {
      setClearingId(null);
    }
  };

  const filtered = strikes.filter((s) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return s.student_name.toLowerCase().includes(term) || s.college_id_last4.includes(term);
  });

  const limitedCount = strikes.filter((s) => s.is_limited).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Student Strikes & Penalties</h1>
          <p className="text-xs text-muted-foreground">
            Students with uncollected orders (no-shows) in the last 30 days. Accounts with 3+ strikes are restricted to max 2 items / ₹200.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <LiveRefresh onRefresh={fetchStrikes} label="Strikes list refreshed" />
        </div>
      </div>

      {/* Overview Stat Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Students with Strikes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{strikes.length}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Rolling 30-day window</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-rose-600 uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Restricted Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">{limitedCount}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              3+ strikes: limited to 2 items & ₹200
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-2xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Administrative Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Clearing strikes records an audited timestamp. Only future no-shows will count.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by student name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>
      </div>

      {/* Strikes List Table */}
      <Card className="border-border/80 shadow-2xs">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 text-muted-foreground font-semibold uppercase tracking-wider border-b">
                <tr>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">College ID</th>
                  <th className="py-2.5 px-4 text-center">Active Strikes</th>
                  <th className="py-2.5 px-4">Account Status</th>
                  <th className="py-2.5 px-4">Last No-Show Date</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No active strikes found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.student_id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-bold text-foreground flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center font-bold text-xs text-muted-foreground">
                          {s.student_name[0]?.toUpperCase() || "S"}
                        </div>
                        <span>{s.student_name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        •••{s.college_id_last4}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={s.is_limited ? "destructive" : "outline"}
                          className="font-bold font-mono text-xs px-2"
                        >
                          {s.strike_count} / 3
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        {s.is_limited ? (
                          <Badge variant="destructive" className="gap-1 text-[10px] font-bold">
                            <Lock className="h-2.5 w-2.5" /> Restricted (Max 2 items / ₹200)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                            Warning
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {s.last_no_show_at ? formatIstDateTime(s.last_no_show_at) : "--"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={clearingId === s.student_id}
                          onClick={() => handleClearStrikes(s.student_id, s.student_name)}
                          className="h-8 px-2.5 rounded-lg text-xs font-semibold gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Clear Strikes</span>
                        </Button>
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
