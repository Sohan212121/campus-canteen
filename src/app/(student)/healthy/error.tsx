"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HealthyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Healthy mode error:", error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center space-y-4 my-8 animate-in fade-in duration-200">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-bold text-foreground">
          Healthy Mode unavailable
        </h2>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          We had trouble loading the nutrition menu. Please try again.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => reset()}
        className="rounded-xl h-10 px-5 text-xs font-semibold gap-1.5 cursor-pointer active:scale-95 transition-transform"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Try Again
      </Button>
    </div>
  );
}

