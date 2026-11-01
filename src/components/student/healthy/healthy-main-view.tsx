"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  SlidersHorizontal,
  Plus,
  Minus,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { calculateEstimatedCartTotal } from "@/lib/cart-shortcut";
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

const BOTANICAL_CATEGORIES = [
  { id: "salads", label: "Farm Fresh Salads", emoji: "🥗" },
  { id: "millets", label: "Steamed Millets", emoji: "🌾" },
  { id: "protein", label: "High-Protein Tofu & Paneer", emoji: "💪" },
  { id: "elixirs", label: "Zero-Sugar Elixirs", emoji: "🥤" },
];

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [selectedDish, setSelectedDish] = useState<MenuItemData | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const getItemQuantity = useCartStore((s) => s.getItemQuantity);
  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const cartItems = useCartStore((s) => s.items);

  // Active items (DB or Sample Data, ensuring every dish gets a real food image from available canteen photos)
  const activeItems = useMemo(() => {
    const availableCanteenImages = initialItems
      .map((i) => i.image_url)
      .filter((url): url is string => Boolean(url && isValidMenuImageUrl(url)));

    if (useSampleData) {
      return SAMPLE_HEALTHY_ITEMS.map((sample, idx) => {
        const sampleWords = sample.name.toLowerCase().split(/[\s()]+/);
        const match = initialItems.find((i) => {
          if (!i.image_url || !isValidMenuImageUrl(i.image_url)) return false;
          const itemWords = i.name.toLowerCase().split(/[\s()]+/);
          return sampleWords.some((w) => w.length > 3 && itemWords.includes(w));
        });

        if (match?.image_url) {
          return { ...sample, image_url: match.image_url };
        }

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

  // Estimated cart total for docked tray
  const estimatedTotal = useMemo(() => {
    return calculateEstimatedCartTotal(
      cartItems,
      activeItems.map((i) => ({ id: i.id, price_paise: i.price_paise }))
    );
  }, [cartItems, activeItems]);

  // Filter dishes by metric range and botanical category
  const filteredDishes = useMemo(() => {
    return activeItems.filter((dish) => {
      if (!dish.is_active) return false;

      // Filter by category if selected
      if (selectedCategory) {
        const lowerName = dish.name.toLowerCase();
        const lowerDesc = (dish.description || "").toLowerCase();
        if (selectedCategory === "salads") {
          if (!lowerName.includes("salad") && !lowerName.includes("bowl") && !lowerDesc.includes("salad")) return false;
        } else if (selectedCategory === "millets") {
          if (!lowerName.includes("idli") && !lowerName.includes("millet") && !lowerDesc.includes("millet") && !lowerDesc.includes("ragi")) return false;
        } else if (selectedCategory === "protein") {
          if ((dish.protein_g ?? 0) < 20 && !lowerName.includes("paneer") && !lowerName.includes("tofu") && !lowerName.includes("chicken")) return false;
        } else if (selectedCategory === "elixirs") {
          if (!lowerName.includes("elixir") && !lowerName.includes("juice") && !lowerName.includes("chai") && !lowerDesc.includes("drink")) return false;
        }
      }

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
  }, [activeItems, selectedCategory, selectedMetric, proteinRange, calorieRange]);

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
    toast.success(`Added ${dish.name} to meal`);
  };

  const isSheetOpen = isPreferencesOpen || selectedDish !== null;

  return (
    <div className="relative space-y-6 pb-28 text-foreground selection:bg-emerald-500 selection:text-white">
      {/* Ambient Moss & Warm Amber Backlights (Dark Harvest Edition) */}
      <div className="absolute -top-10 left-1/4 -translate-x-1/2 w-80 h-80 bg-[#2E7D32]/15 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-64 right-0 w-72 h-72 bg-[#ffb74d]/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Dev preview sample toggle (compiled out in prod) */}
      <HealthySampleToggle
        useSampleData={useSampleData}
        onToggle={(next) => setUseSampleData(next)}
      />

      {/* Screen Header Sub-Bar: Wellness Mode & Harvest Toggle Badge */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Link
              href="/menu"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 dark:text-[#81c784] hover:underline"
              aria-label="Back to canteen menu"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Menu</span>
            </Link>
            <span className="text-stone-500 text-xs">&bull;</span>
            <span className="font-script text-xs sm:text-[13px] text-[#ffb74d] italic">
              Moss &amp; Matcha Botanics
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground dark:text-[#ede7e1]">
            Healthy Mode
          </h1>
        </div>

        {/* Active HARVEST HEALTHY Toggle Badge */}
        <div className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-[#1b2e1a] border border-[#3b533a] shadow-[0_0_16px_rgba(76,175,80,0.3)] select-none">
          <span className="w-2 h-2 rounded-full bg-[#4CAF50] animate-pulse" />
          <span className="text-[10px] text-[#81c784] font-bold tracking-wider uppercase font-headline">
            HARVEST HEALTHY
          </span>
          <div className="w-5 h-5 rounded-full bg-[#2E7D32] flex items-center justify-center text-white shadow-sm ml-0.5">
            <Leaf className="h-3 w-3" />
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
          {/* =========================================================================
              SECTION 2: BOTANICAL HARVEST CATEGORIES CAROUSEL
              ========================================================================= */}
          <section className="flex flex-col gap-1.5 -mx-4 px-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-bold text-emerald-800 dark:text-[#81c784] uppercase tracking-wider font-headline">
                Botanical Harvest Categories
              </span>
              <span className="font-script text-[11px] text-amber-700 dark:text-[#ffb74d] italic">
                Season Pick
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              {BOTANICAL_CATEGORIES.map((cat) => {
                const isCatSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory((prev) => (prev === cat.id ? null : cat.id))}
                    className={`shrink-0 px-3.5 py-2 rounded-full font-headline text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                      isCatSelected
                        ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white shadow-[0_4px_14px_rgba(76,175,80,0.3)]"
                        : "bg-card dark:bg-[#1e291c] border border-border/80 dark:border-[#3b533a]/60 text-foreground dark:text-[#ede7e1] hover:text-[#81c784] dark:hover:border-[#4CAF50]/40"
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Editorial Nutrition Tip Banner */}
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
            className="group rounded-3xl border border-emerald-950/10 dark:border-[#3b533a]/60 bg-gradient-to-r from-emerald-600/10 via-teal-500/5 to-transparent dark:from-[#1e291c]/80 dark:to-[#181412] p-4 sm:p-5 shadow-xs hover:border-emerald-500/50 hover:shadow-md transition-all duration-300 cursor-pointer flex items-center justify-between gap-3 select-none"
            aria-label="Open protein and calorie preferences"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2E7D32] to-[#4CAF50] text-white shadow-sm group-hover:scale-105 transition-transform duration-300">
                <SlidersHorizontal className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs sm:text-sm font-bold text-foreground dark:text-[#ede7e1]">
                    Customise Daily Nutrition Targets
                  </h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-600/10 dark:bg-[#263725] text-emerald-800 dark:text-[#81c784] border border-emerald-500/20 dark:border-[#4CAF50]/30 hidden xs:inline-block">
                    Interactive
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-muted-foreground dark:text-[#c4bdb3] leading-snug">
                  Set target calories &amp; protein to generate instant smart dish matches
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-9 px-3.5 rounded-2xl border-emerald-500/30 dark:border-[#3b533a] text-emerald-800 dark:text-[#81c784] font-extrabold text-xs group-hover:bg-[#2E7D32] group-hover:text-white group-hover:border-[#2E7D32] transition-all pointer-events-none shadow-2xs"
            >
              <span>Set Goals</span>
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </div>

          {/* =========================================================================
              SECTION 3: TOP PROTEIN FUEL (FEATURED NUTRITION HARVEST SLIDER)
              ========================================================================= */}
          <TopProteinRow
            items={activeItems}
            onOpenDish={(dish) => setSelectedDish(dish)}
            onAddToCart={handleAddToCart}
          />

          {/* =========================================================================
              SECTION 4: HEALTHY CAMPUS PICKS (WITH STEPPER BUTTONS & DIETARY TAGS)
              ========================================================================= */}
          <section className="space-y-4 pt-1">
            <div className="flex items-baseline justify-between">
              <div className="space-y-0.5">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground dark:text-[#ede7e1] flex items-center gap-1.5 font-headline">
                  <span>Healthy Campus Picks</span>
                </h2>
                <p className="text-[11px] text-muted-foreground dark:text-[#c4bdb3] font-medium">
                  Verified campus dishes with complete macro breakdown
                </p>
              </div>

              <span className="font-script text-xs sm:text-[13px] text-amber-700 dark:text-[#ffb74d] italic">
                Nutritionist Vetted
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

            {/* Filtered Dishes List formatted according to Dark Harvest Edition */}
            {filteredDishes.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border/80 dark:border-[#3b533a]/60 bg-card/60 dark:bg-[#1e291c]/40 p-8 text-center space-y-3 shadow-2xs">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted dark:bg-[#2E7D32]/20 text-muted-foreground dark:text-[#81c784]">
                  <Leaf className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-foreground dark:text-[#ede7e1]">
                    No dishes match this nutrient filter
                  </p>
                  <p className="text-[11px] text-muted-foreground dark:text-[#c4bdb3]">
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
                      setSelectedCategory(null);
                    }}
                    className="h-8 text-xs font-bold rounded-xl"
                  >
                    Clear Filter
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {filteredDishes.map((dish) => {
                  const currentQty = getItemQuantity(dish.id);
                  return (
                    <div
                      key={dish.id}
                      className="rounded-2xl bg-card dark:bg-[#1e291c]/75 border border-border/80 dark:border-[#3b533a]/50 backdrop-blur-md p-3 sm:p-3.5 flex items-center gap-3 sm:gap-4 shadow-sm dark:shadow-md hover:bg-card/90 dark:hover:bg-[#1e291c]/95 transition-all select-none"
                    >
                      {/* Left: Thumbnail Image with Diet Chip */}
                      <div
                        onClick={() => setSelectedDish(dish)}
                        className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-xl overflow-hidden shrink-0 bg-muted dark:bg-[#141110] shadow-xs border border-border/60 dark:border-[#3b533a]/40 cursor-pointer group/img"
                      >
                        <MenuItemImage
                          src={dish.image_url}
                          alt={dish.name}
                          aspect="square"
                          sizes="88px"
                          className="h-full w-full object-cover group-hover/img:scale-105 transition-transform duration-300"
                          containerClassName="h-full w-full"
                        />
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-background/85 dark:bg-[#161311]/85 text-emerald-800 dark:text-[#81c784] text-[9px] uppercase font-bold tracking-wider border border-border/40 dark:border-white/10">
                          {dish.is_veg ? "Veg" : "Non-Veg"}
                        </span>
                      </div>

                      {/* Middle: Info Area */}
                      <div
                        className="flex flex-col flex-1 min-w-0 cursor-pointer"
                        onClick={() => setSelectedDish(dish)}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <h4 className="text-sm sm:text-base text-foreground dark:text-[#ede7e1] font-bold truncate">
                            {dish.name}
                          </h4>
                          <span className="text-sm sm:text-base font-extrabold text-[#2E7D32] dark:text-[#ffb74d] shrink-0 font-headline">
                            {formatPaise(dish.price_paise)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground dark:text-[#c4bdb3] truncate mt-0.5">
                          {dish.description || "Fresh chef-curated wholesome campus bowl."}
                        </p>

                        {/* Dietary and Macro Chips */}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {dish.protein_g != null && (
                            <span className="text-[9px] font-bold text-emerald-800 dark:text-[#81c784] bg-emerald-500/10 dark:bg-[#2E7D32]/30 border border-emerald-500/25 dark:border-[#4CAF50]/30 px-1.5 py-0.5 rounded">
                              {dish.protein_g}g Protein
                            </span>
                          )}
                          {dish.calories_kcal != null && (
                            <span className="text-[9px] font-bold text-muted-foreground dark:text-[#c4bdb3] bg-muted dark:bg-[#26201b] border border-border/40 dark:border-[#443e39] px-1.5 py-0.5 rounded">
                              {dish.calories_kcal} kcal
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDish(dish);
                            }}
                            className="text-[10px] font-bold text-emerald-700 dark:text-[#81c784] hover:underline ml-auto flex items-center gap-0.5 cursor-pointer py-0.5"
                          >
                            <span>Macros</span>
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Right: Interactive Stepper Control ([-] [qty] [+]) or Add button */}
                      <div className="shrink-0 flex items-center">
                        {currentQty > 0 ? (
                          <div className="flex items-center gap-1 bg-card dark:bg-[#161311] border border-border/80 dark:border-[#3b533a]/60 rounded-full p-1 shadow-xs">
                            <button
                              type="button"
                              aria-label={`Decrease ${dish.name} quantity`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (currentQty === 1) removeItem(dish.id);
                                else updateQuantity(dish.id, currentQty - 1);
                              }}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground dark:text-[#c4bdb3] hover:text-foreground dark:hover:text-white hover:bg-muted dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="text-xs font-bold text-foreground dark:text-[#ede7e1] w-4 text-center select-none font-headline">
                              {currentQty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${dish.name} quantity`}
                              disabled={currentQty >= MAX_ITEM_QUANTITY}
                              onClick={(e) => {
                                e.stopPropagation();
                                addItem(dish.id, 1);
                              }}
                              className="w-7 h-7 rounded-full bg-[#2E7D32] hover:bg-[#4CAF50] flex items-center justify-center text-white active:scale-95 transition-all cursor-pointer disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={!dish.is_available}
                            onClick={(e) => handleAddToCart(e, dish)}
                            className="h-8.5 px-3 rounded-full bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white font-bold text-xs shadow-sm hover:shadow-md active:scale-95 transition-all flex items-center gap-1 cursor-pointer disabled:opacity-40 font-headline uppercase"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* =========================================================================
              SECTION 5: 'CLEAN KITCHEN PROMISE' VERIFICATION BOX
              ========================================================================= */}
          <section className="rounded-2xl bg-gradient-to-br from-card via-card to-card dark:from-[#1c281a] dark:via-[#181d17] dark:to-[#161311] border border-border/80 dark:border-[#3b533a] p-4 sm:p-5 shadow-lg relative overflow-hidden flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 dark:bg-[#2E7D32]/30 border border-emerald-500/30 dark:border-[#4CAF50]/40 flex items-center justify-center text-[#4CAF50] dark:text-[#81c784]">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-[15px] text-foreground dark:text-[#ede7e1] font-bold tracking-tight">
                    Clean Kitchen Promise
                  </h4>
                  <span className="text-[10px] text-emerald-700 dark:text-[#81c784] tracking-wider uppercase font-bold">
                    Campus Lab Audited Daily
                  </span>
                </div>
              </div>
              <Sparkles className="h-5 w-5 text-emerald-500/60 dark:text-[#4CAF50]/60" />
            </div>
            <p className="text-xs text-muted-foreground dark:text-[#c4bdb3] leading-relaxed">
              Every dish prepared in our wellness kitchen follows stringent organic sourcing and cold-extraction principles.
            </p>
            {/* Verification Trust Badges */}
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/40 dark:border-[#3b533a]/30">
              <div className="flex flex-col items-center text-center p-2 rounded-xl bg-muted/30 dark:bg-[#141813] border border-border/60 dark:border-[#3b533a]/40">
                <span className="text-amber-500 dark:text-[#ffb74d] text-base mb-0.5">🚫</span>
                <span className="text-[10px] text-foreground dark:text-[#ede7e1] font-bold leading-tight">
                  Zero Palm Oil
                </span>
                <span className="text-[9px] text-muted-foreground dark:text-[#c4bdb3] mt-0.5">
                  Strictly Banned
                </span>
              </div>
              <div className="flex flex-col items-center text-center p-2 rounded-xl bg-muted/30 dark:bg-[#141813] border border-border/60 dark:border-[#3b533a]/40">
                <span className="text-emerald-500 dark:text-[#81c784] text-base mb-0.5">💧</span>
                <span className="text-[10px] text-foreground dark:text-[#ede7e1] font-bold leading-tight">
                  Cold-Pressed
                </span>
                <span className="text-[9px] text-muted-foreground dark:text-[#c4bdb3] mt-0.5">
                  Mustard &amp; Sesame
                </span>
              </div>
              <div className="flex flex-col items-center text-center p-2 rounded-xl bg-muted/30 dark:bg-[#141813] border border-border/60 dark:border-[#3b533a]/40">
                <span className="text-green-500 dark:text-[#4CAF50] text-base mb-0.5">🌱</span>
                <span className="text-[10px] text-foreground dark:text-[#ede7e1] font-bold leading-tight">
                  Local Sprouts
                </span>
                <span className="text-[9px] text-muted-foreground dark:text-[#c4bdb3] mt-0.5">
                  Fresh 24h Batches
                </span>
              </div>
            </div>
          </section>

          {/* =========================================================================
              SECTION 6: DIETITIAN WISDOM QUOTE BLOCK
              ========================================================================= */}
          <section className="rounded-2xl bg-card/60 dark:bg-[#1e291c]/50 border border-border/60 dark:border-[#3b533a]/40 p-3.5 shadow-sm relative overflow-hidden flex items-center gap-3">
            <div className="w-11 h-11 rounded-full overflow-hidden shrink-0 border border-emerald-500/40 dark:border-[#4CAF50]/40 shadow-sm bg-muted">
              {/* Using standard img for external CDN portrait */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDRaeuRnLULie8kKwtFQbu7AzdH4ktXjbP8luItLXJgkL1JUZ1VKpeakc9JDKLpeYHO3R7DpYyud6_NUd7jOx94ajn7l5i3bFOzYq5Yil0cbt6_6UqLD1Df-zCHCEUeqGwgP5SB9Nj4SNOP0gl0_rhslQ59-V02v8_p6lAagkBXcL0GNj3mYmwvR5s-gcCtyuZ8eex4La-p0d5nLIi9BiT0kx5M2Xem0aGagBOxiRHH"
                alt="Dr. Ananya Ray, Ph.D. • Lead Campus Nutritionist"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <p className="font-script text-xs sm:text-[13px] text-foreground dark:text-[#ede7e1] italic leading-snug">
                &ldquo;Cold-pressed mustard keeps good lipids intact while steamed millets fuel steady lecture focus.&rdquo;
              </p>
              <span className="text-[10px] text-emerald-700 dark:text-[#81c784] font-bold mt-0.5">
                Dr. Ananya Ray, Ph.D. &bull; Lead Campus Dietitian
              </span>
            </div>
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

      {/* =========================================================================
          SECTION 7: PERSISTENT DOCKED HEALTHY CART TRAY (MATCHA ACCENT)
          ========================================================================= */}
      {totalItemCount > 0 && !isSheetOpen && (
        <aside
          role="region"
          aria-label="Healthy harvest tray"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-40 mx-auto max-w-md pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <Link
            href="/cart"
            aria-label={`${totalItemCount} harvest items in cart, total ${formatPaise(estimatedTotal)}`}
            className="w-full rounded-full bg-[#1b2b1a]/95 border border-[#3b533a] backdrop-blur-xl p-2 pl-4 pr-2 flex items-center justify-between shadow-[0_8px_32px_rgba(46,125,50,0.35)] text-white hover:border-[#4CAF50]/60 transition-all select-none group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-[#2E7D32] flex items-center justify-center shrink-0 shadow-md text-white group-hover:scale-105 transition-transform">
                <Leaf className="h-4 w-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold text-[#81c784] uppercase tracking-wide truncate font-headline">
                  {totalItemCount} {totalItemCount === 1 ? "HARVEST ITEM" : "HARVEST ITEMS"}
                </span>
                <span className="text-sm font-extrabold text-[#ede7e1] leading-none mt-0.5 font-headline">
                  {formatPaise(estimatedTotal)}{" "}
                  <span className="text-[10px] text-stone-400 font-normal font-sans">subtotal</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white text-xs font-bold shadow-[0_4px_16px_rgba(76,175,80,0.4)] group-hover:shadow-[0_4px_20px_rgba(76,175,80,0.6)] active:scale-95 transition-all shrink-0">
              <span>View Harvest Tray</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        </aside>
      )}

      {/* Standard Fallback CartShortcut if tray not visible */}
      {totalItemCount === 0 && (
        <CartShortcut
          menuItems={activeItems.map((i) => ({ id: i.id, price_paise: i.price_paise }))}
          isDetailSheetOpen={isSheetOpen}
        />
      )}
    </div>
  );
}
