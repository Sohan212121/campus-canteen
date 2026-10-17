"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export default function OrderDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log code and message only, never sensitive keys or objects
    console.error("[OrderDetailError] Caught error:", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="py-12 px-4 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-4 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-bold text-foreground">
            We couldn&apos;t load this order
          </h2>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            We encountered an issue retrieving the order details. Please try again.
          </p>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <Button
            type="button"
            onClick={() => reset()}
            className="w-full rounded-xl min-h-[44px] text-xs font-semibold gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Again
          </Button>
          <Link
            href="/orders"
            className={buttonVariants({
              variant: "outline",
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
