"use client";

import { Dumbbell, Star } from "lucide-react";
import { formatPaise } from "@/lib/money";
import { VegIndicator } from "@/components/student/veg-indicator";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface TopProteinRowProps {
  items: MenuItemData[];
  onOpenDish: (item: MenuItemData) => void;
}

export function TopProteinRow({ items, onOpenDish }: TopProteinRowProps) {
  // Filter dishes that have protein_g > 0 and sort descending
  const topProteinDishes = items
    .filter((i) => i.is_active && i.protein_g != null && i.protein_g > 0)
    .sort((a, b) => (b.protein_g as number) - (a.protein_g as number))
    .slice(0, 8);

  if (topProteinDishes.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Dumbbell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-bold tracking-tight text-foreground">
            Top Protein Dishes
          </h2>
        </div>
        <span className="text-[11px] font-semibold text-muted-foreground">
          Top {topProteinDishes.length}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
        {topProteinDishes.map((dish) => (
          <div
            key={dish.id}
            onClick={() => onOpenDish(dish)}
            className="w-48 shrink-0 rounded-2xl border border-emerald-500/20 bg-card p-3.5 shadow-2xs hover:border-emerald-500/40 hover:shadow-xs transition-all cursor-pointer flex flex-col justify-between space-y-2 select-none"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <VegIndicator isVeg={dish.is_veg} />
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                  {dish.protein_g}g Protein
                </span>
              </div>
              <h3 className="text-xs font-bold text-foreground line-clamp-2 leading-snug pt-0.5">
                {dish.name}
              </h3>
            </div>

            <div className="space-y-1 pt-1 border-t border-border/50">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-extrabold text-foreground">
                  {formatPaise(dish.price_paise)}
                </span>
                {dish.calories_kcal != null && (
                  <span className="text-muted-foreground font-semibold">
                    {dish.calories_kcal} kcal
                  </span>
                )}
              </div>

              {dish.rating_avg != null && dish.rating_avg > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                  <span>{dish.rating_avg.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
