"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Plus, Heart, AlertCircle, Info, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VegIndicator } from "@/components/student/veg-indicator";
import { FavoriteButton } from "@/components/student/favorite-button";
import { IngredientsPanel } from "@/components/student/ingredients-panel";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import {
  calculateMacroCalorieShares,
  calculateDonutArcs,
  generateNutritionalInsights,
} from "@/lib/healthy-macros";
import { calculateHealthyScore } from "@/lib/healthy-score";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyNutritionSheetProps {
  item: MenuItemData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function HealthyNutritionSheet({
  item,
  isOpen,
  onClose,
}: HealthyNutritionSheetProps) {
  const router = useRouter();
  const prefersReducedMotion = usePrefersReducedMotion();

  const addItem = useCartStore((s) => s.addItem);
  const getItemQuantity = useCartStore((s) => (item ? s.getItemQuantity(item.id) : 0));

  // Prevent background scrolling
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

  if (!isOpen || !item) return null;

  const isOutOfStock =
    !item.is_active ||
    !item.is_available ||
    (item.stock !== null && item.stock <= 0);

  const currentQty = getItemQuantity;
  const effectiveMax = Math.min(
    MAX_ITEM_QUANTITY,
    item.stock !== null ? Math.max(1, item.stock) : MAX_ITEM_QUANTITY
  );

  const handleAddToCart = () => {
    if (isOutOfStock) {
      toast.error(`${item.name} is currently out of stock`);
      return;
    }

    if (currentQty >= effectiveMax) {
      toast.error(`Maximum quantity (${effectiveMax}) reached`);
      return;
    }

    addItem(item.id, 1);
    toast.success(`Added ${item.name} to cart`, {
      id: "cart-add-feedback",
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
  };

  // Macro shares
  const macroShares = calculateMacroCalorieShares(
    item.protein_g,
    item.carbs_g,
    item.fat_g
  );

  const arcs = calculateDonutArcs(
    macroShares.proteinPercent,
    macroShares.carbsPercent,
    macroShares.fatPercent,
    38
  );

  // Healthy Score
  const scoreResult = calculateHealthyScore({
    calories_kcal: item.calories_kcal,
    protein_g: item.protein_g,
    fat_g: item.fat_g,
    carbs_g: item.carbs_g,
    fibre_g: item.fibre_g,
    sugar_g: item.sugar_g,
    sat_fat_g: item.sat_fat_g,
  });

  // Insights
  const insights = generateNutritionalInsights(item);

  const hasFullMacros =
    item.protein_g != null && item.carbs_g != null && item.fat_g != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs transition-opacity duration-200 sm:items-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nutrition-sheet-title"
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border border-emerald-500/30 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
            <VegIndicator isVeg={item.is_veg} />
            <h2
              id="nutrition-sheet-title"
              className="text-base sm:text-lg font-black tracking-tight text-foreground truncate"
            >
              {item.name}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <FavoriteButton item={item} size="md" variant="floating" />
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              aria-label="Close nutrition card"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Top Row: Price, Prep, Healthy Score Badge */}
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-muted/30 border border-border/60">
            <div>
              <span className="text-lg font-black text-foreground">
                {formatPaise(item.price_paise)}
              </span>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-semibold">
                <Clock className="h-3 w-3" />
                <span>~{item.prep_minutes}m prep</span>
              </div>
            </div>

            {scoreResult ? (
              <Link
                href="/healthy/score"
                onClick={onClose}
                className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer"
                title="View Healthy Score breakdown"
              >
                <Heart className="h-3.5 w-3.5 fill-emerald-600 text-emerald-600 dark:fill-emerald-400 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                <div className="flex flex-col text-left">
                  <span className="text-xs font-black leading-none">
                    {scoreResult.score}/100
                  </span>
                  <span className="text-[9px] uppercase font-bold tracking-wider opacity-80 leading-tight">
                    {scoreResult.band} Score
                  </span>
                </div>
              </Link>
            ) : (
              <span className="text-[11px] font-semibold text-muted-foreground px-2 py-1 rounded-lg bg-muted border border-border/50">
                Score not available
              </span>
            )}
          </div>

          {/* Calorie Donut Pie Chart & Legend */}
          <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-bold text-foreground">
                Macronutrient Calorie Shares
              </span>
              {item.calories_kcal != null && (
                <span className="text-xs font-mono font-extrabold text-foreground">
                  {item.calories_kcal} kcal
                </span>
              )}
            </div>

            {hasFullMacros && macroShares.totalMacroCalories > 0 ? (
              <div className="flex flex-col items-center gap-4">
                {/* SVG Donut Chart with accessible text description */}
                <div
                  className="relative inline-flex items-center justify-center w-28 h-28"
                  role="img"
                  aria-label={`Macronutrient Calorie Breakdown: ${macroShares.proteinPercent}% Protein, ${macroShares.carbsPercent}% Carbohydrates, ${macroShares.fatPercent}% Healthy Fats`}
                >
                  <svg
                    viewBox="0 0 100 100"
                    className="w-full h-full -rotate-90 transform will-change-transform"
                  >
                    {/* Background Track */}
                    <circle
                      cx="50"
                      cy="50"
                      r={arcs.radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={13}
                      className="text-muted/40"
                    />

                    {/* Protein Arc (Emerald #10b981) */}
                    {macroShares.proteinPercent > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={arcs.radius}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth={13}
                        strokeDasharray={`${arcs.proteinArc} ${arcs.circumference}`}
                        strokeDashoffset={arcs.proteinOffset}
                        strokeLinecap="round"
                        className={
                          prefersReducedMotion
                            ? ""
                            : "transition-all duration-700 ease-out"
                        }
                      />
                    )}

                    {/* Carbs Arc (Amber #f59e0b) */}
                    {macroShares.carbsPercent > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={arcs.radius}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={13}
                        strokeDasharray={`${arcs.carbsArc} ${arcs.circumference}`}
                        strokeDashoffset={arcs.carbsOffset}
                        strokeLinecap="round"
                        className={
                          prefersReducedMotion
                            ? ""
                            : "transition-all duration-700 ease-out"
                        }
                      />
                    )}

                    {/* Fat Arc (Sky Blue #0284c7) */}
                    {macroShares.fatPercent > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={arcs.radius}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth={13}
                        strokeDasharray={`${arcs.fatArc} ${arcs.circumference}`}
                        strokeDashoffset={arcs.fatOffset}
                        strokeLinecap="round"
                        className={
                          prefersReducedMotion
                            ? ""
                            : "transition-all duration-700 ease-out"
                        }
                      />
                    )}
                  </svg>

                  {/* Centre Calories */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
                    <span className="text-base font-black tracking-tight leading-none text-foreground">
                      {item.calories_kcal ?? macroShares.totalMacroCalories}
                    </span>
                    <span className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mt-0.5">
                      kcal
                    </span>
                  </div>
                </div>

                {/* Visible Legend (Never relying on color alone) */}
                <div className="grid grid-cols-3 gap-2 w-full text-center text-xs">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2 flex flex-col items-center">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                      <span>Protein</span>
                    </div>
                    <span className="text-xs font-black text-foreground mt-0.5">
                      {item.protein_g}g
                    </span>
                    <span className="text-[9px] text-muted-foreground font-semibold">
                      {macroShares.proteinPercent}% cals
                    </span>
                  </div>

                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2 flex flex-col items-center">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase">
                      <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
                      <span>Carbs</span>
                    </div>
                    <span className="text-xs font-black text-foreground mt-0.5">
                      {item.carbs_g}g
                    </span>
                    <span className="text-[9px] text-muted-foreground font-semibold">
                      {macroShares.carbsPercent}% cals
                    </span>
                  </div>

                  <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-2 flex flex-col items-center">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-sky-800 dark:text-sky-300 uppercase">
                      <span className="h-2 w-2 rounded-full bg-sky-500 inline-block" />
                      <span>Fat</span>
                    </div>
                    <span className="text-xs font-black text-foreground mt-0.5">
                      {item.fat_g}g
                    </span>
                    <span className="text-[9px] text-muted-foreground font-semibold">
                      {macroShares.fatPercent}% cals
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Macronutrient breakdown is not yet available for this item.
              </p>
            )}
          </div>

          {/* Row of Detailed Stat Tiles */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Nutrition per Serving
            </span>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl border border-border/60 bg-card text-center">
                <span className="text-[10px] text-muted-foreground font-semibold block">
                  Dietary Fibre
                </span>
                <span className="text-xs font-extrabold text-foreground block">
                  {item.fibre_g != null ? `${item.fibre_g}g` : "—"}
                </span>
              </div>
              <div className="p-2.5 rounded-xl border border-border/60 bg-card text-center">
                <span className="text-[10px] text-muted-foreground font-semibold block">
                  Sugar
                </span>
                <span className="text-xs font-extrabold text-foreground block">
                  {item.sugar_g != null ? `${item.sugar_g}g` : "—"}
                </span>
              </div>
              <div className="p-2.5 rounded-xl border border-border/60 bg-card text-center">
                <span className="text-[10px] text-muted-foreground font-semibold block">
                  Saturated Fat
                </span>
                <span className="text-xs font-extrabold text-foreground block">
                  {item.sat_fat_g != null ? `${item.sat_fat_g}g` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Key Minerals Chips */}
          {item.key_minerals && item.key_minerals.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Key Minerals & Micronutrients
              </span>
              <div className="flex flex-wrap gap-1.5">
                {item.key_minerals.map((min, idx) => (
                  <Badge
                    key={`${min}-${idx}`}
                    variant="outline"
                    className="text-xs font-semibold bg-emerald-500/5 border-emerald-500/30 text-emerald-800 dark:text-emerald-300 py-1 px-2.5"
                  >
                    🌿 {min}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Data-Driven Insights: What makes this healthy / To consider */}
          {(insights.highlights.length > 0 ||
            insights.considerations.length > 0) && (
            <div className="space-y-2 rounded-2xl bg-muted/30 p-3.5 border border-border/60 text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
                Nutritional Highlights
              </span>

              {insights.highlights.length > 0 && (
                <div className="space-y-1">
                  {insights.highlights.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              )}

              {insights.considerations.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-border/40">
                  {insights.considerations.map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-muted-foreground font-medium"
                    >
                      <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ingredients Panel */}
          {item.ingredients && item.ingredients.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Ingredients
              </span>
              <IngredientsPanel ingredients={item.ingredients} />
            </div>
          )}

          {/* Approximate data disclaimer note */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/40 border border-border/60 text-[11px] text-muted-foreground leading-relaxed">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
            <p>
              Calorie and nutritional details are entered by the canteen and are approximate. Values are provided for general student information.
            </p>
          </div>
        </div>

        {/* Bottom Action Footer */}
        <div className="p-4 border-t border-border/60 bg-card flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] text-muted-foreground font-bold uppercase block">
              Total
            </span>
            <span className="text-base font-black text-foreground">
              {formatPaise(item.price_paise)}
            </span>
          </div>

          <Button
            type="button"
            disabled={isOutOfStock}
            onClick={handleAddToCart}
            className="min-h-[44px] px-6 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs active:scale-95 transition-all flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add to Order</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
