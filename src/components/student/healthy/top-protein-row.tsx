"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dumbbell,
  Star,
  ChevronLeft,
  ChevronRight,
  Plus,
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
    if (topProteinDishes.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % topProteinDishes.length);
  }, [topProteinDishes.length]);

  const prevSlide = useCallback(() => {
    if (topProteinDishes.length === 0) return;
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
      {/* Header with Icon, Title, Subtitle, and Slide Navigation Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00A86B] text-white shrink-0 shadow-xs">
            <Dumbbell className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground dark:text-[#ede7e1] leading-tight font-headline">
              Top Protein Fuel
            </h2>
            <p className="text-[11px] sm:text-xs text-muted-foreground dark:text-stone-400 font-medium">
              Highest protein-density meals for sustained campus energy
            </p>
          </div>
        </div>

        {/* Previous / Next One-by-One Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={prevSlide}
            aria-label="Previous protein slide"
            className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full border border-gray-200 dark:border-stone-700 bg-white dark:bg-[#1a1714] text-foreground dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-muted active:scale-95 shadow-2xs"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            aria-label="Next protein slide"
            className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full border border-gray-200 dark:border-stone-700 bg-white dark:bg-[#1a1714] text-foreground dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-muted active:scale-95 shadow-2xs"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Transition Window (Showcases cards side-by-side with smooth sliding one-by-one transition) */}
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
        className="relative overflow-hidden focus:outline-hidden py-1 select-none"
      >
        {/* Animated Sliding Track */}
        <div
          className={`flex gap-3 sm:gap-4 ${
            prefersReducedMotion
              ? ""
              : "transition-transform duration-500 ease-out will-change-transform"
          }`}
          style={{
            transform: `translateX(calc(-${currentIndex} * (clamp(260px, 78vw, 290px) + 12px)))`,
          }}
        >
          {topProteinDishes.map((dish, idx) => (
            <div
              key={dish.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${idx + 1} of ${topProteinDishes.length}: ${dish.name}, ${dish.protein_g} grams protein`}
              aria-hidden={currentIndex !== idx}
              className="w-[clamp(260px,78vw,290px)] shrink-0 flex flex-col justify-between group rounded-3xl border border-gray-200/80 dark:border-stone-800 bg-white dark:bg-[#1a1714] shadow-xs hover:shadow-md transition-shadow overflow-hidden cursor-pointer select-none"
              onClick={() => onOpenDish(dish)}
            >
              {/* Food Image Area with Overlay Badges */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/20">
                <MenuItemImage
                  src={dish.image_url}
                  alt={dish.name}
                  aspect="4/3"
                  sizes="(max-width: 640px) 80vw, 320px"
                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500 will-change-transform"
                  containerClassName="h-full w-full"
                />

                {/* Top Badges: Veg indicator (left) & High-Protein pill (right) */}
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 z-10">
                  <div className="p-1 rounded-lg bg-white/95 dark:bg-black/90 shadow-2xs backdrop-blur-md">
                    <VegIndicator isVeg={dish.is_veg} />
                  </div>

                  {dish.protein_g != null && (
                    <div className="px-2.5 py-1 rounded-full bg-[#00A86B] text-white font-extrabold text-[11px] shadow-xs backdrop-blur-md">
                      {dish.protein_g}g Protein
                    </div>
                  )}
                </div>

                {/* Bottom Badges: Calories (left) & Star Rating (right) */}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 z-10">
                  {dish.calories_kcal != null && (
                    <div className="px-2.5 py-0.5 rounded-full bg-black/75 text-white font-bold text-[11px] backdrop-blur-xs">
                      {dish.calories_kcal} kcal
                    </div>
                  )}

                  {dish.rating_avg != null && dish.rating_avg > 0 && (
                    <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/75 text-[#f59e0b] font-bold text-[11px] backdrop-blur-xs">
                      <Star className="h-3 w-3 fill-[#f59e0b] text-[#f59e0b]" />
                      <span>{dish.rating_avg.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Body & Footer Details */}
              <div className="p-3.5 sm:p-4 flex flex-col justify-between flex-1 space-y-2">
                <div className="space-y-0.5">
                  <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-gray-100 group-hover:text-[#00A86B] dark:group-hover:text-emerald-400 transition-colors line-clamp-1">
                    {dish.name}
                  </h3>
                  {dish.description && (
                    <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 line-clamp-1 leading-snug">
                      {dish.description}
                    </p>
                  )}
                </div>

                {/* Price, Macros Link & + Add Button */}
                <div className="flex items-end justify-between pt-2 border-t border-gray-100 dark:border-stone-800/80">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-stone-400 uppercase">
                      PRICE
                    </span>
                    <span className="text-base sm:text-lg font-black text-gray-900 dark:text-white font-headline leading-none">
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
                      className="text-xs font-bold text-[#00A86B] dark:text-emerald-400 hover:underline cursor-pointer px-1 py-1"
                    >
                      Macros
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToCart?.(e, dish);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#00A86B] hover:bg-[#008f5b] text-white font-bold text-xs shadow-xs cursor-pointer active:scale-95 transition-all"
                    >
                      <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide Indicators: Real-time Pagination Indicator (Active Green Pill + Gray Dots) */}
      {topProteinDishes.length > 1 && (
        <div
          className="flex items-center justify-center gap-1.5 pt-1"
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
              className={`transition-all duration-300 rounded-full cursor-pointer ${
                currentIndex === dotIdx
                  ? "w-6 h-1.5 bg-[#00A86B]"
                  : "w-1.5 h-1.5 bg-gray-200 dark:bg-stone-700 hover:bg-gray-300 dark:hover:bg-stone-600"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
