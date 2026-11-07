"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Trophy, Zap, X, ArrowRight, Flame } from "lucide-react";
import { ConfettiBurst } from "@/components/celebration/confetti-burst";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

interface ProteinGoalCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  proteinGrams: number;
  targetGoal: number;
  cartCount?: number;
}

export function ProteinGoalCelebration({
  isOpen,
  onClose,
  proteinGrams,
  targetGoal,
  cartCount = 0,
}: ProteinGoalCelebrationProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Haptic feedback on appear
  useEffect(() => {
    if (!isOpen || prefersReducedMotion) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch {
        // Safe fallback
      }
    }
  }, [isOpen, prefersReducedMotion]);

  // Trap escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily Protein Goal Celebration"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-300 select-none"
      onClick={onClose}
    >
      {/* Confetti Explosion Burst */}
      <ConfettiBurst count={36} reducedMotion={prefersReducedMotion} />

      {/* Main Celebration Card */}
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#072418] via-[#05140e] to-[#030a07] border-2 border-[#c2f02e]/60 p-6 text-white text-center shadow-[0_25px_60px_-15px_rgba(194,240,46,0.35)] overflow-hidden animate-in zoom-in-95 duration-400 ease-out"
      >
        {/* Glow Spheres */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#c2f02e]/25 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-8 w-40 h-40 bg-[#06b6d4]/20 rounded-full blur-2xl pointer-events-none" />

        {/* Close Button in Top-Right */}
        <button
          type="button"
          aria-label="Close celebration"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-stone-300 hover:text-white transition-colors cursor-pointer z-10"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Animated Trophy Aura Icon */}
        <div className="relative mx-auto mb-4 inline-flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-[#c2f02e]/15 border-2 border-[#c2f02e] flex items-center justify-center shadow-[0_0_35px_rgba(194,240,46,0.55)]">
            <Trophy className="h-10 w-10 text-[#c2f02e] animate-bounce duration-1000" />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#ff6f4f] border border-white text-white text-xs font-bold shadow-md">
            <Zap className="h-3.5 w-3.5 fill-current" />
          </span>
        </div>

        {/* Catchy Athlete Headline */}
        <div className="space-y-1 mb-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#c2f02e]/20 text-[#c2f02e] text-[10px] font-bold uppercase tracking-wider font-headline">
            <Flame className="h-3 w-3 fill-current" />
            <span>Target Achieved</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white font-headline">
            PROTEIN GOAL CRUSHED! ⚡
          </h2>
          <p className="text-xs text-stone-300 leading-relaxed max-w-xs mx-auto">
            You&apos;ve reached <span className="text-[#c2f02e] font-bold">{proteinGrams}g</span> of protein today, fulfilling your muscle protein synthesis &amp; campus athletic energy goal!
          </p>
        </div>

        {/* 3 Metric Summary Boxes */}
        <div className="grid grid-cols-3 gap-2 py-3 px-2 rounded-2xl bg-white/5 border border-white/10 mb-5 shadow-inner">
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Locked In
            </span>
            <span className="text-sm font-extrabold text-[#c2f02e] font-headline mt-0.5">
              {proteinGrams}g
            </span>
            <span className="text-[9px] text-stone-400">/{targetGoal}g goal</span>
          </div>

          <div className="flex flex-col items-center border-x border-white/10 px-1">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Synthesis
            </span>
            <span className="text-sm font-extrabold text-white font-headline mt-0.5">
              Optimal 🔥
            </span>
            <span className="text-[9px] text-emerald-400 font-medium">100% Hit</span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Campus Rank
            </span>
            <span className="text-sm font-extrabold text-[#c2f02e] font-headline mt-0.5">
              Tier-1 🏆
            </span>
            <span className="text-[9px] text-stone-400">Athlete</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {cartCount > 0 ? (
            <Link
              href="/cart"
              onClick={onClose}
              className="w-full h-11 rounded-full bg-[#c2f02e] hover:bg-[#aad600] text-[#00241a] font-headline font-bold text-xs uppercase flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(194,240,46,0.5)] active:scale-95 transition-transform"
            >
              <span>View Cart &amp; Place Order</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full h-11 rounded-full bg-[#c2f02e] hover:bg-[#aad600] text-[#00241a] font-headline font-bold text-xs uppercase flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(194,240,46,0.5)] active:scale-95 transition-transform cursor-pointer"
            >
              <span>Keep Fueling 🔥</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full py-1 text-xs text-stone-400 hover:text-white transition-colors cursor-pointer font-medium"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
