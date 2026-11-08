"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";

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
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          // Autoplay fallback: poster image remains visible smoothly
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
      {/* Embedded keyframe styles for smooth letter transition & seamless radial feather mask */}
      <style>{`
        @keyframes healthy-letter-in {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.9);
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
        .healthy-logo-mask {
          -webkit-mask-image: radial-gradient(circle at 50% 48%, black 55%, transparent 92%);
          mask-image: radial-gradient(circle at 50% 48%, black 55%, transparent 92%);
        }
      `}</style>

      {/* Solid Uniform Backdrop: Exactly matches the #F4F0E4 background in light mode, deep black in dark mode */}
      <div className="absolute inset-0 bg-[#F4F0E4] dark:bg-black transition-colors" />

      {/* Ambient Radial Glow in dark mode */}
      <div
        className="absolute w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-gradient-to-tr from-emerald-500/20 via-lime-500/15 to-transparent blur-3xl pointer-events-none opacity-0 dark:opacity-100 transition-opacity"
        aria-hidden="true"
      />

      {/* Stage Container */}
      <div
        className={`relative z-10 flex flex-col items-center max-w-sm w-full px-4 ${
          isExiting ? "cb-stage-exit" : "cb-stage-enter"
        }`}
      >
        {/* Healthy Mode Logo Container (Zero-delay poster + video with feathered seamless edge) */}
        <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center healthy-logo-mask dark:drop-shadow-[0_0_35px_rgba(16,185,129,0.2)]">
          {/* Instant First-Frame Poster: Visible IMMEDIATELY at 0ms (eliminates any video loading delay) */}
          <Image
            src="/brand/healthymode-poster.png"
            alt="Healthy Mode Logo"
            width={288}
            height={288}
            priority
            className={`w-full h-full object-contain pointer-events-none absolute inset-0 transition-opacity duration-200 ${
              isPlaying ? "opacity-0" : "opacity-100"
            }`}
          />

          {/* Logo Transition Video */}
          <video
            ref={videoRef}
            src="/brand/healthymode-logo-transition.mp4"
            poster="/brand/healthymode-poster.png"
            autoPlay
            muted
            playsInline
            preload="auto"
            onPlaying={() => setIsPlaying(true)}
            onEnded={onEnded}
            className={`w-full h-full object-contain pointer-events-none relative z-10 transition-opacity duration-150 ${
              isPlaying ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>

        {/* Text Transition Message Below the Logo */}
        <div className="mt-2 flex flex-col items-center gap-1.5 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-emerald-700/10 dark:bg-emerald-500/20 border border-emerald-700/20 dark:border-emerald-500/30 mb-0.5">
            <span className="w-2 h-2 rounded-full bg-[#0b3b2e] dark:bg-emerald-400 animate-ping" />
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#0b3b2e] dark:text-emerald-400 font-headline">
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
                  animationDelay: `${80 + i * 22}ms`,
                }}
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </div>

          <span
            className="text-xs text-[#506600] dark:text-emerald-400/90 font-medium tracking-wide transition-opacity duration-500"
            style={{
              animation: "healthy-letter-in 0.5s ease-out both",
              animationDelay: "380ms",
            }}
          >
            Calibrating fresh protein &amp; nutrient fuel...
          </span>
        </div>
      </div>
    </div>
  );
}
