"use client";

import { useState, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type AdminCollectionReportRow,
  adminListCollectionReportsAction,
  adminResolveCollectionReportAction,
} from "@/server/actions/admin";
import { formatIstDateTime } from "@/lib/order-status";
import { LiveRefresh } from "@/components/ui/live-refresh";

interface ReportsViewProps {
  initialReports: AdminCollectionReportRow[];
}

export function ReportsView({ initialReports }: ReportsViewProps) {
  const [reports, setReports] = useState<AdminCollectionReportRow[]>(initialReports);
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [activeReport, setActiveReport] = useState<AdminCollectionReportRow | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [isResolving, setIsResolving] = useState(false);

  const fetchReports = useCallback(
    async (statusFilter?: string) => {
      const filter = statusFilter ?? selectedStatus;
      const res = await adminListCollectionReportsAction(filter);
      if (res.success && res.data) {
        setReports(res.data);
      }
    },
    [selectedStatus]
  );

  const handleStatusFilter = (status: string) => {
    setSelectedStatus(status);
    fetchReports(status);
  };

  const handleResolve = async (reportId: string, resolution: "RESOLVED" | "DISMISSED") => {
    setIsResolving(true);
    try {
      const res = await adminResolveCollectionReportAction(reportId, resolution, adminNotes);
      if (res.success) {
        toast.success(`Report marked as ${resolution}`);
        setActiveReport(null);
        setAdminNotes("");
        await fetchReports();
      } else {
        toast.error(res.error || "Failed to update report resolution");
      }
    } catch {
      toast.error("Network error resolving report");
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Collection Dispute Reports</h1>
          <p className="text-xs text-muted-foreground">
            Student reports of unauthorized collections (&quot;Not me&quot;) and audit trail investigations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <LiveRefresh onRefresh={() => fetchReports()} label="Reports list refreshed" />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b pb-3">
        {["ALL", "PENDING", "RESOLVED", "DISMISSED"].map((status) => (
          <button
            key={status}
            onClick={() => handleStatusFilter(status)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              selectedStatus === status
                ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Reports Table */}
      <Card className="border-border/80 shadow-2xs">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 text-muted-foreground font-semibold uppercase tracking-wider border-b">
                <tr>
                  <th className="py-2.5 px-4">Order Code</th>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Canteen</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4">Collection Details</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Filed At</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No dispute reports found.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-mono font-bold text-foreground">
                        #{r.order_code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{r.student_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ID: •••{r.student_college_id ? r.student_college_id.slice(-4) : "0000"}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {r.canteen_name || "Canteen"}
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate" title={r.reason}>
                        {r.reason}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        <div>
                          <span className="font-semibold">{r.collection_method}</span> ({r.collected_with})
                        </div>
                        {r.is_manual_override && (
                          <div className="text-[10px] text-amber-600 font-semibold">
                            Manual: {r.manual_override_reason || "Override"}
                          </div>
                        )}
                        {r.collecting_staff_name && (
                          <div className="text-[10px] text-muted-foreground">
                            Staff: {r.collecting_staff_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            r.status === "PENDING"
                              ? "destructive"
                              : r.status === "RESOLVED"
                              ? "default"
                              : "secondary"
                          }
                          className="text-[10px] font-bold"
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {formatIstDateTime(r.created_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {r.status === "PENDING" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setActiveReport(r);
                              setAdminNotes(r.admin_notes || "");
                            }}
                            className="h-8 px-2.5 rounded-lg text-xs font-semibold"
                          >
                            Investigate & Resolve
                          </Button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground font-medium">
                            {r.resolved_at ? formatIstDateTime(r.resolved_at) : "Resolved"}
                          </span>
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

      {/* Resolution Modal */}
      {activeReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <Card className="w-full max-w-lg border-border shadow-lg space-y-4 p-5 animate-in fade-in zoom-in-95">
            <CardHeader className="p-0">
              <CardTitle className="text-base font-bold flex items-center justify-between">
                <span>Resolve Dispute Report #{activeReport.order_code}</span>
                <Badge variant="destructive">{activeReport.status}</Badge>
              </CardTitle>
            </CardHeader>
            <div className="space-y-3 text-xs">
              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 border border-border/60">
                <div>
                  <span className="font-semibold text-foreground">Student: </span>
                  <span className="text-muted-foreground">{activeReport.student_name}</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">Dispute Reason: </span>
                  <span className="text-muted-foreground">{activeReport.reason}</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">Collection Method: </span>
                  <span className="text-muted-foreground">
                    {activeReport.collection_method} ({activeReport.collected_with}) by staff {activeReport.collecting_staff_name || "Unknown"}
                  </span>
                </div>
                {activeReport.is_manual_override && (
                  <div>
                    <span className="font-semibold text-amber-600">Manual Override Note: </span>
                    <span className="text-amber-700 dark:text-amber-300">
                      {activeReport.manual_override_reason}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-foreground block">
                  Administrative Investigation Notes:
                </label>
                <Textarea
                  placeholder="Record verification details, CCTV checks, or refund action..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="min-h-[80px] text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                disabled={isResolving}
                onClick={() => setActiveReport(null)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isResolving}
                onClick={() => handleResolve(activeReport.id, "DISMISSED")}
                className="text-muted-foreground"
              >
                <XCircle className="h-3.5 w-3.5 mr-1 text-rose-500" />
                Dismiss Report
              </Button>
              <Button
                size="sm"
                disabled={isResolving}
                onClick={() => handleResolve(activeReport.id, "RESOLVED")}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Confirm Resolution
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
