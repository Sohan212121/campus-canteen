"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dumbbell,
  Star,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Leaf,
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
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-[#2E7D32] to-[#4CAF50] text-white shadow-xs">
              <Leaf className="h-4 w-4" />
            </div>
            <div>
              <span className="font-script text-[11px] sm:text-xs text-[#ffb74d] italic leading-none block">
                Featured Nutrition Harvest
              </span>
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-foreground dark:text-[#ede7e1] leading-tight">
                Top Protein Fuel
              </h2>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground dark:text-stone-400 font-medium pl-9">
            Highest protein-density meals for sustained campus energy
          </p>
        </div>

        {/* Previous / Next One-by-One Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="hidden xs:inline-block px-2.5 py-0.5 rounded-full bg-[#2d4b29] text-[#c9f3c7] font-bold text-[10px] uppercase tracking-wider border border-[#4CAF50]/30 mr-1">
            Chef Curated
          </span>
          <button
            type="button"
            onClick={prevSlide}
            aria-label="Previous protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 dark:border-[#3b533a] bg-card dark:bg-[#1e291c] text-foreground dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-[#2E7D32] hover:text-white dark:hover:border-[#4CAF50] shadow-2xs active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            aria-label="Next protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 dark:border-[#3b533a] bg-card dark:bg-[#1e291c] text-foreground dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-[#2E7D32] hover:text-white dark:hover:border-[#4CAF50] shadow-2xs active:scale-95"
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
        className="relative overflow-hidden rounded-3xl border border-emerald-950/10 dark:border-[#3b533a] bg-card dark:bg-gradient-to-b dark:from-[#1e291c]/95 dark:to-[#161311] shadow-xl focus:outline-hidden backdrop-blur-xl"
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

                {/* Bottom of Image Overlay: Live Cold-Pressed badge & Star Rating */}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 z-10 text-xs">
                  <div className="flex items-center gap-1.5 bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 dark:border-[#3b533a]/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF50] animate-ping" />
                    <span className="text-[10px] text-white dark:text-[#81c784] font-bold tracking-wide uppercase">
                      Cold-Pressed Dressing
                    </span>
                  </div>

                  {dish.rating_avg != null && dish.rating_avg > 0 && (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md text-[#ffb74d] font-bold border border-white/10 dark:border-[#3b533a]/50">
                      <Star className="h-3 w-3 fill-[#ffb74d] text-[#ffb74d]" />
                      <span>{dish.rating_avg.toFixed(1)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Body & Footer Details */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground dark:text-[#ede7e1] group-hover:text-emerald-700 dark:group-hover:text-[#81c784] transition-colors line-clamp-1">
                      {dish.name}
                    </h3>

                    <span className="text-base sm:text-lg font-extrabold text-[#2E7D32] dark:text-[#ffb74d] shrink-0 font-headline">
                      {formatPaise(dish.price_paise)}
                    </span>
                  </div>

                  {dish.description && (
                    <p className="text-xs text-muted-foreground dark:text-[#c4bdb3] line-clamp-2 leading-relaxed">
                      {dish.description}
                    </p>
                  )}
                </div>

                {/* Macro Pill Tags matching Dark Harvest Edition */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {dish.calories_kcal != null && (
                    <span className="bg-emerald-50 dark:bg-[#263725] border border-emerald-500/20 dark:border-[#3b533a]/50 px-2 py-0.5 rounded-full text-emerald-800 dark:text-[#c9f3c7] text-[10px] font-bold">
                      {dish.calories_kcal} kcal
                    </span>
                  )}
                  {dish.protein_g != null && (
                    <span className="bg-emerald-50 dark:bg-[#263725] border border-emerald-500/20 dark:border-[#3b533a]/50 px-2 py-0.5 rounded-full text-emerald-800 dark:text-[#81c784] text-[10px] font-bold">
                      {dish.protein_g}g Protein
                    </span>
                  )}
                  {dish.fibre_g != null && (
                    <span className="bg-amber-50 dark:bg-[#263725] border border-amber-500/20 dark:border-[#3b533a]/50 px-2 py-0.5 rounded-full text-amber-800 dark:text-[#ffb74d] text-[10px] font-bold">
                      {dish.fibre_g}g Fiber
                    </span>
                  )}
                  <span className="bg-muted dark:bg-[#24201c] border border-border/60 dark:border-[#443e39] px-2 py-0.5 rounded-full text-muted-foreground dark:text-[#c4bdb3] text-[10px] font-semibold">
                    Low GI • Fresh Wok
                  </span>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border/60 dark:border-[#3b533a]/40">
                  <div className="flex items-center gap-1.5 text-muted-foreground dark:text-[#c4bdb3] text-xs">
                    <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-[#81c784]" />
                    <span>~{dish.prep_minutes > 0 ? dish.prep_minutes : 5} min</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDish(dish);
                      }}
                      className="text-xs font-bold text-emerald-700 dark:text-[#81c784] hover:underline px-2 py-1 cursor-pointer"
                    >
                      Nutrition Details
                    </button>

                    {onAddToCart && (
                      <button
                        type="button"
                        disabled={!dish.is_available}
                        onClick={(e) => onAddToCart(e, dish)}
                        className="px-4 py-2 rounded-full bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white font-bold text-xs shadow-md shadow-emerald-950/40 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add to Meal</span>
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
