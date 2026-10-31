"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  SlidersHorizontal,
  Plus,
  ChevronRight,
  Info,
  Clock,
  Dumbbell,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
import { isValidMenuImageUrl } from "@/lib/image-utils";
import { HealthyCarousel } from "@/components/student/healthy/healthy-carousel";
import {
  HealthyRangeChips,
  type MetricTab,
  type ProteinRange,
  type CalorieRange,
} from "@/components/student/healthy/healthy-range-chips";
import { TopProteinRow } from "@/components/student/healthy/top-protein-row";
import { HealthyPreferencesSheet } from "@/components/student/healthy/healthy-preferences-sheet";
import { HealthyNutritionSheet } from "@/components/student/healthy/healthy-nutrition-sheet";
import {
  HealthySampleToggle,
  SAMPLE_HEALTHY_ITEMS,
} from "@/components/student/healthy/healthy-sample-toggle";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyMainViewProps {
  initialItems: MenuItemData[];
  migrationPending?: boolean;
}

export function HealthyMainView({
  initialItems = [],
  migrationPending = false,
}: HealthyMainViewProps) {
  const [useSampleData, setUseSampleData] = useState(
    process.env.NODE_ENV !== "production" && initialItems.length === 0
  );
  const [selectedMetric, setSelectedMetric] = useState<MetricTab>("protein");
  const [proteinRange, setProteinRange] = useState<ProteinRange>(null);
  const [calorieRange, setCalorieRange] = useState<CalorieRange>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [selectedDish, setSelectedDish] = useState<MenuItemData | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const getItemQuantity = useCartStore((s) => s.getItemQuantity);

  // Active items (DB or Sample Data, ensuring every dish gets a real food image from available canteen photos)
  const activeItems = useMemo(() => {
    // Collect all valid photos from real canteen dishes
    const availableCanteenImages = initialItems
      .map((i) => i.image_url)
      .filter((url): url is string => Boolean(url && isValidMenuImageUrl(url)));

    if (useSampleData) {
      return SAMPLE_HEALTHY_ITEMS.map((sample, idx) => {
        // 1. Try keyword match with real dishes (e.g. "chicken", "paneer", "egg")
        const sampleWords = sample.name.toLowerCase().split(/[\s()]+/);
        const match = initialItems.find((i) => {
          if (!i.image_url || !isValidMenuImageUrl(i.image_url)) return false;
          const itemWords = i.name.toLowerCase().split(/[\s()]+/);
          return sampleWords.some((w) => w.length > 3 && itemWords.includes(w));
        });

        if (match?.image_url) {
          return { ...sample, image_url: match.image_url };
        }

        // 2. If no direct keyword match, rotate through available canteen dish images
        if (availableCanteenImages.length > 0) {
          return {
            ...sample,
            image_url: availableCanteenImages[idx % availableCanteenImages.length],
          };
        }

        return sample;
      });
    }

    return initialItems;
  }, [useSampleData, initialItems]);

  // Filter dishes by range bubble
  const filteredDishes = useMemo(() => {
    return activeItems.filter((dish) => {
      if (!dish.is_active) return false;

      if (selectedMetric === "protein") {
        if (!proteinRange) return true;
        if (dish.protein_g == null) return false;
        if (proteinRange === "20-30") return dish.protein_g >= 20 && dish.protein_g <= 30;
        if (proteinRange === "30-40") return dish.protein_g > 30 && dish.protein_g <= 40;
        if (proteinRange === "40+") return dish.protein_g > 40;
      } else {
        if (!calorieRange) return true;
        if (dish.calories_kcal == null) return false;
        if (calorieRange === "under-300") return dish.calories_kcal < 300;
        if (calorieRange === "300-500") return dish.calories_kcal >= 300 && dish.calories_kcal <= 500;
        if (calorieRange === "500+") return dish.calories_kcal > 500;
      }
      return true;
    });
  }, [activeItems, selectedMetric, proteinRange, calorieRange]);

  const handleAddToCart = (e: React.MouseEvent, dish: MenuItemData) => {
    e.stopPropagation();
    if (!dish.is_available) {
      toast.error(`${dish.name} is currently out of stock`);
      return;
    }

    const currentQty = getItemQuantity(dish.id);
    if (currentQty >= MAX_ITEM_QUANTITY) {
      toast.error(`Maximum quantity of ${MAX_ITEM_QUANTITY} reached for ${dish.name}`);
      return;
    }

    addItem(dish.id, 1);
    toast.success(`Added ${dish.name} to cart`);
  };

  const isSheetOpen = isPreferencesOpen || selectedDish !== null;

  return (
    <div className="space-y-6 pb-24 text-foreground selection:bg-emerald-500 selection:text-white">
      {/* Dev preview sample toggle (compiled out in prod) */}
      <HealthySampleToggle
        useSampleData={useSampleData}
        onToggle={(next) => setUseSampleData(next)}
      />

      {/* Header bar: Back to Menu & Healthy Mode Brand Status */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <Link
          href="/menu"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-100 transition-colors py-1.5 px-3 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/20 active:scale-95"
          aria-label="Back to canteen menu"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Menu</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/healthy/score"
            className="text-[11px] font-bold text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors hidden xs:inline-flex items-center gap-1"
          >
            <Info className="h-3 w-3" />
            <span>Score Guide</span>
          </Link>

          <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600/10 dark:bg-emerald-400/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-xs font-extrabold shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span>Healthy Mode</span>
          </div>
        </div>
      </header>

      {/* Migration 0020 unavailable state (when no sample data and migration pending) */}
      {migrationPending && !useSampleData ? (
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-8 text-center space-y-4 shadow-sm">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Leaf className="h-7 w-7" />
          </div>
          <div className="space-y-1.5 max-w-sm mx-auto">
            <h2 className="text-base font-bold text-foreground">
              Nutrition Details Updating
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nutrition details are being updated by the canteen. Check back soon!
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/menu"
              className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition-all active:scale-95"
            >
              Back to Menu
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Editorial Nutrition Tip Banner (Auto-advancing 4.5s, pause on hover/focus/touch, swipe) */}
          <HealthyCarousel items={activeItems} />

          {/* Preferences Sheet Trigger Banner: Fitness Fuel Targeter */}
          <div
            onClick={() => setIsPreferencesOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsPreferencesOpen(true);
              }
            }}
            className="group rounded-3xl border border-emerald-950/10 dark:border-emerald-400/20 bg-gradient-to-r from-emerald-600/10 via-teal-500/5 to-transparent p-4 sm:p-5 shadow-xs hover:border-emerald-500/50 hover:shadow-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-3 select-none"
            aria-label="Open protein and calorie preferences"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-sm group-hover:scale-105 transition-transform duration-300">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-sm font-black text-foreground">
                    Customise Daily Nutrition Targets
                  </h3>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 hidden xs:inline-block">
                    Interactive
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug">
                  Set target calories & protein to generate instant smart dish matches
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-9 px-3.5 rounded-2xl border-emerald-500/30 text-emerald-800 dark:text-emerald-300 font-extrabold text-xs group-hover:bg-emerald-600 group-hover:text-white group-hover:border-emerald-600 transition-all pointer-events-none shadow-2xs"
            >
              <span>Set Goals</span>
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </div>

          {/* Top Protein Dishes Row with Animated Transition Slides */}
          <TopProteinRow
            items={activeItems}
            onOpenDish={(dish) => setSelectedDish(dish)}
            onAddToCart={handleAddToCart}
          />

          {/* Protein & Calories Toggle Chips & Range Filter */}
          <section className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-foreground flex items-center gap-1.5">
                  <span>Healthy Canteen Menu</span>
                </h2>
                <p className="text-[11px] text-muted-foreground font-medium">
                  Verified campus dishes with complete macro breakdown
                </p>
              </div>

              <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                {filteredDishes.length} {filteredDishes.length === 1 ? "dish" : "dishes"}
              </span>
            </div>

            <HealthyRangeChips
              items={activeItems}
              selectedMetric={selectedMetric}
              onSelectMetric={(m) => {
                setSelectedMetric(m);
                setProteinRange(null);
                setCalorieRange(null);
              }}
              proteinRange={proteinRange}
              onSelectProteinRange={(r) => setProteinRange(r)}
              calorieRange={calorieRange}
              onSelectCalorieRange={(r) => setCalorieRange(r)}
            />

            {/* Filtered Dishes Properly Formatted List */}
            {filteredDishes.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border/80 bg-card/60 p-8 text-center space-y-3 shadow-2xs">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Leaf className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-foreground">
                    No dishes match this nutrient filter
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Try tapping the active capsule above to reset the filter or explore other ranges.
                  </p>
                </div>
                <div className="pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setProteinRange(null);
                      setCalorieRange(null);
                    }}
                    className="h-8 text-xs font-bold rounded-xl"
                  >
                    Clear Filter
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5 pt-1">
                {filteredDishes.map((dish) => (
                  <div
                    key={dish.id}
                    className="group relative flex w-full gap-3 sm:gap-4 rounded-2xl border border-emerald-950/10 dark:border-emerald-400/15 bg-card p-4 shadow-xs hover:border-emerald-500/40 hover:shadow-md transition-all duration-300 text-left select-none"
                  >
                    {/* Left: Information Area (generous width, no truncations) */}
                    <div
                      className="flex flex-1 flex-col justify-between min-w-0 pr-1 cursor-pointer"
                      onClick={() => setSelectedDish(dish)}
                    >
                      <div className="space-y-1.5">
                        {/* Top Meta Badges Row */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <VegIndicator isVeg={dish.is_veg} />

                          {dish.protein_g != null && (
                            <span className="text-[10px] sm:text-[11px] font-black px-2.5 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 flex items-center gap-1">
                              <Dumbbell className="h-3 w-3" />
                              <span>{dish.protein_g}g Protein</span>
                            </span>
                          )}

                          {dish.calories_kcal != null && (
                            <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                              {dish.calories_kcal} kcal
                            </span>
                          )}

                          {dish.prep_minutes > 0 && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-medium">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span>~{dish.prep_minutes} min</span>
                            </span>
                          )}

                          {dish.rating_avg != null && dish.rating_avg > 0 && (
                            <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10">
                              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                              <span>{dish.rating_avg.toFixed(1)}</span>
                            </div>
                          )}
                        </div>

                        {/* Dish Name: Full, readable bold title */}
                        <h3 className="text-sm sm:text-base font-black text-foreground group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors leading-snug line-clamp-2 pt-0.5">
                          {dish.name}
                        </h3>

                        {/* Description: Readable text */}
                        {dish.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {dish.description}
                          </p>
                        )}
                      </div>

                      {/* Bottom Info Row: Price & Nutrition Details Link */}
                      <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/50">
                        <span className="text-base sm:text-lg font-black text-foreground tracking-tight">
                          {formatPaise(dish.price_paise)}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDish(dish);
                          }}
                          className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-0.5 cursor-pointer py-1 px-1"
                        >
                          <span>Nutrition details</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Right: Generous Food Image + Add Button */}
                    <div className="relative flex flex-col items-center justify-between shrink-0 w-26 sm:w-32">
                      <div
                        onClick={() => setSelectedDish(dish)}
                        className="relative h-20 w-26 sm:h-24 sm:w-32 overflow-hidden rounded-2xl bg-muted/40 shadow-2xs group-hover:scale-105 transition-transform duration-300 cursor-pointer border border-border/60"
                      >
                        <MenuItemImage
                          src={dish.image_url}
                          alt={dish.name}
                          aspect="4/3"
                          sizes="(max-width: 640px) 110px, 130px"
                          className="h-full w-full object-cover"
                          containerClassName="h-full w-full"
                        />
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        disabled={!dish.is_available}
                        onClick={(e) => handleAddToCart(e, dish)}
                        className="w-full mt-2 h-8.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                        aria-label={`Add ${dish.name} to cart`}
                      >
                        <Plus className="h-3.5 w-3.5 mr-0.5" />
                        <span>Add</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Preferences Bottom Sheet with 2 Range Sliders */}
          <HealthyPreferencesSheet
            items={activeItems}
            isOpen={isPreferencesOpen}
            onClose={() => setIsPreferencesOpen(false)}
            onOpenDishDetail={(dish) => {
              setIsPreferencesOpen(false);
              setSelectedDish(dish);
            }}
          />

          {/* "Know your food" Nutrition Detail Bottom Sheet */}
          <HealthyNutritionSheet
            item={selectedDish}
            isOpen={selectedDish !== null}
            onClose={() => setSelectedDish(null)}
          />
        </>
      )}

      {/* Cart shortcut */}
      <CartShortcut
        menuItems={activeItems.map((i) => ({ id: i.id, price_paise: i.price_paise }))}
        isDetailSheetOpen={isSheetOpen}
      />
    </div>
  );
}
