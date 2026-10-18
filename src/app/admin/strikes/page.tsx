import { requireRole } from "@/server/auth";
import { adminListStudentStrikesAction } from "@/server/actions/admin";
import { StrikesView } from "@/components/admin/strikes-view";

export const metadata = {
  title: "Student Strikes & Penalties | Admin Console",
  description: "Monitor and manage no-show student strikes and account ordering limits.",
};

export default async function AdminStrikesPage() {
  await requireRole(["admin"]);

  const res = await adminListStudentStrikesAction();
  const initialStrikes = res.success && res.data ? res.data : [];

  return <StrikesView initialStrikes={initialStrikes} />;
}
