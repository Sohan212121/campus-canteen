"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Zap,
  Star,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
} from "lucide-react";
import { formatPaise } from "@/lib/money";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface TopProteinRowProps {
  items: MenuItemData[];
  onOpenDish: (item: MenuItemData) => void;
  onAddToCart?: (e: React.MouseEvent, item: MenuItemData) => void;
  getItemQuantity?: (id: string) => number;
  onUpdateQuantity?: (id: string, qty: number) => void;
  onRemoveItem?: (id: string) => void;
}

export function TopProteinRow({
  items,
  onOpenDish,
  onAddToCart,
  getItemQuantity,
  onUpdateQuantity,
  onRemoveItem,
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

  // Auto slide every 3.2s
  useEffect(() => {
    if (prefersReducedMotion || isPaused || topProteinDishes.length <= 1) return;

    const timer = setInterval(() => {
      nextSlide();
    }, 3200);

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
    <section className="space-y-3" aria-label="Top Protein Picks carousel">
      {/* Header with Category Tag, Title, and Carousel Navigation Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#506600] dark:text-[#81c784]">
            Chef Recommended
          </span>
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#00241a] dark:text-[#ede7e1] font-headline">
            Top Protein Picks
          </h2>
        </div>

        {/* Previous / Next Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={prevSlide}
            aria-label="Previous protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#c0c8c3]/40 dark:border-stone-700 bg-white dark:bg-[#1a1714] text-[#00241a] dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-[#f6f3ec] dark:hover:bg-stone-800 active:scale-95 shadow-2xs"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextSlide}
            aria-label="Next protein slide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#c0c8c3]/40 dark:border-stone-700 bg-white dark:bg-[#1a1714] text-[#00241a] dark:text-[#ede7e1] transition-all cursor-pointer hover:bg-[#f6f3ec] dark:hover:bg-stone-800 active:scale-95 shadow-2xs"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Carousel Track */}
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
        <div
          className={`flex gap-3 sm:gap-4 ${
            prefersReducedMotion
              ? ""
              : "transition-transform duration-300 ease-out will-change-transform"
          }`}
          style={{
            transform: `translateX(calc(-${currentIndex} * (clamp(260px, 78vw, 290px) + 12px)))`,
          }}
        >
          {topProteinDishes.map((dish, idx) => {
            const currentQty = getItemQuantity ? getItemQuantity(dish.id) : 0;

            return (
              <div
                key={dish.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${idx + 1} of ${topProteinDishes.length}: ${dish.name}, ${dish.protein_g} grams protein`}
                aria-hidden={currentIndex !== idx}
                className="w-[clamp(260px,78vw,290px)] shrink-0 flex flex-col justify-between group rounded-2xl border border-[#c0c8c3]/40 dark:border-stone-800 bg-[#f6f3ec] dark:bg-[#1a1714] shadow-[0_8px_24px_-4px_rgba(11,59,46,0.1)] hover:shadow-md transition-shadow overflow-hidden cursor-pointer select-none relative p-3 sm:p-3.5"
                onClick={() => onOpenDish(dish)}
              >
                {/* Ambient Soft Glow in Card Corner (Light Mode) */}
                <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-[#c2f02e]/15 dark:bg-[#2E7D32]/10 blur-xl pointer-events-none" />

                <div>
                  {/* Food Image Area with Coral Protein Callout Badge */}
                  <div className="relative w-full h-36 rounded-xl overflow-hidden mb-2.5 shadow-xs bg-muted/20">
                    <MenuItemImage
                      src={dish.image_url}
                      alt={dish.name}
                      aspect="4/3"
                      sizes="(max-width: 640px) 80vw, 320px"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500 will-change-transform"
                      containerClassName="h-full w-full"
                    />

                    {/* Top Coral Protein Callout Badge & Veg Indicator */}
                    <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-1 z-10">
                      {dish.protein_g != null && (
                        <div className="bg-[#691000] text-white px-2.5 py-1 rounded-full shadow-md flex items-center gap-1 border border-[#ff6f4f]/30">
                          <Zap className="h-3 w-3 text-[#c2f02e] fill-[#c2f02e]" />
                          <span className="font-bold text-[11px] tracking-tight">
                            {dish.protein_g}g PROTEIN
                          </span>
                        </div>
                      )}
                      <div className="p-1 rounded-lg bg-white/95 dark:bg-black/90 shadow-2xs backdrop-blur-md">
                        <VegIndicator isVeg={dish.is_veg} />
                      </div>
                    </div>

                    {/* Bottom Image Badges: Rating & Calories */}
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1 z-10">
                      {dish.calories_kcal != null && (
                        <div className="px-2 py-0.5 rounded-full bg-black/75 text-white font-bold text-[10px] backdrop-blur-xs">
                          {dish.calories_kcal} kcal
                        </div>
                      )}
                      {dish.rating_avg != null && dish.rating_avg > 0 && (
                        <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-black/75 text-amber-400 font-bold text-[10px] backdrop-blur-xs">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          <span>{dish.rating_avg.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Title & Metadata Line */}
                  <h3 className="font-bold text-sm sm:text-base text-[#00241a] dark:text-[#ede7e1] group-hover:text-[#506600] dark:group-hover:text-[#81c784] transition-colors line-clamp-1 font-headline">
                    {dish.name}
                  </h3>

                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[#414945] dark:text-stone-400 font-medium">
                    <span className="flex items-center text-[#00241a] dark:text-white font-bold">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500 mr-0.5" />
                      {dish.rating_avg ? dish.rating_avg.toFixed(1) : "4.8"}
                    </span>
                    <span>•</span>
                    <span>{dish.prep_minutes || 20} min</span>
                    <span>•</span>
                    <span className="text-[#506600] dark:text-[#ffb74d] font-semibold">
                      {dish.calories_kcal || 350} kcal
                    </span>
                  </div>
                </div>

                {/* Price, Macros Link & Circular Add Button / Stepper */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#c0c8c3]/30 dark:border-stone-800">
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-base sm:text-lg font-bold text-[#00241a] dark:text-white font-headline leading-none">
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
                      className="text-xs font-bold text-[#506600] dark:text-[#81c784] hover:underline cursor-pointer px-1 py-1"
                    >
                      Macros
                    </button>

                    {currentQty > 0 ? (
                      <div
                        className="flex items-center gap-1 bg-white dark:bg-[#141210] border border-[#c0c8c3]/40 dark:border-stone-700 rounded-full p-0.5 shadow-2xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={`Decrease ${dish.name} quantity`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (currentQty === 1) {
                              onRemoveItem?.(dish.id);
                            } else {
                              onUpdateQuantity?.(dish.id, currentQty - 1);
                            }
                          }}
                          className="w-7 h-7 rounded-full bg-[#f6f3ec] dark:bg-stone-800 text-[#00241a] dark:text-white flex items-center justify-center hover:bg-muted active:scale-90 transition-all cursor-pointer"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-xs font-bold text-[#00241a] dark:text-white w-5 text-center select-none font-headline">
                          {currentQty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${dish.name} quantity`}
                          disabled={currentQty >= MAX_ITEM_QUANTITY}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToCart?.(e, dish);
                          }}
                          className="w-7 h-7 rounded-full bg-[#0b3b2e] dark:bg-[#2E7D32] hover:bg-[#10b981] flex items-center justify-center text-white active:scale-90 transition-all cursor-pointer disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Add ${dish.name} to meal`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToCart?.(e, dish);
                        }}
                        className="h-9 w-9 rounded-full bg-[#0b3b2e] dark:bg-[#2E7D32] hover:bg-[#10b981] dark:hover:bg-[#4CAF50] text-white font-bold flex items-center justify-center shadow-[0_4px_12px_rgba(11,59,46,0.35)] active:scale-90 transition-transform cursor-pointer"
                      >
                        <Plus className="h-4 w-4 stroke-[2.5]" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Slide Indicators (Active Pill + Inactive Dots) */}
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
                  ? "w-6 h-1.5 bg-[#506600] dark:bg-[#81c784]"
                  : "w-1.5 h-1.5 bg-[#c0c8c3] dark:bg-stone-700 hover:bg-stone-400"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
