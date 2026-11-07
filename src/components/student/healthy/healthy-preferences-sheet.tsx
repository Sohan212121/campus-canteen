"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Clock, Search } from "lucide-react";
import { toast } from "sonner";

import { VegIndicator } from "@/components/student/veg-indicator";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import {
  suggestHealthyDishes,
  DEFAULT_HEALTHY_PREFERENCES,
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

  const [tolerance, setTolerance] = useState<number>(0.2);
  const [isCalculating, setIsCalculating] = useState(false);
  const [caloriePulse, setCaloriePulse] = useState(false);
  const [proteinPulse, setProteinPulse] = useState(false);

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

  // Derive suggested dishes purely via useMemo to avoid cascading renders
  const suggestions = useMemo(() => {
    if (!items || items.length === 0) return [];
    return suggestHealthyDishes(items, {
      targetCalories,
      targetProtein,
      tolerance,
    });
  }, [items, targetCalories, targetProtein, tolerance]);

  const handleComputeSuggestions = (customTolerance = 0.2) => {
    // Save to localStorage
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ targetCalories, targetProtein })
      );
    } catch {
      // Ignore storage errors
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(15);
      } catch {}
    }

    setIsCalculating(true);
    setTolerance(customTolerance);
    setTimeout(() => {
      setIsCalculating(false);
    }, 350);
  };

  const handleCalorieChange = (val: number) => {
    setTargetCalories(val);
    setCaloriePulse(true);
    setTimeout(() => setCaloriePulse(false), 280);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(6);
      } catch {}
    }
  };

  const handleProteinChange = (val: number) => {
    setTargetProtein(val);
    setProteinPulse(true);
    setTimeout(() => setProteinPulse(false), 280);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(6);
      } catch {}
    }
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

  // Track percentage fills for sliders
  const calPercentage = Math.round(((targetCalories - 200) / (800 - 200)) * 100);
  const protPercentage = Math.round(((targetProtein - 10) / (60 - 10)) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs transition-opacity duration-200 sm:items-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-sheet-title"
    >
      <div
        className="w-full max-w-[430px] bg-gradient-to-b from-[#F2FBF6] via-[#EEF8F3] to-[#E8F5EE] dark:from-[#0c1f15] dark:via-[#08170f] dark:to-[#050f0a] rounded-t-[36px] sm:rounded-[40px] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col relative border-t sm:border border-emerald-500/20 animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Top Glow Line */}
        <div className="absolute top-0 inset-x-8 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent pointer-events-none" />

        {/* Ambient Soft Blur Accents */}
        <div className="absolute -top-24 -left-20 w-80 h-80 bg-emerald-300/30 dark:bg-emerald-900/20 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute top-96 -right-24 w-80 h-80 bg-teal-200/35 dark:bg-teal-900/20 rounded-full blur-[90px] pointer-events-none" />

        {/* Mobile Drag Indicator */}
        <div className="pt-3 pb-1 flex justify-center items-center sm:hidden shrink-0">
          <div className="w-12 h-1 bg-emerald-800/20 dark:bg-emerald-200/20 rounded-full" />
        </div>

        {/* Scrollable Content Container */}
        <div className="flex-1 overflow-y-auto custom-scroll px-4 pb-6 pt-1 sm:pt-4 relative z-10 space-y-4">
          {/* =========================================================================
              TELEMETRY PREFERENCES CARD
              ========================================================================= */}
          <section className="bg-white dark:bg-stone-900 rounded-3xl p-5 sm:p-6 border border-emerald-100/90 dark:border-emerald-900/50 shadow-xl shadow-emerald-900/5 relative overflow-hidden transition-all">
            {/* Ambient Card Top Accent Line */}
            <div className="absolute top-0 inset-x-8 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent pointer-events-none" />

            {/* Modal Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center space-x-3">
                {/* Equalizer Icon Squircle */}
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/25 shrink-0">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 21v-7" />
                    <path d="M4 10V3" />
                    <path d="M12 21v-9" />
                    <path d="M12 8V3" />
                    <path d="M20 21v-5" />
                    <path d="M20 12V3" />
                    <circle cx="4" cy="12" fill="currentColor" r="2" />
                    <circle cx="12" cy="10" fill="currentColor" r="2" />
                    <circle cx="20" cy="15" fill="currentColor" r="2" />
                  </svg>
                </div>
                <div>
                  <h1
                    id="preferences-sheet-title"
                    className="text-base font-bold text-[#132A1E] dark:text-emerald-50 tracking-tight leading-tight"
                  >
                    Tell Us Your Preferences
                  </h1>
                  <p className="text-xs text-[#4B6354] dark:text-emerald-300/80 font-medium leading-relaxed mt-0.5">
                    Set target calories and protein to receive matching menu items
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preferences"
                className="w-8 h-8 flex items-center justify-center bg-[#F4FAF6] dark:bg-stone-800 hover:bg-[#e8f5ed] dark:hover:bg-stone-700 border border-[#E2EBE5] dark:border-stone-700 rounded-full text-[#4B6354] dark:text-emerald-300 hover:text-[#132A1E] dark:hover:text-white transition-colors touch-spring shadow-xs shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5 stroke-[2.4]" />
              </button>
            </div>

            {/* Interactive Sliders Panel */}
            <div className="bg-gradient-to-b from-[#F7FCF9] to-[#F1F9F4] dark:from-stone-950/70 dark:to-stone-950/40 rounded-2xl p-4 border border-emerald-100/80 dark:border-emerald-900/40 space-y-4">
              {/* Target Calories Slider */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <label
                      htmlFor="calorieRange"
                      className="text-xs font-bold text-[#132A1E] dark:text-emerald-100 uppercase tracking-wider cursor-pointer"
                    >
                      Target Calories
                    </label>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <div
                    className={`bg-white/95 dark:bg-stone-900/95 text-emerald-900 dark:text-emerald-100 font-bold text-sm px-3 py-1 rounded-full border border-emerald-300/80 dark:border-emerald-700/80 shadow-[0_2px_8px_rgba(5,150,105,0.14)] flex items-center gap-1.5 ring-1 ring-emerald-500/20 transition-all origin-right ${
                      caloriePulse ? "badge-haptic-pulse" : ""
                    }`}
                  >
                    <span className="font-mono font-extrabold text-base text-[#065F46] dark:text-emerald-300 tracking-tight">
                      {targetCalories}
                    </span>
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-full">
                      kcal
                    </span>
                  </div>
                </div>

                <div className="relative py-1.5 px-0.5">
                  <div className="relative flex items-center">
                    <input
                      id="calorieRange"
                      type="range"
                      min={200}
                      max={800}
                      step={10}
                      value={targetCalories}
                      onChange={(e) => handleCalorieChange(parseInt(e.target.value, 10))}
                      aria-label="Target Calories"
                      aria-valuetext={`${targetCalories} kilocalories`}
                      className="w-full z-10 relative cursor-pointer tactile-slider"
                      style={{
                        background: `linear-gradient(to right, #059669 0%, #10b981 ${calPercentage}%, #E2EDE6 ${calPercentage}%, #E2EDE6 100%)`,
                        borderRadius: "9999px",
                      }}
                    />
                    {/* Milestone tick pips */}
                    <div className="absolute inset-x-2 pointer-events-none flex justify-between px-1 z-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-700/60 transition-transform" />
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-transform ${
                          targetCalories >= 500
                            ? "bg-emerald-600/60"
                            : "bg-slate-300 dark:bg-stone-700"
                        }`}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-transform ${
                          targetCalories >= 790
                            ? "bg-emerald-600/60"
                            : "bg-slate-300 dark:bg-stone-700"
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-[#64748B] dark:text-stone-400 mt-1 font-semibold px-1">
                    <span className="hover:text-emerald-700 transition-colors">200 kcal</span>
                    <span className="text-[#4B6354] dark:text-emerald-300 font-bold">500 kcal</span>
                    <span className="hover:text-emerald-700 transition-colors">800 kcal</span>
                  </div>
                </div>
              </div>

              {/* Target Protein Slider */}
              <div className="space-y-2.5 pt-3.5 border-t border-[#E2EBE5] dark:border-stone-800">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <label
                      htmlFor="proteinRange"
                      className="text-xs font-bold text-[#132A1E] dark:text-emerald-100 uppercase tracking-wider cursor-pointer"
                    >
                      Target Protein
                    </label>
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                  </div>
                  <div
                    className={`bg-white/95 dark:bg-stone-900/95 text-emerald-900 dark:text-emerald-100 font-bold text-sm px-3 py-1 rounded-full border border-emerald-300/80 dark:border-emerald-700/80 shadow-[0_2px_8px_rgba(5,150,105,0.14)] flex items-center gap-1.5 ring-1 ring-emerald-500/20 transition-all origin-right ${
                      proteinPulse ? "badge-haptic-pulse" : ""
                    }`}
                  >
                    <span className="font-mono font-extrabold text-base text-[#065F46] dark:text-emerald-300 tracking-tight">
                      {targetProtein}
                    </span>
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-full">
                      g
                    </span>
                  </div>
                </div>

                <div className="relative py-1.5 px-0.5">
                  <div className="relative flex items-center">
                    <input
                      id="proteinRange"
                      type="range"
                      min={10}
                      max={60}
                      step={1}
                      value={targetProtein}
                      onChange={(e) => handleProteinChange(parseInt(e.target.value, 10))}
                      aria-label="Target Protein"
                      aria-valuetext={`${targetProtein} grams`}
                      className="w-full z-10 relative cursor-pointer tactile-slider"
                      style={{
                        background: `linear-gradient(to right, #059669 0%, #10b981 ${protPercentage}%, #E2EDE6 ${protPercentage}%, #E2EDE6 100%)`,
                        borderRadius: "9999px",
                      }}
                    />
                    {/* Milestone tick pips */}
                    <div className="absolute inset-x-2 pointer-events-none flex justify-between px-1 z-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-700/60 transition-transform" />
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-transform ${
                          targetProtein >= 35
                            ? "bg-emerald-600/60"
                            : "bg-slate-300 dark:bg-stone-700"
                        }`}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full transition-transform ${
                          targetProtein >= 59
                            ? "bg-emerald-600/60"
                            : "bg-slate-300 dark:bg-stone-700"
                        }`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-[#64748B] dark:text-stone-400 mt-1 font-semibold px-1">
                    <span className="hover:text-emerald-700 transition-colors">10 g</span>
                    <span className="text-[#4B6354] dark:text-emerald-300 font-bold">35 g</span>
                    <span className="hover:text-emerald-700 transition-colors">60 g</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Show Matches Primary CTA Button */}
            <button
              type="button"
              onClick={() => handleComputeSuggestions()}
              className="w-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-600/30 ring-1 ring-white/30 rounded-2xl py-3.5 px-6 font-bold text-white text-base tracking-wide flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all touch-spring mt-4 group cursor-pointer"
            >
              <div className="bg-white/20 p-1.5 rounded-full flex items-center justify-center shadow-xs">
                <Search className="w-4 h-4 text-white stroke-[2.8] group-hover:rotate-12 transition-transform" />
              </div>
              <span>Show Matches</span>
            </button>
          </section>

          {/* =========================================================================
              SUGGESTED DISHES RESULTS SECTION
              ========================================================================= */}
          <div className="space-y-3 pt-1">
            <div className="flex justify-between items-center mb-1 px-1">
              <div className="flex items-center space-x-2">
                <div className="w-1.5 h-3.5 bg-emerald-600 rounded-full" />
                <h2 className="text-xs font-extrabold tracking-wider text-[#132A1E] dark:text-emerald-50 uppercase">
                  SUGGESTED DISHES ({suggestions.length})
                </h2>
              </div>
              <span className="text-xs text-[#64748B] dark:text-stone-400 font-mono font-medium">
                Sorted by best fit
              </span>
            </div>

            {/* Shimmer Skeleton during computation */}
            {isCalculating ? (
              <div
                className="space-y-3 mt-1"
                data-purpose="unique-organic-shimmer-skeletons"
              >
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="bg-white dark:bg-stone-900 rounded-2xl p-4 border border-[#E2EBE5] dark:border-stone-800 shadow-sm relative overflow-hidden flex items-center gap-4"
                  >
                    <div className="w-20 h-20 rounded-2xl shimmer-light dark:bg-stone-800 shrink-0 border border-[#E2EBE5] dark:border-stone-800" />
                    <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.5 space-y-2">
                      <div className="flex items-center space-x-2">
                        <div className="w-3.5 h-3.5 rounded shimmer-light dark:bg-stone-800" />
                        <div className="w-20 h-4 rounded-full shimmer-light dark:bg-stone-800" />
                      </div>
                      <div className="w-3/5 h-4 rounded shimmer-light dark:bg-stone-800" />
                      <div className="w-4/5 h-3 rounded shimmer-light dark:bg-stone-800 opacity-75" />
                      <div className="flex justify-between items-end pt-1">
                        <div className="w-10 h-3 rounded shimmer-light dark:bg-stone-800" />
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-4 rounded shimmer-light dark:bg-stone-800" />
                          <div className="w-16 h-8 rounded-full shimmer-light dark:bg-stone-800" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : suggestions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-300/80 dark:border-emerald-800/80 bg-white/70 dark:bg-stone-900/60 p-6 text-center space-y-3">
                <p className="text-xs text-[#4B6354] dark:text-stone-300 leading-relaxed font-medium">
                  No active dishes currently match {targetCalories} kcal and {targetProtein}g protein within the target range.
                </p>
                <button
                  type="button"
                  onClick={() => handleComputeSuggestions(0.35)}
                  className="min-h-[40px] px-4 py-2 text-xs font-bold rounded-xl border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer"
                >
                  Widen Range to ±35%
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map(({ item: dish, isCloseMatch, matchReason }) => {
                  const isOutOfStock =
                    !dish.is_active ||
                    !dish.is_available ||
                    (dish.stock !== null && dish.stock <= 0);

                  return (
                    <article
                      key={dish.id}
                      onClick={() => onOpenDishDetail(dish)}
                      className="bg-white dark:bg-stone-900 rounded-2xl p-4 border border-emerald-100/80 dark:border-emerald-900/50 shadow-md shadow-emerald-950/5 flex items-center gap-4 hover:shadow-lg transition-all group cursor-pointer"
                    >
                      {/* Dish Photo Thumbnail */}
                      <div className="w-20 h-20 rounded-2xl object-cover shadow-xs border border-emerald-100 dark:border-emerald-900/60 shrink-0 overflow-hidden relative bg-emerald-50 dark:bg-stone-800 flex items-center justify-center">
                        {dish.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={dish.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            src={dish.image_url}
                          />
                        ) : (
                          <span className="text-2xl select-none">🥗</span>
                        )}
                      </div>

                      {/* Dish Metadata */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.5">
                        <div>
                          <div className="flex items-center space-x-1.5 mb-1 flex-wrap gap-y-1">
                            <VegIndicator isVeg={dish.is_veg} />
                            <span className="bg-emerald-100/80 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-medium text-xs px-2.5 py-0.5 rounded-full">
                              {isCloseMatch ? "Close Match" : "Best Fit"}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-[#132A1E] dark:text-emerald-50 tracking-tight truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            {dish.name}
                          </h3>
                          <p className="text-xs text-[#4B6354] dark:text-stone-300 font-normal leading-tight mt-0.5">
                            {matchReason || `${dish.protein_g}g protein, ${dish.calories_kcal} kcal`}
                          </p>
                        </div>

                        <div className="flex items-center justify-between mt-2 pt-0.5">
                          <div className="flex items-center space-x-1.5 text-xs text-[#64748B] dark:text-stone-400 font-mono font-medium">
                            <Clock className="w-3.5 h-3.5 text-[#64748B] dark:text-stone-400 stroke-[2]" />
                            <span>~{dish.prep_minutes || 5}m</span>
                          </div>

                          <div
                            className="flex items-center space-x-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-base font-mono font-extrabold text-[#132A1E] dark:text-emerald-100">
                              {formatPaise(dish.price_paise)}
                            </span>

                            <button
                              type="button"
                              disabled={isOutOfStock}
                              onClick={() => handleAddToCart(dish)}
                              className="rounded-full px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-md shadow-emerald-600/25 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer touch-spring"
                            >
                              <Plus className="w-3.5 h-3.5 stroke-[2.8] text-white" />
                              <span>Add</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
