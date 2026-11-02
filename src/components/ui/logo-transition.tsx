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
  // Strict failsafe: NEVER render the old cutlery transition if destination is Healthy Mode, on healthy route, or transitioning to healthy
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
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden pointer-events-auto select-none ${
        isExiting ? "cb-backdrop-exit" : "cb-backdrop-enter"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${destinationLabel}`}
    >
      {/* 100% Solid Opaque Pitch-Black Backdrop (prevents any web app background components from bleeding through) */}
      <div className="absolute inset-0 bg-zinc-950" />

      {/* Stage Container with smooth enter/exit choreography */}
      <div
        className={`relative z-10 flex flex-col items-center ${
          isExiting ? "cb-stage-exit" : "cb-stage-enter"
        }`}
      >
        {/* Ambient radial lighting centered behind the badge */}
        <div
          className="absolute -top-16 w-72 h-72 sm:w-80 sm:h-80 rounded-full bg-gradient-to-tr from-amber-500/25 via-amber-600/15 to-transparent blur-3xl pointer-events-none cb-ambient-glow"
          aria-hidden="true"
        />

        {/* Liquid Ripple Ring 1 */}
        <div
          className="absolute top-2 w-36 h-36 sm:w-40 sm:h-40 rounded-3xl border border-amber-400/20 pointer-events-none cb-ripple-1"
          aria-hidden="true"
        />

        {/* Liquid Ripple Ring 2 */}
        <div
          className="absolute top-2 w-36 h-36 sm:w-40 sm:h-40 rounded-3xl border border-amber-500/10 pointer-events-none cb-ripple-2"
          aria-hidden="true"
        />

        {/* The Official App Logo Badge (Dark rounded square with white crossed cutlery) */}
        <div className="relative group">
          {/* Backlight halo casting on the solid backdrop */}
          <div
            className="absolute -inset-3 rounded-3xl bg-amber-500/20 blur-xl opacity-80"
            aria-hidden="true"
          />

          {/* Official App Logo Badge */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] overflow-hidden bg-zinc-900 border border-zinc-700/60 shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_35px_rgba(255,255,255,0.06)] flex items-center justify-center">
            <Image
              src="/brand/logo.png"
              alt="C@mpBite"
              width={128}
              height={128}
              className="w-full h-full object-cover select-none pointer-events-none"
              priority
            />

            {/* Fluid Light Sweep Across the Surface */}
            <div
              className="absolute inset-y-0 w-24 -skew-x-25 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none cb-light-sweep"
              aria-hidden="true"
            />

            {/* Subtle Inner Bevel Highlight */}
            <div
              className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/15 pointer-events-none"
              aria-hidden="true"
            />
          </div>

          {/* Floating light motes */}
          <div
            className="absolute -top-2 left-3 w-1.5 h-1.5 rounded-full bg-amber-300 blur-[0.5px] pointer-events-none cb-mote-1"
            aria-hidden="true"
          />
          <div
            className="absolute -top-3 right-4 w-2 h-2 rounded-full bg-orange-300 blur-[0.5px] pointer-events-none cb-mote-2"
            aria-hidden="true"
          />
        </div>

        {/* Premium Typography & Status Label */}
        <div className="mt-7 flex flex-col items-center gap-1.5 text-center">
          <span className="text-sm sm:text-base font-brand tracking-[0.2em] text-amber-400">
            C<span className="text-red-500 font-bold">@</span>mpBite
          </span>
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-zinc-400">Opening</span>
            <span className="text-white font-semibold">{destinationLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
