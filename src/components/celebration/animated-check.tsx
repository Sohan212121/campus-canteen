"use client";

import { cn } from "@/lib/utils";

interface AnimatedCheckProps {
  size?: number;
  className?: string;
  reducedMotion?: boolean;
}

export function AnimatedCheck({
  size = 72,
  className,
  reducedMotion = false,
}: AnimatedCheckProps) {
  return (
    <div
      className={cn("relative mx-auto flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Radial soft glow pulse */}
      <div
        className={cn(
          "absolute inset-0 rounded-full bg-emerald-500/25 blur-xl pointer-events-none",
          !reducedMotion && "cc-glow"
        )}
      />

      <svg
        width={size}
        height={size}
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 block overflow-visible"
        aria-hidden="true"
      >
        {/* Background track circle */}
        <circle
          cx="40"
          cy="40"
          r="36"
          stroke="currentColor"
          strokeWidth="4"
          className="text-emerald-500/20 dark:text-emerald-500/30"
        />

        {/* Animated drawing circle */}
        <circle
          cx="40"
          cy="40"
          r="36"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          className={cn(
            "text-emerald-600 dark:text-emerald-400 -rotate-90 origin-center",
            !reducedMotion && "cc-circle-path"
          )}
          style={
            reducedMotion
              ? { strokeDasharray: "228", strokeDashoffset: "0" }
              : undefined
          }
        />

        {/* Animated checkmark */}
        <path
          d="M24 41.5L34.5 52L56 29"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "text-emerald-600 dark:text-emerald-400",
            !reducedMotion && "cc-check-path"
          )}
          style={
            reducedMotion
              ? { strokeDasharray: "65", strokeDashoffset: "0" }
              : undefined
          }
        />
      </svg>
    </div>
  );
}

