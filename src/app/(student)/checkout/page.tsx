import { redirect } from "next/navigation";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { CheckoutView } from "@/components/student/checkout-view";

export default async function CheckoutPage() {
  await requireRole(["student", "staff", "admin"]);
  const canteenId = await getActiveCanteenId();

  if (!canteenId) {
    redirect("/menu");
  }

  return <CheckoutView canteenId={canteenId} />;
}
