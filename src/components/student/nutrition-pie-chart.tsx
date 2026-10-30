"use client";

import { useId } from "react";
import type { MacroBreakdown } from "@/lib/healthy-mode-data";
import { calculateMacroPercentages } from "@/lib/healthy-mode-data";

interface NutritionPieChartProps {
  macros: MacroBreakdown;
  size?: number;
  showLegend?: boolean;
  className?: string;
}

export function NutritionPieChart({
  macros,
  size = 110,
  showLegend = true,
  className = "",
}: NutritionPieChartProps) {
  const chartId = useId();
  const { proteinPercent, carbsPercent, fatsPercent } = calculateMacroPercentages(macros);

  // SVG Geometry: radius 40 inside 100x100 viewBox
  const radius = 38;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius; // ~238.76

  // Arc stroke dash calculations
  const proteinArc = (proteinPercent / 100) * circumference;
  const carbsArc = (carbsPercent / 100) * circumference;
  const fatsArc = (fatsPercent / 100) * circumference;

  const proteinOffset = 0;
  const carbsOffset = -proteinArc;
  const fatsOffset = -(proteinArc + carbsArc);

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {/* Donut SVG */}
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full -rotate-90 transform transition-transform duration-500 will-change-transform"
          aria-label={`Nutrient Breakdown: ${proteinPercent}% Protein, ${carbsPercent}% Carbs, ${fatsPercent}% Healthy Fats`}
          role="img"
        >
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/40"
          />

          {/* Protein Arc (Emerald) */}
          {proteinPercent > 0 && (
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#10b981"
              strokeWidth={strokeWidth}
              strokeDasharray={`${proteinArc} ${circumference}`}
              strokeDashoffset={proteinOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          )}

          {/* Carbs Arc (Amber) */}
          {carbsPercent > 0 && (
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={strokeWidth}
              strokeDasharray={`${carbsArc} ${circumference}`}
              strokeDashoffset={carbsOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          )}

          {/* Fats Arc (Sky Blue) */}
          {fatsPercent > 0 && (
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#0284c7"
              strokeWidth={strokeWidth}
              strokeDasharray={`${fatsArc} ${circumference}`}
              strokeDashoffset={fatsOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          )}
        </svg>

        {/* Center Calorie Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
          <span className="text-base sm:text-lg font-black tracking-tight leading-none text-foreground">
            {macros.calories_kcal}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mt-0.5">
            kcal
          </span>
        </div>
      </div>

      {/* Macronutrient Legend & Grams */}
      {showLegend && (
        <div
          id={chartId}
          className="grid grid-cols-3 gap-2 w-full text-center text-xs"
        >
          {/* Protein */}
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2 flex flex-col items-center">
            <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
              <span>Protein</span>
            </div>
            <span className="text-sm font-extrabold text-foreground mt-0.5">
              {macros.protein_g}g
            </span>
            <span className="text-[9px] text-muted-foreground font-semibold">
              {proteinPercent}% cals
            </span>
          </div>

          {/* Carbs */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2 flex flex-col items-center">
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase">
              <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
              <span>Carbs</span>
            </div>
            <span className="text-sm font-extrabold text-foreground mt-0.5">
              {macros.carbs_g}g
            </span>
            <span className="text-[9px] text-muted-foreground font-semibold">
              {carbsPercent}% cals
            </span>
          </div>

          {/* Healthy Fats */}
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-2 flex flex-col items-center">
            <div className="flex items-center gap-1 text-[10px] font-bold text-sky-800 dark:text-sky-300 uppercase">
              <span className="h-2 w-2 rounded-full bg-sky-500 inline-block" />
              <span>Fats</span>
            </div>
            <span className="text-sm font-extrabold text-foreground mt-0.5">
              {macros.fats_g}g
            </span>
            <span className="text-[9px] text-muted-foreground font-semibold">
              {fatsPercent}% cals
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
