"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dumbbell,
  Star,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
} from "lucide-react";
import { formatPaise } from "@/lib/money";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface TopProteinRowProps {
  items: MenuItemData[];
  onOpenDish: (item: MenuItemData) => void;
  onAddToCart?: (e: React.MouseEvent, item: MenuItemData) => void;
}

export function TopProteinRow({
  items,
  onOpenDish,
  onAddToCart,
}: TopProteinRowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // Filter dishes that have protein_g > 0 and sort descending
  const topProteinDishes = items
    .filter((i) => i.is_active && i.protein_g != null && i.protein_g > 0)
    .sort((a, b) => (b.protein_g as number) - (a.protein_g as number))
    .slice(0, 8);

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % topProteinDishes.length);
  }, [topProteinDishes.length]);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + topProteinDishes.length) % topProteinDishes.length);
  }, [topProteinDishes.length]);

  // Keep performing transition one by one automatically every 3.8s
  useEffect(() => {
    if (prefersReducedMotion || isPaused || topProteinDishes.length <= 1) return;

    const timer = setInterval(() => {
      nextSlide();
    }, 3800);

    return () => clearInterval(timer);
  }, [prefersReducedMotion, isPaused, nextSlide, topProteinDishes.length]);

  // Touch Swipe Handlers for mobile gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsPaused(true);
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    setIsPaused(false);
    if (touchStartX.current === null || touchEndX.current === null) return;
    const diff = touchStartX.current - touchEndX.current;
    if (diff > 45) {
      nextSlide();
    } else if (diff < -45) {
      prevSlide();
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prevSlide();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nextSlide();
    }
  };

  if (topProteinDishes.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3.5" aria-label="Top Protein Fuel transition window">
      {/* Header with Title & One-by-One Slide Navigation Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
              <Dumbbell className="h-4 w-4" />
            </div>
            <h2 className="text-sm sm:text-base font-black tracking-tight text-foreground">
              Top Protein Fuel
            </h2>
          </div>
          <p className="text-[11px] text-muted-foreground font-medium pl-9">
            Highest protein-density meals for sustained campus energy
          </p>
        </div>

        {/* Previous / Next One-by-One Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={prevSlide}
            aria-label="Previous protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-card text-foreground transition-all cursor-pointer hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            aria-label="Next protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-card text-foreground transition-all cursor-pointer hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs active:scale-95"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Transition Window (Showcases 1 dish card at a time with smooth sliding transition) */}
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Top protein dishes"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative overflow-hidden rounded-3xl border border-emerald-950/10 dark:border-emerald-400/20 bg-card shadow-sm focus:outline-hidden"
      >
        {/* Animated Sliding Track */}
        <div
          className={`flex ${
            prefersReducedMotion
              ? ""
              : "transition-transform duration-700 cubic-bezier(0.2, 0.8, 0.2, 1) will-change-transform"
          }`}
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {topProteinDishes.map((dish, idx) => (
            <div
              key={dish.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${idx + 1} of ${topProteinDishes.length}: ${dish.name}, ${dish.protein_g} grams protein`}
              aria-hidden={currentIndex !== idx}
              className="w-full shrink-0 flex flex-col justify-between group cursor-pointer select-none"
              onClick={() => onOpenDish(dish)}
            >
              {/* Full-width Food Image Area with Badges Overlay */}
              <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-muted/30">
                <MenuItemImage
                  src={dish.image_url}
                  alt={dish.name}
                  aspect="4/3"
                  sizes="(max-width: 640px) 100vw, 600px"
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500 will-change-transform"
                  containerClassName="h-full w-full"
                />

                {/* Dark gradient scrim for maximum text legibility */}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none"
                  aria-hidden="true"
                />

                {/* Top Badges: Veg indicator & High-Protein pill */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-1 z-10">
                  <div className="p-1.5 rounded-xl bg-white/95 dark:bg-zinc-950/90 shadow-2xs backdrop-blur-md">
                    <VegIndicator isVeg={dish.is_veg} />
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600/95 text-white shadow-xs backdrop-blur-md border border-emerald-400/30 text-xs font-black">
                    <Dumbbell className="h-3.5 w-3.5" />
                    <span>{dish.protein_g}g Protein</span>
                  </div>
                </div>

                {/* Bottom of Image Overlay: Calories & Star Rating */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 z-10 text-xs">
                  {dish.calories_kcal != null ? (
                    <span className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white font-black border border-white/10">
                      {dish.calories_kcal} kcal
                    </span>
                  ) : <span />}

                  {dish.rating_avg != null && dish.rating_avg > 0 && (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-amber-300 font-bold border border-white/10">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span>{dish.rating_avg.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Body & Footer Details */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-black tracking-tight text-foreground group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors line-clamp-1">
                      {dish.name}
                    </h3>

                    {dish.prep_minutes > 0 && (
                      <span className="text-[11px] font-semibold text-muted-foreground shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span>~{dish.prep_minutes} min</span>
                      </span>
                    )}
                  </div>

                  {dish.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {dish.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border/60">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      PRICE
                    </span>
                    <span className="text-base sm:text-lg font-black text-foreground">
                      {formatPaise(dish.price_paise)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDish(dish);
                      }}
                      className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline px-2 py-1 cursor-pointer"
                    >
                      Macros
                    </button>

                    {onAddToCart && (
                      <button
                        type="button"
                        disabled={!dish.is_available}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToCart(e, dish);
                        }}
                        className="inline-flex items-center justify-center min-h-[36px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-xs active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                        aria-label={`Add ${dish.name} to cart`}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide Indicators: Real-time Pagination Pills */}
      {topProteinDishes.length > 1 && (
        <div
          className="flex items-center justify-center gap-1.5 pt-0.5"
          role="tablist"
          aria-label="Top protein slides"
        >
          {topProteinDishes.map((_, dotIdx) => (
            <button
              key={dotIdx}
              type="button"
              role="tab"
              aria-selected={currentIndex === dotIdx}
              aria-label={`Go to slide ${dotIdx + 1}`}
              onClick={() => setCurrentIndex(dotIdx)}
              className={`h-1.5 rounded-full transition-all duration-500 cursor-pointer ${
                currentIndex === dotIdx
                  ? "w-8 bg-emerald-600 dark:bg-emerald-400 shadow-xs"
                  : "w-2 bg-emerald-950/20 dark:bg-emerald-400/25 hover:bg-emerald-950/40"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
