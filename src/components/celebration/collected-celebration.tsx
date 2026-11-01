"use client";

import { useEffect, useState } from "react";
import { Utensils, X } from "lucide-react";

import { useReducedMotion } from "@/lib/celebration";
import { AnimatedCheck } from "@/components/celebration/animated-check";
import { ConfettiBurst } from "@/components/celebration/confetti-burst";

interface CollectedCelebrationProps {
  orderCode: string;
  onDismiss?: () => void;
}

export function CollectedCelebration({
  orderCode,
  onDismiss,
}: CollectedCelebrationProps) {
  const reducedMotion = useReducedMotion();
  const [isDismissed, setIsDismissed] = useState(false);

  // Safe haptic vibration
  useEffect(() => {
    if (reducedMotion) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(30);
      } catch {
        // Ignore
      }
    }
  }, [reducedMotion]);

  if (isDismissed) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/10 to-emerald-500/5 p-4 shadow-xs animate-in fade-in zoom-in-95 duration-300"
    >
      {/* 16-piece Confetti burst */}
      <ConfettiBurst count={16} reducedMotion={reducedMotion} />

      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">
            <AnimatedCheck size={42} reducedMotion={reducedMotion} />
          </div>

          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <span>Enjoy your meal!</span>
              <Utensils className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              Order <span className="font-mono font-bold text-foreground">#{orderCode}</span> successfully collected.
            </p>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={() => {
              setIsDismissed(true);
              onDismiss();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-emerald-500/10 hover:text-foreground transition-colors"
            aria-label="Dismiss collection message"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}
