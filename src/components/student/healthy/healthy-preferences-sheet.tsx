"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, SlidersHorizontal, Plus, Star, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import {
  suggestHealthyDishes,
  DEFAULT_HEALTHY_PREFERENCES,
  type HealthySuggestion,
} from "@/lib/healthy-suggestions";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

const STORAGE_KEY = "campus-healthy-preferences";

interface HealthyPreferencesSheetProps {
  items: MenuItemData[];
  isOpen: boolean;
  onClose: () => void;
  onOpenDishDetail: (item: MenuItemData) => void;
}

export function HealthyPreferencesSheet({
  items,
  isOpen,
  onClose,
  onOpenDishDetail,
}: HealthyPreferencesSheetProps) {
  const router = useRouter();
  const [targetCalories, setTargetCalories] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEALTHY_PREFERENCES.targetCalories;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.targetCalories === "number") return parsed.targetCalories;
      }
    } catch {}
    return DEFAULT_HEALTHY_PREFERENCES.targetCalories;
  });

  const [targetProtein, setTargetProtein] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEALTHY_PREFERENCES.targetProtein;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.targetProtein === "number") return parsed.targetProtein;
      }
    } catch {}
    return DEFAULT_HEALTHY_PREFERENCES.targetProtein;
  });

  const [suggestions, setSuggestions] = useState<HealthySuggestion[] | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const getItemQuantity = useCartStore((s) => s.getItemQuantity);

  // Prevent background scroll when sheet is open
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleComputeSuggestions = (customTolerance = 0.20) => {
    // Save to localStorage
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ targetCalories, targetProtein })
      );
    } catch {
      // Ignore storage errors
    }

    const res = suggestHealthyDishes(items, {
      targetCalories,
      targetProtein,
      tolerance: customTolerance,
    });
    setSuggestions(res);
  };

  const handleAddToCart = (dish: MenuItemData) => {
    const isOutOfStock =
      !dish.is_active ||
      !dish.is_available ||
      (dish.stock !== null && dish.stock <= 0);

    if (isOutOfStock) {
      toast.error(`${dish.name} is currently out of stock`);
      return;
    }

    const currentQty = getItemQuantity(dish.id);
    const effectiveMax = Math.min(
      MAX_ITEM_QUANTITY,
      dish.stock !== null ? Math.max(1, dish.stock) : MAX_ITEM_QUANTITY
    );

    if (currentQty >= effectiveMax) {
      toast.error(`Maximum quantity (${effectiveMax}) reached`);
      return;
    }

    addItem(dish.id, 1);
    toast.success(`Added ${dish.name} to cart`, {
      id: "cart-add-feedback",
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs transition-opacity duration-200 sm:items-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-sheet-title"
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border border-emerald-500/30 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-2xs">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="preferences-sheet-title"
                className="text-base sm:text-lg font-black tracking-tight text-foreground"
              >
                Tell Us Your Preferences
              </h2>
              <p className="text-[11px] text-muted-foreground font-semibold">
                Set target calories and protein to receive matching menu items
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            aria-label="Close preferences sheet"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6">
          {/* Sliders Area */}
          <div className="space-y-5 rounded-2xl bg-muted/30 p-4 border border-border/60">
            {/* Slider 1: Calories (200 - 800 kcal, step 50) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-foreground">Target Calories</span>
                <span className="text-emerald-700 dark:text-emerald-300 font-extrabold text-sm font-mono">
                  {targetCalories} kcal
                </span>
              </div>

              <div className="relative py-2">
                <input
                  type="range"
                  min="200"
                  max="800"
                  step="50"
                  value={targetCalories}
                  aria-valuetext={`${targetCalories} kilocalories`}
                  aria-label="Target Calories Slider"
                  onChange={(e) => setTargetCalories(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-600 cursor-pointer h-2 bg-muted-foreground/20 rounded-lg touch-none"
                  style={{ minHeight: "44px" }}
                />
              </div>

              <div className="flex justify-between text-[10px] text-muted-foreground font-semibold">
                <span>200 kcal</span>
                <span>500 kcal</span>
                <span>800 kcal</span>
              </div>
            </div>

            {/* Slider 2: Protein (10 - 60 g, step 5) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-foreground">Target Protein</span>
                <span className="text-emerald-700 dark:text-emerald-300 font-extrabold text-sm font-mono">
                  {targetProtein} g
                </span>
              </div>

              <div className="relative py-2">
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="5"
                  value={targetProtein}
                  aria-valuetext={`${targetProtein} grams protein`}
                  aria-label="Target Protein Slider"
                  onChange={(e) => setTargetProtein(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-600 cursor-pointer h-2 bg-muted-foreground/20 rounded-lg touch-none"
                  style={{ minHeight: "44px" }}
                />
              </div>

              <div className="flex justify-between text-[10px] text-muted-foreground font-semibold">
                <span>10 g</span>
                <span>35 g</span>
                <span>60 g</span>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => handleComputeSuggestions()}
              className="w-full min-h-[44px] rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs active:scale-95 transition-all"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              <span>Show Matches</span>
            </Button>
          </div>

          {/* Results Area */}
          {suggestions !== null && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Suggested Dishes ({suggestions.length})
                </h3>
                <span className="text-[11px] text-muted-foreground font-semibold">
                  Sorted by best fit
                </span>
              </div>

              {suggestions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 p-6 text-center space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No active dishes currently match {targetCalories} kcal and {targetProtein}g protein within the tolerance range.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleComputeSuggestions(0.35)}
                    className="min-h-[40px] text-xs font-bold border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                  >
                    Widen Range to ±35%
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {suggestions.map(({ item: dish, isCloseMatch, matchReason }) => {
                    const isOutOfStock =
                      !dish.is_active ||
                      !dish.is_available ||
                      (dish.stock !== null && dish.stock <= 0);

                    return (
                      <div
                        key={dish.id}
                        className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs hover:border-emerald-500/30 transition-all flex items-start justify-between gap-3"
                      >
                        <div
                          className="space-y-1 min-w-0 flex-1 cursor-pointer"
                          onClick={() => onOpenDishDetail(dish)}
                        >
                          <div className="flex items-center gap-1.5">
                            <VegIndicator isVeg={dish.is_veg} />
                            {isCloseMatch && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                                Close Match
                              </span>
                            )}
                          </div>

                          <h4 className="text-xs sm:text-sm font-bold text-foreground truncate hover:text-emerald-600 transition-colors">
                            {dish.name}
                          </h4>

                          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            {matchReason}
                          </p>

                          <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground font-semibold pt-0.5">
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              <span>~{dish.prep_minutes}m</span>
                            </span>
                            {dish.rating_avg != null && dish.rating_avg > 0 && (
                              <span className="flex items-center gap-0.5 text-amber-600">
                                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                <span>{dish.rating_avg.toFixed(1)}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-xs sm:text-sm font-extrabold text-foreground">
                            {formatPaise(dish.price_paise)}
                          </span>

                          <Button
                            type="button"
                            size="sm"
                            disabled={isOutOfStock}
                            onClick={() => handleAddToCart(dish)}
                            className="min-h-[36px] h-8 px-3 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            <span>Add</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
