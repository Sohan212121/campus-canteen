"use client";

import React from "react";
import { UtensilsCrossed } from "lucide-react";

interface LogoTransitionProps {
  destinationLabel?: string;
  isExiting?: boolean;
}

export function LogoTransition({
  destinationLabel = "Campus Dining",
  isExiting = false,
}: LogoTransitionProps) {
  return (
    <div
      key="logo-transition-overlay"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden pointer-events-auto select-none ${
        isExiting ? "cb-overlay-exit" : "cb-overlay-enter"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${destinationLabel}`}
    >
      {/* 100% Solid Opaque Backdrop (prevents any web app background components from bleeding through) */}
      <div className="absolute inset-0 bg-slate-950 transition-all duration-300" />

      {/* Ambient radial lighting centered behind the badge */}
      <div
        className="absolute w-[360px] h-[360px] rounded-full bg-gradient-to-tr from-amber-600/25 via-amber-500/15 to-orange-500/10 blur-3xl pointer-events-none cb-ambient-glow"
        aria-hidden="true"
      />

      {/* Liquid Ripple Ring 1 */}
      <div
        className="absolute w-44 h-44 rounded-3xl border border-amber-400/20 pointer-events-none cb-ripple-1"
        aria-hidden="true"
      />

      {/* Liquid Ripple Ring 2 */}
      <div
        className="absolute w-44 h-44 rounded-3xl border border-amber-500/10 pointer-events-none cb-ripple-2"
        aria-hidden="true"
      />

      {/* 3D Perspective Stage */}
      <div className="relative z-10 flex flex-col items-center [perspective:1200px]">
        {/* The Logo Container with 3D Pop-In */}
        <div className="relative group cb-logo-pop">
          {/* Backlight halo casting on the solid backdrop */}
          <div
            className="absolute -inset-4 rounded-3xl bg-amber-500/20 blur-xl opacity-80"
            aria-hidden="true"
          />

          {/* Official App Logo Badge (Dark rounded square with white crossed cutlery) */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] overflow-hidden bg-zinc-900 border border-zinc-700/60 shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_35px_rgba(255,255,255,0.06)] flex items-center justify-center">
            <UtensilsCrossed className="h-14 w-14 sm:h-16 sm:w-16 text-white stroke-[2.2] select-none pointer-events-none drop-shadow-sm" />

            {/* Fluid Light Sweep Across the Surface */}
            <div
              className="absolute inset-y-0 w-24 -skew-x-25 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none cb-light-sweep"
              aria-hidden="true"
            />

            {/* Subtle Inner Bevel Highlight */}
            <div
              className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/20 pointer-events-none"
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
        <div className="mt-6 flex flex-col items-center gap-1.5 text-center">
          <span className="text-[11px] font-bold tracking-[0.28em] uppercase text-amber-400/90 font-mono">
            CAMPUS CANTEEN
          </span>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <span className="text-slate-400">Loading</span>
            <span className="text-white font-semibold">{destinationLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
