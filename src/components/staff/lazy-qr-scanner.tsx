"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

export const LazyQrScanner = dynamic<React.ComponentProps<typeof import("@yudiel/react-qr-scanner").Scanner>>(
  () => import("@yudiel/react-qr-scanner").then((mod) => mod.Scanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 w-full flex-col items-center justify-center rounded-2xl bg-muted/40 border border-dashed border-border/80 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-xs font-medium">Initializing camera scanner...</span>
      </div>
    ),
  }
);
