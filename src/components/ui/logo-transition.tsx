"use client";

import React from "react";
import Image from "next/image";

interface LogoTransitionProps {
  destinationLabel?: string;
  isExiting?: boolean;
}

const BRAND_LETTERS = [
  { char: "C", isSpecial: false },
  { char: "@", isSpecial: true },
  { char: "M", isSpecial: false },
  { char: "P", isSpecial: false },
  { char: "B", isSpecial: false },
  { char: "I", isSpecial: false },
  { char: "T", isSpecial: false },
  { char: "E", isSpecial: false },
];

export function LogoTransition({
  destinationLabel = "Campus Dining",
  isExiting = false,
}: LogoTransitionProps) {
  // Strict failsafe: NEVER render the standard transition if destination is Healthy Mode, on healthy route, or transitioning to healthy
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
      className={`fixed inset-0 z-30 flex items-center justify-center overflow-hidden select-none ${
        isExiting ? "cb-backdrop-exit pointer-events-none" : "cb-backdrop-enter"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${destinationLabel}`}
    >
      {/* Dynamic Theme-Adaptive Backdrop: Warm cream in light mode, deep obsidian in dark mode */}
      <div className="absolute inset-0 bg-[#FFFDF5] dark:bg-[#12131A] transition-colors" />

      {/* Ambient Radial Glow centered behind the food */}
      <div
        className="absolute w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-amber-500/20 via-orange-500/10 to-transparent blur-3xl pointer-events-none cb-ambient-glow"
        aria-hidden="true"
      />

      {/* Stage Container with smooth enter/exit choreography */}
      <div
        className={`relative z-10 flex flex-col items-center px-4 max-w-sm w-full ${
          isExiting ? "cb-stage-exit" : "cb-stage-enter"
        }`}
      >
        {/* Animated Food Illustration Centerpiece */}
        <div className="relative flex flex-col items-center justify-center">
          {/* Spring Drop Bouncing Food Image */}
          <div className="relative w-44 h-36 sm:w-52 sm:h-44 flex items-center justify-center cb-food-bounce">
            <Image
              src="/brand/campbite-logo.png"
              alt="C@mpBite Food Logo"
              width={208}
              height={176}
              className="w-full h-full object-contain pointer-events-none drop-shadow-sm"
              priority
            />
          </div>

          {/* Synchronized Soft Ground Shadow */}
          <div
            className="w-36 sm:w-44 h-3.5 -mt-2 rounded-full bg-black/15 dark:bg-black/40 blur-xs cb-shadow-bounce pointer-events-none"
            aria-hidden="true"
          />
        </div>

        {/* Wordmark: C@MPBITE Typewriter Reveal */}
        <div className="mt-5 flex items-center justify-center tracking-[0.14em] sm:tracking-[0.18em] font-brand text-2xl sm:text-3xl font-extrabold select-none">
          {BRAND_LETTERS.map((item, idx) => (
            <span
              key={idx}
              className={`inline-block transition-transform opacity-0 ${
                item.isSpecial
                  ? "text-[#DC2626] dark:text-[#EF4444]"
                  : "text-[#3A1400] dark:text-[#FDFBF7]"
              }`}
              style={{
                animation: "cb-letter-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                animationDelay: `${260 + idx * 35}ms`,
              }}
            >
              {item.char}
            </span>
          ))}
        </div>

        {/* Tagline: SKIP THE QUEUE, GRAB THE FOOD with Left-to-Right Wipe */}
        <div className="mt-2 text-center overflow-hidden">
          <span className="inline-block text-[10.5px] sm:text-xs font-brand tracking-[0.12em] sm:tracking-[0.16em] uppercase font-semibold text-[#7a4500] dark:text-[#FACC15] select-none opacity-0 cb-tagline-reveal">
            SKIP THE QUEUE, GRAB THE FOOD
          </span>
        </div>

        {/* Subtle Destination Loading Indicator Pill */}
        <div className="mt-6 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/10 shadow-xs backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
            Opening <strong className="text-stone-900 dark:text-white font-semibold">{destinationLabel}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
