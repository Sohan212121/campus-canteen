"use client";

import { useState, useCallback } from "react";
import { Sparkles, Zap, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

interface StudentGreetingHeaderProps {
  fullName?: string | null;
  initialHour?: number;
}

interface TimeGreetingConfig {
  greeting: string;
  emoji: string;
  subtext: string;
}

function getTimeGreetingConfig(hour: number): TimeGreetingConfig {
  if (hour >= 5 && hour < 12) {
    return {
      greeting: "Good morning",
      emoji: "🍳",
      subtext: "Crispy dosas & hot filter coffee ready before your first lecture.",
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      greeting: "Good afternoon",
      emoji: "🍱",
      subtext: "Skip the lunch rush — fresh meal combos & biryani ready for quick pickup.",
    };
  }
  if (hour >= 17 && hour < 21) {
    return {
      greeting: "Good evening",
      emoji: "🥪",
      subtext: "Recharge between classes with samosas, rolls & piping hot chai.",
    };
  }
  return {
    greeting: "Night study fuel",
    emoji: "🌙",
    subtext: "Late cravings? Grab a fresh bite & recharge your study session.",
  };
}

export function StudentGreetingHeader({ fullName, initialHour }: StudentGreetingHeaderProps) {
  const [isWaving, setIsWaving] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  // Compute greeting directly from initialHour / current time without needing useEffect setState
  const effectiveHour = initialHour ?? (typeof window !== "undefined" ? new Date().getHours() : 12);
  const greetingConfig = getTimeGreetingConfig(effectiveHour);

  // Extract first name for a warm, personalized greeting
  const firstName = fullName?.trim() ? fullName.trim().split(" ")[0] : "Student";
  const userInitial = firstName.charAt(0).toUpperCase() || "S";

  const handleWaveClick = useCallback(() => {
    setIsWaving(true);
    setClickCount((prev) => prev + 1);

    const compliments = [
      `Hope you have an awesome day on campus, ${firstName}! ✨`,
      `Ready to beat the queue? Kitchen is fired up! 🔥`,
      `Great to see you! What are you craving today? 😋`,
      `Zero wait time. 100% freshly cooked goodness! 🚀`,
    ];
    const picked = compliments[clickCount % compliments.length];

    toast(picked, {
      id: "greeting-easter-egg",
      duration: 2500,
      icon: "👋",
    });

    const timer = setTimeout(() => setIsWaving(false), 900);
    return () => clearTimeout(timer);
  }, [clickCount, firstName]);

  return (
    <header
      className="group relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/30 p-4 sm:p-5 shadow-2xs transition-all hover:border-primary/30"
      aria-label="Student welcome and campus canteen status"
    >
      {/* Top accent gradient bar with subtle shimmer */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/40 via-primary/40 to-transparent" />

      {/* Atmospheric Shimmer light sweep */}
      <div
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-greeting-shimmer"
        aria-hidden="true"
      />

      {/* Ambient background glows */}
      <div
        className="pointer-events-none absolute -right-6 -bottom-6 h-28 w-28 rounded-full bg-amber-500/10 blur-2xl transition-all duration-500 group-hover:scale-125 group-hover:bg-amber-500/15"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-primary/5 blur-2xl"
        aria-hidden="true"
      />

      {/* Upper Status Row: Live Kitchen Beacon & Campus Canteen Brand */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          {/* Pulsing Live Kitchen Indicator */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 select-none shadow-2xs">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span>Kitchen Live</span>
          </div>

          {/* Quick Pickup Chip */}
          <div className="hidden xs:inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/50">
            <Zap className="h-3 w-3 text-amber-500" />
            <span>~4 min pickup</span>
          </div>
        </div>

        {/* Canteen Subtitle Tag */}
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground/90 select-none">
          <UtensilsCrossed className="h-3 w-3 text-primary/70" />
          <span>Campus Canteen</span>
        </div>
      </div>

      {/* Main Greeting Content Row */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight flex items-center flex-wrap gap-2 text-foreground">
            <span>
              {greetingConfig.greeting},{" "}
              <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/80 bg-clip-text">
                {firstName}
              </span>
              !
            </span>

            {/* Interactive Waving Hand Button */}
            <button
              type="button"
              onClick={handleWaveClick}
              className="cursor-pointer select-none inline-flex items-center justify-center p-0.5 hover:scale-110 active:scale-95 transition-transform"
              title="Click to wave back!"
              aria-label={`Wave at ${firstName}`}
            >
              <span
                className={`text-2xl sm:text-[26px] ${
                  isWaving ? "inline-block animate-bounce scale-125" : "animate-wave-hand"
                }`}
              >
                👋
              </span>
            </button>
          </h1>

          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {greetingConfig.subtext}
          </p>
        </div>

        {/* Interactive Student Avatar with Gradient Ring */}
        <button
          type="button"
          onClick={handleWaveClick}
          className="shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary/15 via-amber-500/20 to-primary/10 border border-primary/25 shadow-2xs cursor-pointer select-none hover:scale-105 active:scale-95 transition-all group-hover:border-primary/40"
          title={`Signed in as ${firstName}`}
          aria-label="Student profile badge"
        >
          <span className="text-sm font-black text-foreground tracking-tight">
            {userInitial}
          </span>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 text-[9px]">
            <Sparkles className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
          </span>
        </button>
      </div>
    </header>
  );
}
