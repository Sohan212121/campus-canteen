"use client";

import React from "react";
import { Leaf } from "lucide-react";

interface HealthyLogoTransitionProps {
  destinationLabel?: string;
  isExiting?: boolean;
}

export function HealthyLogoTransition({
  destinationLabel = "Healthy Mode",
  isExiting = false,
}: HealthyLogoTransitionProps) {
  return (
    <div
      key="healthy-logo-transition-overlay"
      className={`fixed inset-0 z-30 flex items-center justify-center overflow-hidden pointer-events-none select-none transition-opacity duration-180 ease-out ${
        isExiting ? "opacity-0" : "opacity-100 animate-in fade-in duration-150"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Opening ${destinationLabel}`}
      data-testid="healthy-logo-transition-overlay"
    >
      {/* Light brand-tinted translucent veil: keeps shell and skeleton visible beneath */}
      <div
        className="absolute inset-0 bg-emerald-950/15 dark:bg-emerald-950/40 backdrop-blur-[2px] pointer-events-none transition-opacity duration-180"
        aria-hidden="true"
      />

      {/* Stage Container: Single non-looping entrance pop, completes within 280ms */}
      <div
        className={`relative z-10 flex flex-col items-center pointer-events-none transition-all duration-180 ease-out ${
          isExiting ? "scale-95 opacity-0" : "scale-100 opacity-100 animate-in zoom-in-95 duration-250"
        }`}
      >
        {/* Botanical Glass Badge (static non-looping glow) */}
        <div className="relative group pointer-events-none">
          <div
            className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden bg-gradient-to-br from-[#063b2c] via-[#092920] to-[#041a14] border border-emerald-500/40 shadow-lg flex items-center justify-center pointer-events-none"
          >
            <Leaf className="h-12 w-12 sm:h-14 sm:w-14 text-emerald-400 stroke-[2.2] select-none pointer-events-none drop-shadow-[0_0_12px_rgba(52,211,153,0.6)]" />

            {/* Inner Bevel Highlight */}
            <div
              className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-emerald-400/30 pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* High-contrast typography: 
            Light mode: #064e3b on cream (6.8:1 ratio)
            Dark mode: emerald-400 on dark (10.4:1 ratio) */}
        <div className="mt-5 flex flex-col items-center gap-1.5 text-center pointer-events-none">
          <span className="text-xs sm:text-sm font-brand tracking-[0.15em] text-[#064e3b] dark:text-emerald-400 font-bold">
            C@MPBITE • NUTRITION
          </span>
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] border border-black/10 dark:border-white/15 shadow-xs backdrop-blur-xs text-xs font-medium">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <span className="text-emerald-950 dark:text-emerald-200">Opening</span>
            <span className="text-[#064e3b] dark:text-white font-extrabold tracking-tight">
              {destinationLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
