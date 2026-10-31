"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  SlidersHorizontal,
  Plus,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
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

  // Active items (DB or Sample Data)
  const activeItems = useMemo(() => {
    if (useSampleData) {
      return SAMPLE_HEALTHY_ITEMS;
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
    <div className="healthy-theme space-y-6 pb-24 text-emerald-950 dark:text-emerald-50">
      {/* Dev preview sample toggle (compiled out in prod) */}
      <HealthySampleToggle
        useSampleData={useSampleData}
        onToggle={(next) => setUseSampleData(next)}
      />

      {/* Header bar: Back to Menu & Healthy Mode Title */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <Link
          href="/menu"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 transition-colors p-1 -ml-1 rounded-lg"
          aria-label="Back to canteen menu"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Menu</span>
        </Link>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-600/10 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-xs font-bold">
          <Leaf className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Healthy Mode</span>
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
          {/* Sliding Banner Carousel (Auto-advancing 4.5s, pause on hover/focus/touch, swipe) */}
          <HealthyCarousel items={activeItems} />

          {/* Preferences Sheet Trigger Banner */}
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
            className="group rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-600/10 via-card to-emerald-500/5 p-4 shadow-2xs hover:border-emerald-500/50 hover:shadow-xs transition-all cursor-pointer flex items-center justify-between gap-3 select-none"
            aria-label="Open protein and calorie preferences"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs group-hover:scale-105 transition-transform">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-foreground">
                  Customise protein & calorie targets
                </h3>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Get personalized suggestions matching your daily fitness target
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-8 px-3 rounded-xl border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-bold text-xs group-hover:bg-emerald-600 group-hover:text-white group-hover:border-emerald-600 transition-all pointer-events-none"
            >
              <span>Set</span>
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </div>

          {/* Top Protein Dishes Row */}
          <TopProteinRow
            items={activeItems}
            onOpenDish={(dish) => setSelectedDish(dish)}
          />

          {/* Protein & Calories Toggle Chips & Range Filter */}
          <section className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-1.5">
                <span>Healthy Canteen Menu</span>
              </h2>
              <span className="text-[11px] font-semibold text-muted-foreground">
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

            {/* Filtered Dishes Grid */}
            {filteredDishes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-card/60 p-8 text-center space-y-2">
                <p className="text-xs font-bold text-foreground">
                  No dishes match this nutrient filter
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Try tapping the active bubble to clear the filter or explore other ranges.
                </p>
                <div className="pt-2">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {filteredDishes.map((dish) => (
                  <div
                    key={dish.id}
                    onClick={() => setSelectedDish(dish)}
                      className="group rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs hover:border-emerald-500/40 hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between gap-3 select-none"
                    >
                      <div className="flex gap-3">
                        <div className="relative h-18 w-18 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted/30">
                          <MenuItemImage
                            src={dish.image_url}
                            alt={dish.name}
                            aspect="square"
                            sizes="72px"
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                            containerClassName="h-full w-full"
                          />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <VegIndicator isVeg={dish.is_veg} />
                            {dish.protein_g != null && (
                              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                                {dish.protein_g}g Protein
                              </span>
                            )}
                            {dish.calories_kcal != null && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                {dish.calories_kcal} kcal
                              </span>
                            )}
                          </div>

                          <h3 className="text-xs font-bold text-foreground truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                            {dish.name}
                          </h3>

                          {dish.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1 leading-snug">
                              {dish.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                        <span className="text-xs font-extrabold text-foreground">
                          {formatPaise(dish.price_paise)}
                        </span>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold group-hover:underline">
                            Nutrition details
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            disabled={!dish.is_available}
                            onClick={(e) => handleAddToCart(e, dish)}
                            className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-2xs active:scale-95 transition-all"
                            aria-label={`Add ${dish.name} to cart`}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            <span>Add</span>
                          </Button>
                        </div>
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
