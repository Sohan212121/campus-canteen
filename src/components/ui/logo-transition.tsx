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
      {/* Silky dark scrim backdrop with high-precision blur and subtle warm vignette */}
      <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xl transition-all duration-300" />

      {/* Ambient radial lighting tailored to the logo's amber undertones */}
      <div
        className="absolute w-[360px] h-[360px] rounded-full bg-gradient-to-tr from-amber-600/30 via-amber-500/20 to-orange-500/10 blur-3xl pointer-events-none cb-ambient-glow"
        aria-hidden="true"
      />

      {/* Liquid Ripple Ring 1 */}
      <div
        className="absolute w-44 h-44 rounded-3xl border border-amber-400/25 pointer-events-none cb-ripple-1"
        aria-hidden="true"
      />

      {/* Liquid Ripple Ring 2 */}
      <div
        className="absolute w-44 h-44 rounded-3xl border border-amber-500/15 pointer-events-none cb-ripple-2"
        aria-hidden="true"
      />

      {/* 3D Perspective Stage */}
      <div className="relative z-10 flex flex-col items-center [perspective:1200px]">
        {/* The Logo Container with 3D Pop-In */}
        <div className="relative group cb-logo-pop">
          {/* Backlight halo casting on the backdrop */}
          <div
            className="absolute -inset-4 rounded-3xl bg-amber-500/20 blur-xl opacity-80"
            aria-hidden="true"
          />

          {/* Exact Logo Frame - Housing the metallic badge asset */}
          <div className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-[28px] overflow-hidden bg-slate-900 border border-amber-400/30 shadow-[0_20px_50px_rgba(0,0,0,0.6),0_0_40px_rgba(245,158,11,0.25)] flex items-center justify-center">
            <Image
              src="/brand/logo.png"
              alt="Campus Canteen Logo"
              width={144}
              height={144}
              unoptimized
              priority
              className="w-full h-full object-cover scale-[1.38] object-center select-none pointer-events-none"
            />

            {/* Fluid Light Sweep Across the Metallic Surface */}
            <div
              className="absolute inset-y-0 w-24 -skew-x-25 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none cb-light-sweep"
              aria-hidden="true"
            />

            {/* Subtle Inner Bevel Shadow */}
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
            CAMPUSBITES
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
