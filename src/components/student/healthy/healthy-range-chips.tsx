"use client";

import { useMemo } from "react";
import { Dumbbell, Flame, Info, Check } from "lucide-react";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export type MetricTab = "protein" | "calories";
export type ProteinRange = "10-20" | "20-30" | "30-40" | "40+" | null;
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
  // Count matching dishes per range
  const counts = useMemo(() => {
    const active = items.filter((i) => i.is_active && i.is_available);
    return {
      p10_20: active.filter((i) => i.protein_g != null && i.protein_g >= 10 && i.protein_g <= 20).length,
      p20_30: active.filter((i) => i.protein_g != null && i.protein_g > 20 && i.protein_g <= 30).length,
      p30_40: active.filter((i) => i.protein_g != null && i.protein_g > 30 && i.protein_g <= 40).length,
      p40_plus: active.filter((i) => i.protein_g != null && i.protein_g > 40).length,
      cUnder300: active.filter((i) => i.calories_kcal != null && i.calories_kcal < 300).length,
      c300_500: active.filter((i) => i.calories_kcal != null && i.calories_kcal >= 300 && i.calories_kcal <= 500).length,
      c500_plus: active.filter((i) => i.calories_kcal != null && i.calories_kcal > 500).length,
    };
  }, [items]);

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
      {/* iOS/Modern Segmented Tab Control */}
      <div className="flex rounded-2xl bg-zinc-100 dark:bg-[#181412] p-1.5 border border-zinc-200/80 dark:border-[#3b533a]/50 shadow-2xs">
        <button
          type="button"
          onClick={() => onSelectMetric("protein")}
          className={`flex-1 min-h-[42px] rounded-xl text-xs font-black transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            selectedMetric === "protein"
              ? "bg-white dark:bg-[#1e291c] text-emerald-800 dark:text-[#81c784] shadow-sm border border-emerald-500/25 dark:border-[#4CAF50]/40"
              : "text-zinc-500 dark:text-stone-400 hover:text-foreground dark:hover:text-[#ede7e1] font-bold"
          }`}
          aria-pressed={selectedMetric === "protein"}
        >
          <Dumbbell className={`h-4 w-4 ${selectedMetric === "protein" ? "text-emerald-600 dark:text-[#4CAF50]" : ""}`} />
          <span>Browse by Protein</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectMetric("calories")}
          className={`flex-1 min-h-[42px] rounded-xl text-xs font-black transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer ${
            selectedMetric === "calories"
              ? "bg-white dark:bg-[#1e291c] text-emerald-800 dark:text-[#81c784] shadow-sm border border-emerald-500/25 dark:border-[#4CAF50]/40"
              : "text-zinc-500 dark:text-stone-400 hover:text-foreground dark:hover:text-[#ede7e1] font-bold"
          }`}
          aria-pressed={selectedMetric === "calories"}
        >
          <Flame className={`h-4 w-4 ${selectedMetric === "calories" ? "text-emerald-600 dark:text-[#ffb74d]" : ""}`} />
          <span>Browse by Calories</span>
        </button>
      </div>

      {/* Tactile Range Capsule Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {selectedMetric === "protein" ? (
          <>
            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "10-20" ? null : "10-20")
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                proteinRange === "10-20"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {proteinRange === "10-20" && <Check className="h-3.5 w-3.5" />}
              <span>10 - 20 g</span>
              <span className={`text-[10px] font-semibold opacity-80 ${proteinRange === "10-20" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.p10_20})
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "20-30" ? null : "20-30")
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                proteinRange === "20-30"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {proteinRange === "20-30" && <Check className="h-3.5 w-3.5" />}
              <span>20 - 30 g</span>
              <span className={`text-[10px] font-semibold opacity-80 ${proteinRange === "20-30" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.p20_30})
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "30-40" ? null : "30-40")
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                proteinRange === "30-40"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {proteinRange === "30-40" && <Check className="h-3.5 w-3.5" />}
              <span>30 - 40 g</span>
              <span className={`text-[10px] font-semibold opacity-80 ${proteinRange === "30-40" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.p30_40})
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onSelectProteinRange(proteinRange === "40+" ? null : "40+")
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                proteinRange === "40+"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {proteinRange === "40+" && <Check className="h-3.5 w-3.5" />}
              <span>40+ g</span>
              <span className={`text-[10px] font-semibold opacity-80 ${proteinRange === "40+" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.p40_plus})
              </span>
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
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                calorieRange === "under-300"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {calorieRange === "under-300" && <Check className="h-3.5 w-3.5" />}
              <span>&lt; 300 kcal</span>
              <span className={`text-[10px] font-semibold opacity-80 ${calorieRange === "under-300" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.cUnder300})
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onSelectCalorieRange(
                  calorieRange === "300-500" ? null : "300-500"
                )
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                calorieRange === "300-500"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {calorieRange === "300-500" && <Check className="h-3.5 w-3.5" />}
              <span>300 - 500 kcal</span>
              <span className={`text-[10px] font-semibold opacity-80 ${calorieRange === "300-500" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.c300_500})
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onSelectCalorieRange(calorieRange === "500+" ? null : "500+")
              }
              className={`min-h-[38px] px-4 rounded-full border text-xs font-black transition-all duration-200 flex items-center gap-1.5 cursor-pointer select-none ${
                calorieRange === "500+"
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#4CAF50] text-white border-transparent shadow-[0_4px_14px_rgba(76,175,80,0.3)] scale-[1.02]"
                  : "bg-card dark:bg-[#1e291c] border-border/80 dark:border-[#3b533a]/60 text-muted-foreground dark:text-stone-300 hover:border-emerald-500/40 dark:hover:border-[#4CAF50]/40 hover:text-foreground dark:hover:text-[#81c784]"
              }`}
            >
              {calorieRange === "500+" && <Check className="h-3.5 w-3.5" />}
              <span>500+ kcal</span>
              <span className={`text-[10px] font-semibold opacity-80 ${calorieRange === "500+" ? "text-emerald-100" : "text-muted-foreground dark:text-stone-400"}`}>
                ({counts.c500_plus})
              </span>
            </button>
          </>
        )}
      </div>

      {/* Discrete Helper Note for Unpopulated Dishes */}
      {missingCount > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 pl-1">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>
            {missingCount} {missingCount === 1 ? "dish is" : "dishes are"} awaiting nutrition data from canteen admin
          </span>
        </div>
      )}
    </div>
  );
}
