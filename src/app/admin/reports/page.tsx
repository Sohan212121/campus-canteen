import { requireRole } from "@/server/auth";
import { adminListCollectionReportsAction } from "@/server/actions/admin";
import { ReportsView } from "@/components/admin/reports-view";

export const metadata = {
  title: "Collection Reports | Admin Console",
  description: "Investigate and resolve collection dispute reports from students.",
};

export default async function AdminReportsPage() {
  await requireRole(["admin"]);

  const res = await adminListCollectionReportsAction("ALL");
  const initialReports = res.success && res.data ? res.data : [];

  return <ReportsView initialReports={initialReports} />;
}
