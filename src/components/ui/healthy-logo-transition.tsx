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
      className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden pointer-events-auto select-none ${
        isExiting ? "cb-backdrop-exit" : "cb-backdrop-enter"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${destinationLabel}`}
    >
      {/* 100% Solid Deep Obsidian Jade Backdrop (prevents any background bleed) */}
      <div className="absolute inset-0 bg-[#04120c]" />

      {/* Stage Container with smooth enter/exit choreography */}
      <div
        className={`relative z-10 flex flex-col items-center ${
          isExiting ? "cb-stage-exit" : "cb-stage-enter"
        }`}
      >
        {/* Ambient radial emerald lighting centered behind the badge */}
        <div
          className="absolute -top-16 w-72 h-72 sm:w-84 sm:h-84 rounded-full bg-gradient-to-tr from-emerald-500/30 via-teal-500/20 to-transparent blur-3xl pointer-events-none cb-ambient-glow"
          aria-hidden="true"
        />

        {/* Liquid Ripple Wave 1 (Emerald pulse ring) */}
        <div
          className="absolute top-2 w-36 h-36 sm:w-40 sm:h-40 rounded-3xl border border-emerald-400/25 pointer-events-none cb-ripple-1"
          aria-hidden="true"
        />

        {/* Liquid Ripple Wave 2 (Teal secondary pulse ring) */}
        <div
          className="absolute top-2 w-36 h-36 sm:w-40 sm:h-40 rounded-3xl border border-teal-400/15 pointer-events-none cb-ripple-2"
          aria-hidden="true"
        />

        {/* The Official Healthy Mode Logo Badge */}
        <div className="relative group">
          {/* Backlight halo casting on the obsidian backdrop */}
          <div
            className="absolute -inset-3.5 rounded-3xl bg-emerald-500/25 blur-xl opacity-90 animate-pulse"
            aria-hidden="true"
          />

          {/* Botanical Glass Badge */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] overflow-hidden bg-gradient-to-br from-[#063b2c] via-[#092920] to-[#041a14] border border-emerald-500/40 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_35px_rgba(16,185,129,0.25)] flex items-center justify-center">
            <Leaf className="h-14 w-14 sm:h-16 sm:w-16 text-emerald-400 stroke-[2.2] select-none pointer-events-none drop-shadow-[0_0_18px_rgba(52,211,153,0.7)]" />

            {/* Fluid Emerald Light Sweep Across the Surface */}
            <div
              className="absolute inset-y-0 w-24 -skew-x-25 bg-gradient-to-r from-transparent via-emerald-200/35 to-transparent pointer-events-none cb-light-sweep"
              aria-hidden="true"
            />

            {/* Subtle Inner Bevel Highlight */}
            <div
              className="absolute inset-0 rounded-[28px] ring-1 ring-inset ring-emerald-400/30 pointer-events-none"
              aria-hidden="true"
            />
          </div>

          {/* Floating emerald bio-motes */}
          <div
            className="absolute -top-2 left-3 w-1.5 h-1.5 rounded-full bg-emerald-300 blur-[0.5px] pointer-events-none cb-mote-1"
            aria-hidden="true"
          />
          <div
            className="absolute -top-3 right-4 w-2 h-2 rounded-full bg-teal-300 blur-[0.5px] pointer-events-none cb-mote-2"
            aria-hidden="true"
          />
        </div>

        {/* Premium Botanical Typography & Status Label */}
        <div className="mt-7 flex flex-col items-center gap-1.5 text-center">
          <span className="text-xs sm:text-sm font-brand tracking-[0.2em] text-emerald-400">
            C<span className="text-red-500 font-bold">@</span>mpBite • NUTRITION
          </span>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-100">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-emerald-300/80">Entering</span>
            <span className="text-white font-extrabold tracking-tight">{destinationLabel}</span>
          </div>
          <span className="text-[10px] text-emerald-400/60 font-medium tracking-wide pt-0.5">
            Calibrating fresh protein & nutrient fuel...
          </span>
        </div>
      </div>
    </div>
  );
}
