"use client";

import React from "react";
import Image from "next/image";

interface LogoTransitionProps {
  destinationLabel?: string;
  isExiting?: boolean;
}

export function LogoTransition({
  destinationLabel = "Campus Dining",
  isExiting = false,
}: LogoTransitionProps) {
  // Strict failsafe: NEVER render the standard transition if destination is Healthy Mode
  if (
    destinationLabel.toLowerCase().includes("healthy") ||
    (typeof window !== "undefined" &&
      (window.location.pathname.startsWith("/healthy") ||
        document.documentElement.getAttribute("data-transition-theme") === "healthy" ||
        document.body.getAttribute("data-transition-target")?.startsWith("/healthy")))
  ) {
    return null;
  }

  return (
    <div
      key="logo-transition-overlay"
      className={`fixed inset-0 z-30 flex items-center justify-center overflow-hidden pointer-events-none select-none transition-opacity duration-180 ease-out ${
        isExiting ? "opacity-0" : "opacity-100 animate-in fade-in duration-150"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Opening ${destinationLabel}`}
      data-testid="logo-transition-overlay"
    >
      {/* Transparent-safe light veil: preserves visibility of header, bottom nav, and underlying page skeleton */}
      <div
        className="absolute inset-0 bg-background/50 dark:bg-black/55 backdrop-blur-[2px] pointer-events-none transition-opacity duration-180"
        aria-hidden="true"
      />

      {/* Stage Container: Single non-looping entrance pop, completes within 280ms */}
      <div
        className={`relative z-10 flex flex-col items-center px-4 max-w-sm w-full pointer-events-none transition-all duration-180 ease-out ${
          isExiting ? "scale-95 opacity-0" : "scale-100 opacity-100 animate-in zoom-in-95 duration-250"
        }`}
      >
        {/* Food Logo Centerpiece with subtle non-looping entrance */}
        <div className="relative flex flex-col items-center justify-center pointer-events-none">
          <div className="relative w-36 h-30 sm:w-44 sm:h-36 flex items-center justify-center pointer-events-none">
            <Image
              src="/brand/campbite-logo.png"
              alt="C@mpBite Food Logo"
              width={176}
              height={144}
              className="w-full h-full object-contain pointer-events-none drop-shadow-sm"
              priority
            />
          </div>
          <div
            className="w-28 sm:w-36 h-2.5 -mt-1 rounded-full bg-black/10 dark:bg-black/30 blur-xs pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {/* Wordmark: C@MPBITE (non-looping, clean brand typography) */}
        <div className="mt-4 flex items-center justify-center tracking-[0.16em] font-brand text-2xl font-extrabold select-none pointer-events-none">
          <span className="text-[#3A1400] dark:text-[#FDFBF7]">C</span>
          <span className="text-[#DC2626] dark:text-[#EF4444]">@</span>
          <span className="text-[#3A1400] dark:text-[#FDFBF7]">MPBITE</span>
        </div>

        {/* Destination Pill Indicator (static dot, non-looping) */}
        <div className="mt-4 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] border border-black/10 dark:border-white/15 shadow-xs backdrop-blur-xs pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d96b27] dark:bg-amber-400" />
          <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
            Opening <strong className="text-stone-900 dark:text-white font-semibold">{destinationLabel}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
