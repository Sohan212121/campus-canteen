"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Leaf } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { HEALTHY_CAROUSEL_TIPS } from "@/lib/healthy-constants";
import { OWNER_LICENSED_BANNER_PHOTOS } from "@/lib/healthy-banner-config";
import { isValidMenuImageUrl } from "@/lib/image-utils";
import { MenuItemImage } from "@/components/student/menu-item-image";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyCarouselProps {
  items: MenuItemData[];
}

interface SlideItem {
  id: string;
  headline: string;
  body: string;
  tag: string;
  imageUrl?: string;
  imageAlt?: string;
  credit?: string;
  gradient: string;
}

const LUXURY_WELLNESS_GRADIENTS = [
  "from-[#1c281a] via-[#161f15] to-[#12100e]",
  "from-[#1e291c] via-[#171e16] to-[#100e0c]",
  "from-[#202d1e] via-[#1a2318] to-[#12100e]",
  "from-[#1c2a1a] via-[#182117] to-[#110f0d]",
  "from-[#192618] via-[#151c14] to-[#0e0c0b]",
];

export function HealthyCarousel({ items }: HealthyCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // Collect dishes with valid images deterministically
  const dishesWithImages = items
    .filter((i) => i.is_active && i.image_url && isValidMenuImageUrl(i.image_url))
    .slice(0, 5);

  const hasAtLeastThreeImages = dishesWithImages.length >= 3;

  // Build slides (4 to 5)
  const slides: SlideItem[] = Array.from({ length: 5 }).map((_, idx) => {
    const tip = HEALTHY_CAROUSEL_TIPS[idx % HEALTHY_CAROUSEL_TIPS.length];
    const gradient = LUXURY_WELLNESS_GRADIENTS[idx % LUXURY_WELLNESS_GRADIENTS.length];

    // Check owner licensed photos first
    if (OWNER_LICENSED_BANNER_PHOTOS.length > idx) {
      const licensed = OWNER_LICENSED_BANNER_PHOTOS[idx];
      return {
        id: `slide-licensed-${idx}`,
        headline: tip.headline,
        body: tip.body,
        tag: tip.tag,
        imageUrl: licensed.src,
        imageAlt: licensed.alt,
        credit: licensed.credit,
        gradient,
      };
    }

    // Otherwise use real canteen dish photo if >= 3 dishes have images
    if (hasAtLeastThreeImages && dishesWithImages[idx % dishesWithImages.length]) {
      const dish = dishesWithImages[idx % dishesWithImages.length];
      return {
        id: `slide-dish-${dish.id}-${idx}`,
        headline: tip.headline,
        body: tip.body,
        tag: tip.tag,
        imageUrl: dish.image_url || undefined,
        imageAlt: dish.name,
        credit: dish.name,
        gradient,
      };
    }

    // Gradient-only fallback
    return {
      id: `slide-gradient-${idx}`,
      headline: tip.headline,
      body: tip.body,
      tag: tip.tag,
      gradient,
    };
  });

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  // Auto-advance every 4.5 seconds (disabled under reduced motion, paused on hover/focus/touch)
  useEffect(() => {
    if (prefersReducedMotion || isPaused) return;

    const timer = setInterval(() => {
      nextSlide();
    }, 4500);

    return () => clearInterval(timer);
  }, [prefersReducedMotion, isPaused, nextSlide]);

  // Touch Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsPaused(true);
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    setIsPaused(false);
    if (!touchStartX.current || !touchEndX.current) return;
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

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label="Healthy eating tips and featured dishes"
      className="relative overflow-hidden rounded-3xl border border-emerald-500/25 dark:border-[#3b533a]/60 shadow-lg shadow-emerald-950/20 bg-card focus:outline-hidden"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Sliding Track with GPU acceleration */}
      <div
        className={`flex ${
          prefersReducedMotion
            ? ""
            : "transition-transform duration-700 cubic-bezier(0.2, 0.8, 0.2, 1) will-change-transform"
        }`}
        style={{ transform: `translateX(-${currentSlide * 100}%)` }}
      >
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${idx + 1} of ${slides.length}: ${slide.headline}`}
            aria-hidden={currentSlide !== idx}
            className={`w-full shrink-0 min-h-[220px] sm:min-h-[240px] bg-gradient-to-br ${slide.gradient} text-white p-5 sm:p-6 flex flex-col justify-between relative overflow-hidden`}
          >
            {/* Top row: Editorial tag & Mode indicator */}
            <div className="flex items-start justify-between gap-3 relative z-10">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[10px] font-black uppercase tracking-wider text-emerald-300 shadow-2xs">
                <span>{slide.tag}</span>
              </span>

              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-200/90 bg-black/25 px-3 py-1 rounded-full backdrop-blur-md border border-white/10">
                <Leaf className="h-3.5 w-3.5 text-emerald-400" />
                <span>Wellness Insight</span>
              </span>
            </div>

            {/* Slide Body: Headline + Text + Optional Dish Photo */}
            <div className="my-2.5 relative z-10 flex items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-sm">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-xs leading-tight">
                  {slide.headline}
                </h3>
                <p className="text-xs sm:text-sm text-emerald-50/90 leading-relaxed line-clamp-3">
                  {slide.body}
                </p>
                {slide.credit && (
                  <p className="text-[10px] text-emerald-300/80 font-bold tracking-wide pt-1">
                    Featured dish: {slide.credit}
                  </p>
                )}
              </div>

              {slide.imageUrl && (
                <div className="shrink-0 w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border border-white/20 shadow-xl bg-black/30 relative">
                  <MenuItemImage
                    src={slide.imageUrl}
                    alt={slide.imageAlt || slide.headline}
                    aspect="square"
                    sizes="120px"
                    className="h-full w-full object-cover"
                    containerClassName="h-full w-full"
                  />
                </div>
              )}
            </div>

            {/* Bottom Row: Animated Slide Indicators and Controls */}
            <div className="flex items-center justify-between pt-2.5 border-t border-white/15 relative z-10">
              {/* Dynamic Pill Indicators */}
              <div
                className="flex items-center gap-1.5"
                role="tablist"
                aria-label="Slide dots"
              >
                {slides.map((_, dotIdx) => (
                  <button
                    key={dotIdx}
                    type="button"
                    role="tab"
                    aria-selected={currentSlide === dotIdx}
                    aria-label={`Go to slide ${dotIdx + 1}`}
                    onClick={() => setCurrentSlide(dotIdx)}
                    className={`h-1.5 rounded-full transition-all duration-500 cursor-pointer ${
                      currentSlide === dotIdx
                        ? "w-8 bg-[#4CAF50] shadow-xs"
                        : "w-2 bg-white/30 hover:bg-white/60"
                    }`}
                  />
                ))}
              </div>

              {/* Prev / Next Glass Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={prevSlide}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/35 hover:bg-[#2E7D32] text-white backdrop-blur-md transition-all active:scale-95 cursor-pointer border border-white/15"
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={nextSlide}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/35 hover:bg-[#2E7D32] text-white backdrop-blur-md transition-all active:scale-95 cursor-pointer border border-white/15"
                  aria-label="Next slide"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
