"use client";

import { Dumbbell, Flame, Info } from "lucide-react";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export type MetricTab = "protein" | "calories";
export type ProteinRange = "20-30" | "30-40" | "40+" | null;
export type CalorieRange = "under-300" | "300-500" | "500+" | null;

interface HealthyRangeChipsProps {
  items: MenuItemData[];
  selectedMetric: MetricTab;
  onSelectMetric: (metric: MetricTab) => void;
  proteinRange: ProteinRange;
  onSelectProteinRange: (range: ProteinRange) => void;
  calorieRange: CalorieRange;
  onSelectCalorieRange: (range: CalorieRange) => void;
}

export function HealthyRangeChips({
  items,
  selectedMetric,
  onSelectMetric,
  proteinRange,
  onSelectProteinRange,
  calorieRange,
  onSelectCalorieRange,
}: HealthyRangeChipsProps) {
  // Count unpopulated dishes
  const missingProteinCount = items.filter(
    (i) => i.is_active && (i.protein_g == null || i.protein_g < 0)
  ).length;

  const missingCaloriesCount = items.filter(
    (i) => i.is_active && (i.calories_kcal == null || i.calories_kcal <= 0)
  ).length;

  const missingCount =
    selectedMetric === "protein" ? missingProteinCount : missingCaloriesCount;

  return (
    <div className="space-y-3">
      {/* Segmented Control: Protein | Calories */}
      <div className="flex rounded-2xl bg-muted/60 p-1 border border-border/80">
        <button
          type="button"
          onClick={() => onSelectMetric("protein")}
          className={`flex-1 min-h-[40px] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            selectedMetric === "protein"
              ? "bg-emerald-600 text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={selectedMetric === "protein"}
        >
          <Dumbbell className="h-4 w-4" />
          <span>Browse by Protein</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectMetric("calories")}
          className={`flex-1 min-h-[40px] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            selectedMetric === "calories"
              ? "bg-emerald-600 text-white shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={selectedMetric === "calories"}
        >
          <Flame className="h-4 w-4" />
          <span>Browse by Calories</span>
        </button>
      </div>

      {/* Range Bubbles */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {selectedMetric === "protein" ? (
          <>
            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "20-30" ? null : "20-30")
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                proteinRange === "20-30"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              20 - 30 g
            </button>
            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "30-40" ? null : "30-40")
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                proteinRange === "30-40"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              30 - 40 g
            </button>
            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "40+" ? null : "40+")
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                proteinRange === "40+"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              40+ g
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                onSelectCalorieRange(
                  calorieRange === "under-300" ? null : "under-300"
                )
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                calorieRange === "under-300"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              Under 300 kcal
            </button>
            <button
              type="button"
              onClick={() =>
                onSelectCalorieRange(
                  calorieRange === "300-500" ? null : "300-500"
                )
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                calorieRange === "300-500"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              300 - 500 kcal
            </button>
            <button
              type="button"
              onClick={() =>
                onSelectCalorieRange(calorieRange === "500+" ? null : "500+")
              }
              className={`min-h-[38px] px-3.5 rounded-full border text-xs font-bold transition-all cursor-pointer select-none ${
                calorieRange === "500+"
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                  : "bg-card border-border/80 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground"
              }`}
            >
              500+ kcal
            </button>
          </>
        )}

        {(proteinRange || calorieRange) && (
          <button
            type="button"
            onClick={() => {
              onSelectProteinRange(null);
              onSelectCalorieRange(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground font-semibold px-2 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* Missing Nutrition Note */}
      {missingCount > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>
            {missingCount} campus {missingCount === 1 ? "dish is" : "dishes are"} not listed because {selectedMetric} data has not been added yet.
          </span>
        </div>
      )}
    </div>
  );
}
