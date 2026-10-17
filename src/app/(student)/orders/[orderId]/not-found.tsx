import Link from "next/link";
import { PackageSearch, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function OrderNotFound() {
  return (
    <div className="py-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-6 text-center space-y-4 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PackageSearch className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-foreground">Order Not Found</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This order doesn&apos;t exist or you don&apos;t have permission to view it.
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/orders"
            className={buttonVariants({
              variant: "default",
              className: "w-full rounded-xl min-h-[44px] text-xs font-semibold gap-1.5",
            })}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Orders
          </Link>
        </div>
      </div>
    </div>
  );
}
