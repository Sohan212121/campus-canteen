import Link from "next/link";
import { Receipt, ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/server/auth";

export default async function OrdersPage() {
  await requireRole(["student", "staff", "admin"]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Your Orders</h1>
        <p className="text-xs text-muted-foreground">
          Track active kitchen prep and view past pickup tokens.
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-border/80 bg-card p-8 text-center space-y-4 my-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Receipt className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold">No orders yet</h2>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            When you place pre-orders, your live order status and pickup tokens will appear here.
          </p>
        </div>
        <Link
          href="/menu"
          className={buttonVariants({
            className: "rounded-xl h-11 px-6 font-semibold gap-2 inline-flex items-center",
          })}
        >
          Browse Menu <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
