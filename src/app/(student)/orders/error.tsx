"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Utensils } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[OrdersError] Caught error:", {
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
            Unable to load orders
          </h2>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            We couldn&apos;t retrieve your orders right now. Please check your connection and try again.
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
            href="/menu"
            className={buttonVariants({
              variant: "outline",
              className: "w-full rounded-xl min-h-[44px] text-xs font-semibold gap-1.5",
            })}
          >
            <Utensils className="h-4 w-4" />
            Go to Menu
          </Link>
        </div>
      </div>
    </div>
  );
}
