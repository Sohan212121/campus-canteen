import { requireRole } from "@/server/auth";
import { getDailyReconciliationAction } from "@/server/actions/admin";
import { ReconciliationView } from "@/components/admin/reconciliation-view";

export const metadata = {
  title: "Daily Reconciliation | Admin Console",
  description: "End-of-day financial and operational reconciliation audit.",
};

export default async function AdminReconciliationPage() {
  await requireRole(["admin"]);

  // Load today's reconciliation
  const res = await getDailyReconciliationAction();
  const initialData = res.success && res.data ? res.data : {
    date: new Date().toISOString().split("T")[0],
    canteen_id: null,
    canteens: [],
    staff: [],
    summary: {
      target_date: new Date().toISOString().split("T")[0],
      total_collected_count: 0,
      total_collected_paise: 0,
      total_cash_paise: 0,
      total_upi_paise: 0,
      total_manual_count: 0,
      total_late_handover_count: 0,
      total_no_show_count: 0,
    },
  };

  return <ReconciliationView initialData={initialData} />;
}
