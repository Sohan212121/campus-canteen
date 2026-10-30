"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";

import { BestSellerCard } from "@/components/student/best-seller-card";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface BestSellersRowProps {
  bestSellers: BestSellerItem[];
  onOpenDetail: (item: MenuItemData) => void;
}

export function BestSellersRow({
  bestSellers,
  onOpenDetail,
}: BestSellersRowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getStep = useCallback(() => {
    if (!containerRef.current) return 212;
    const card = containerRef.current.firstElementChild as HTMLElement;
    return card ? card.offsetWidth + 12 : 212; // card width + 12px gap
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!containerRef.current) return;
      const step = getStep();
      const targetLeft = index * step;
      containerRef.current.scrollTo({
        left: targetLeft,
        behavior: "smooth",
      });
      setCurrentIndex(index);
    },
    [getStep]
  );

  const handleNext = useCallback(() => {
    if (!containerRef.current || bestSellers.length === 0) return;
    const nextIdx = (currentIndex + 1) % bestSellers.length;
    scrollToIndex(nextIdx);
  }, [currentIndex, bestSellers.length, scrollToIndex]);

  const handlePrev = useCallback(() => {
    if (!containerRef.current || bestSellers.length === 0) return;
    const prevIdx = (currentIndex - 1 + bestSellers.length) % bestSellers.length;
    scrollToIndex(prevIdx);
  }, [currentIndex, bestSellers.length, scrollToIndex]);

  const pauseTemporarily = useCallback((duration = 4000) => {
    setIsPaused(true);
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, duration);
  }, []);

  // Auto-transition: shifts food items from right to left every 2.8 seconds
  useEffect(() => {
    if (isPaused || !bestSellers || bestSellers.length < 3) return;

    const timer = setInterval(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const step = getStep();
      const maxScroll = container.scrollWidth - container.clientWidth;

      if (container.scrollLeft >= maxScroll - 24) {
        // Smoothly loop back to first item
        container.scrollTo({ left: 0, behavior: "smooth" });
        setCurrentIndex(0);
      } else {
        const nextIdx = (currentIndex + 1) % bestSellers.length;
        container.scrollTo({ left: nextIdx * step, behavior: "smooth" });
        setCurrentIndex(nextIdx);
      }
    }, 2800);

    return () => clearInterval(timer);
  }, [isPaused, currentIndex, bestSellers, getStep]);

  // Synchronize index if user scrolls naturally with finger
  const handleScroll = () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const step = getStep();
    const calculatedIndex = Math.round(container.scrollLeft / step);
    const clampedIndex = Math.min(bestSellers.length - 1, Math.max(0, calculatedIndex));
    if (clampedIndex !== currentIndex) {
      setCurrentIndex(clampedIndex);
    }
  };

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    };
  }, []);

  if (!bestSellers || bestSellers.length < 3) {
    return null;
  }

  return (
    <section className="space-y-2.5" aria-labelledby="best-sellers-heading">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 id="best-sellers-heading" className="text-sm font-bold tracking-tight text-foreground">
              Best Sellers
            </h2>
          </div>
        </div>

        {/* Shifting Carousel Controls & Position Indicator */}
        <div className="flex items-center gap-2">
          {/* Pagination Indicators */}
          <div className="flex items-center gap-1" aria-hidden="true">
            {bestSellers.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  pauseTemporarily(5000);
                  scrollToIndex(idx);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex
                    ? "w-4 bg-amber-500"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                }`}
                aria-label={`Jump to food item ${idx + 1}`}
              />
            ))}
          </div>

          {/* Quick Step Buttons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                pauseTemporarily(5000);
                handlePrev();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95 cursor-pointer"
              aria-label="Previous food item"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                pauseTemporarily(5000);
                handleNext();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/80 bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95 cursor-pointer"
              aria-label="Next food item"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Horizontally sliding container with auto right-to-left transition */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => pauseTemporarily(4000)}
        className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pt-0.5 scroll-smooth snap-x snap-mandatory"
      >
        {bestSellers.map((bs, index) => (
          <div
            key={bs.item.id}
            className={`w-[200px] sm:w-[220px] shrink-0 snap-start transition-all duration-300 ${
              index === currentIndex ? "scale-[1.01]" : "opacity-95"
            }`}
          >
            <BestSellerCard
              bestSeller={bs}
              onOpenDetail={onOpenDetail}
              className="h-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
