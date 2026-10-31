"use client";

import { useRef, useState, useEffect, useCallback } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Filter dishes that have protein_g > 0 and sort descending
  const topProteinDishes = items
    .filter((i) => i.is_active && i.protein_g != null && i.protein_g > 0)
    .sort((a, b) => (b.protein_g as number) - (a.protein_g as number))
    .slice(0, 8);

  const updateScrollState = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    const firstChild = scrollRef.current.firstElementChild as HTMLElement | null;
    const cardStep = (firstChild?.offsetWidth ?? 260) + 14;

    const idx = Math.round(scrollLeft / cardStep);
    setActiveIndex(Math.min(Math.max(0, idx), Math.max(0, topProteinDishes.length - 1)));
    setCanScrollPrev(scrollLeft > 10);
    setCanScrollNext(scrollLeft < scrollWidth - clientWidth - 10);
  }, [topProteinDishes.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();

    const handleScroll = () => {
      requestAnimationFrame(updateScrollState);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [updateScrollState]);

  const scrollByCard = (direction: "prev" | "next") => {
    if (!scrollRef.current) return;
    const firstChild = scrollRef.current.firstElementChild as HTMLElement | null;
    const cardStep = (firstChild?.offsetWidth ?? 260) + 14;
    const delta = direction === "next" ? cardStep : -cardStep;

    scrollRef.current.scrollBy({
      left: delta,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  const scrollToSlide = (index: number) => {
    if (!scrollRef.current) return;
    const firstChild = scrollRef.current.firstElementChild as HTMLElement | null;
    const cardStep = (firstChild?.offsetWidth ?? 260) + 14;

    scrollRef.current.scrollTo({
      left: index * cardStep,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  if (topProteinDishes.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3.5" aria-label="Top Protein Fuel carousel">
      {/* Header with Title & Animated Slide Navigation Controls */}
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

        {/* Carousel Prev/Next Slide Transition Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => scrollByCard("prev")}
            disabled={!canScrollPrev}
            aria-label="Previous protein slide"
            className={`flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-card text-foreground transition-all cursor-pointer ${
              canScrollPrev
                ? "hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs active:scale-95"
                : "opacity-35 cursor-not-allowed text-muted-foreground"
            }`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCard("next")}
            disabled={!canScrollNext}
            aria-label="Next protein slide"
            className={`flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-card text-foreground transition-all cursor-pointer ${
              canScrollNext
                ? "hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs active:scale-95"
                : "opacity-35 cursor-not-allowed text-muted-foreground"
            }`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Smooth Transition Slides Container */}
      <div
        ref={scrollRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Top protein dishes"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            scrollByCard("prev");
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            scrollByCard("next");
          }
        }}
        className="flex gap-3.5 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none snap-x snap-mandatory focus:outline-hidden healthy-slide-track"
      >
        {topProteinDishes.map((dish, idx) => (
          <div
            key={dish.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${idx + 1} of ${topProteinDishes.length}: ${dish.name}, ${dish.protein_g} grams protein`}
            onClick={() => onOpenDish(dish)}
            className="w-[250px] sm:w-[275px] shrink-0 snap-start rounded-3xl border border-emerald-950/10 dark:border-emerald-400/15 bg-card overflow-hidden shadow-xs hover:border-emerald-500/50 hover:shadow-md transition-all duration-300 group cursor-pointer flex flex-col justify-between select-none"
          >
            {/* Rich Food Image Area with Badges Overlay */}
            <div className="relative h-36 sm:h-40 w-full overflow-hidden bg-muted/30">
              <MenuItemImage
                src={dish.image_url}
                alt={dish.name}
                aspect="4/3"
                sizes="(max-width: 640px) 260px, 280px"
                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500 will-change-transform"
                containerClassName="h-full w-full"
              />

              {/* Gradient scrim for high readability */}
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent pointer-events-none"
                aria-hidden="true"
              />

              {/* Top badges: Veg indicator & High Protein pill */}
              <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1 z-10">
                <div className="p-1 rounded-xl bg-white/95 dark:bg-zinc-950/90 shadow-2xs backdrop-blur-md">
                  <VegIndicator isVeg={dish.is_veg} />
                </div>

                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600/95 text-white shadow-xs backdrop-blur-md border border-emerald-400/30 text-[11px] font-black">
                  <span>{dish.protein_g}g Protein</span>
                </div>
              </div>

              {/* Bottom image overlay: Calories & Rating */}
              <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 z-10 text-[11px]">
                {dish.calories_kcal != null ? (
                  <span className="px-2 py-0.5 rounded-lg bg-black/50 backdrop-blur-md text-white font-bold border border-white/10">
                    {dish.calories_kcal} kcal
                  </span>
                ) : <span />}

                {dish.rating_avg != null && dish.rating_avg > 0 && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/50 backdrop-blur-md text-amber-300 font-bold border border-white/10">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    <span>{dish.rating_avg.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Card Content & Action Row */}
            <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
              <div className="space-y-1">
                <h3 className="text-xs sm:text-sm font-black tracking-tight text-foreground line-clamp-1 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                  {dish.name}
                </h3>

                {dish.description ? (
                  <p className="text-[11px] text-muted-foreground line-clamp-1 leading-snug">
                    {dish.description}
                  </p>
                ) : (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span>~{dish.prep_minutes} min pickup</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Price
                  </span>
                  <span className="text-sm font-black text-foreground">
                    {formatPaise(dish.price_paise)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDish(dish);
                    }}
                    className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline px-1 py-1"
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
                      className="inline-flex items-center justify-center min-h-[32px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                      aria-label={`Add ${dish.name} to cart`}
                    >
                      <Plus className="h-3.5 w-3.5 mr-0.5" />
                      <span>Add</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Slide Indicators: Interactive Pagination Dots */}
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
              aria-selected={activeIndex === dotIdx}
              aria-label={`Go to slide ${dotIdx + 1}`}
              onClick={() => scrollToSlide(dotIdx)}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                activeIndex === dotIdx
                  ? "w-7 bg-emerald-600 dark:bg-emerald-400"
                  : "w-2 bg-emerald-950/15 dark:bg-emerald-400/20 hover:bg-emerald-950/30"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
