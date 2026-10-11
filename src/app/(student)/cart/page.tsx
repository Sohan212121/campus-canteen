import { requireRole } from "@/server/auth";
import { CartView } from "@/components/student/cart-view";

export default async function CartPage() {
  await requireRole(["student"]);

  return <CartView />;
}
