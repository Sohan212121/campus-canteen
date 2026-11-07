"use client";

import React, { useEffect, useRef } from "react";

interface HealthyLogoTransitionProps {
  destinationLabel?: string;
  isExiting?: boolean;
  onEnded?: () => void;
}

const LETTERS = "Entering Healthy Mode".split("");

export function HealthyLogoTransition({
  destinationLabel = "Healthy Mode",
  isExiting = false,
  onEnded,
}: HealthyLogoTransitionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {
        // Safe catch for browsers restricting autoplay
      });
    }
  }, []);

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
      {/* Embedded keyframe styles for smooth letter transition */}
      <style>{`
        @keyframes healthy-letter-in {
          0% {
            opacity: 0;
            transform: translateY(14px) scale(0.88);
          }
          60% {
            opacity: 1;
            transform: translateY(-2px) scale(1.04);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes healthy-glow-pulse {
          0%, 100% {
            opacity: 0.35;
            transform: scale(0.92);
          }
          50% {
            opacity: 0.75;
            transform: scale(1.08);
          }
        }
      `}</style>

      {/* Seamless Theme Backdrop (Matches Video Background Tone Exactly) */}
      <div className="absolute inset-0 bg-[#F5EFE6] dark:bg-[#071710] transition-colors" />

      {/* Ambient Radial Glow */}
      <div
        className="absolute w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-[#10b981]/25 via-[#c2f02e]/20 to-transparent blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Stage Container */}
      <div
        className={`relative z-10 flex flex-col items-center max-w-sm w-full px-4 ${
          isExiting ? "cb-stage-exit" : "cb-stage-enter"
        }`}
      >
        {/* Healthy Mode Logo Video Centerpiece */}
        <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center">
          {/* Subtle Backlight Glow */}
          <div
            className="absolute inset-8 rounded-full bg-[#10b981]/20 blur-2xl pointer-events-none"
            style={{ animation: "healthy-glow-pulse 2s ease-in-out infinite" }}
          />

          <video
            ref={videoRef}
            src="/brand/healthymode-logo-transition.mp4"
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={onEnded}
            className="w-full h-full object-contain pointer-events-none relative z-10 rounded-2xl"
          />
        </div>

        {/* Text Transition Message Below the Logo */}
        <div className="mt-2 flex flex-col items-center gap-1.5 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-0.5">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping" />
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-800 dark:text-[#81c784] font-headline">
              Campus Nutrition
            </span>
          </div>

          {/* Animated Letter Transition: "Entering Healthy Mode" */}
          <div
            className="flex items-center justify-center select-none"
            aria-label="Entering Healthy Mode"
            data-message="Entering Helathy Mode"
          >
            {LETTERS.map((char, i) => (
              <span
                key={i}
                className="inline-block font-headline text-lg sm:text-xl font-black text-[#00241a] dark:text-[#ede7e1] tracking-tight"
                style={{
                  animation: "healthy-letter-in 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                  animationDelay: `${120 + i * 22}ms`,
                }}
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </div>

          <span
            className="text-xs text-[#506600] dark:text-emerald-400/80 font-medium tracking-wide transition-opacity duration-500"
            style={{
              animation: "healthy-letter-in 0.5s ease-out both",
              animationDelay: "450ms",
            }}
          >
            Calibrating fresh protein &amp; nutrient fuel...
          </span>
        </div>
      </div>
    </div>
  );
}
