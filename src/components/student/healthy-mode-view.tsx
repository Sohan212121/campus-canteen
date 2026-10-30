"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  X,
  Plus,
  Minus,
  Clock,
  Sparkles,
  Dumbbell,
  Leaf,
  Flame,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { NutritionPieChart } from "@/components/student/nutrition-pie-chart";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
import { HEALTHY_FOOD_ITEMS, type HealthyFoodItem } from "@/lib/healthy-mode-data";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyModeViewProps {
  canteenItems?: MenuItemData[];
}

type FilterTab = "all" | "high_protein" | "veg" | "non_veg" | "low_calorie";

export function HealthyModeView({ canteenItems = [] }: HealthyModeViewProps) {
  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIngredients, setExpandedIngredients] = useState<Record<string, boolean>>({});

  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const hasHydrated = useCartStore((s) => s.hasHydrated);
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const getItemQuantity = useCartStore((s) => s.getItemQuantity);

  // Map healthy items to actual canteen menu_items if existing by name
  const dbItemMap = useMemo(() => {
    const map = new Map<string, MenuItemData>();
    canteenItems.forEach((item) => {
      map.set(item.name.toLowerCase().trim(), item);
    });
    return map;
  }, [canteenItems]);

  const resolveItemId = (item: HealthyFoodItem): string => {
    const matched = dbItemMap.get(item.name.toLowerCase().trim());
    return matched?.id || item.id;
  };

  const toggleIngredients = (itemId: string) => {
    setExpandedIngredients((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const filteredItems = useMemo(() => {
    return HEALTHY_FOOD_ITEMS.filter((item) => {
      // Category filter
      if (selectedFilter === "high_protein" && item.macros.protein_g < 20) {
        return false;
      }
      if (selectedFilter === "veg" && !item.is_veg) {
        return false;
      }
      if (selectedFilter === "non_veg" && item.is_veg) {
        return false;
      }
      if (selectedFilter === "low_calorie" && item.macros.calories_kcal > 300) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDesc = item.description.toLowerCase().includes(query);
        const matchesIng = item.extractedIngredients.some((i) =>
          i.name.toLowerCase().includes(query)
        );
        if (!matchesName && !matchesDesc && !matchesIng) {
          return false;
        }
      }

      return true;
    });
  }, [selectedFilter, searchQuery]);

  const handleAddToCart = (item: HealthyFoodItem) => {
    const itemId = resolveItemId(item);
    addItem(itemId, 1);
    toast.success(`Added ${item.name} to cart`, {
      id: "healthy-cart-feedback",
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors min-h-[44px] py-1"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Canteen</span>
        </Link>

        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
          <Leaf className="h-3 w-3" />
          <span>Healthy Mode Active</span>
        </span>
      </div>

      {/* Hero Header Card */}
      <header className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-2xs">
            <Dumbbell className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Campus High-Protein Fuel
            </h1>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Nutrient-Dense Meals · Macro Pie Charts · Ingredient Health Analysis
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Fuel your classes and workout routines with certified canteen meals. Every item features full macronutrient breakdowns (protein, carbs, fats), essential mineral percentages, and active ingredient benefits.
        </p>

        {/* Highlight Metrics */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-center">
          <div className="p-2 rounded-xl bg-card border border-border/60">
            <span className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400">
              Up to 32g
            </span>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Protein / Serving</p>
          </div>
          <div className="p-2 rounded-xl bg-card border border-border/60">
            <span className="text-base sm:text-lg font-black text-amber-600 dark:text-amber-400">
              Clean Kcal
            </span>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Macro Tracked</p>
          </div>
          <div className="p-2 rounded-xl bg-card border border-border/60">
            <span className="text-base sm:text-lg font-black text-sky-600 dark:text-sky-400">
              100% Fresh
            </span>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Kitchen Prep</p>
          </div>
        </div>
      </header>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder='Search "soya, paneer, chicken, rajma, sprouts..."'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-11 pl-10 pr-9 text-xs sm:text-sm font-medium bg-card border-border/80 rounded-2xl shadow-2xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
        <button
          type="button"
          onClick={() => setSelectedFilter("all")}
          className={`min-h-[38px] shrink-0 rounded-2xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
            selectedFilter === "all"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-card border border-border/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          All Healthy ({HEALTHY_FOOD_ITEMS.length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedFilter("high_protein")}
          className={`min-h-[38px] shrink-0 rounded-2xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            selectedFilter === "high_protein"
              ? "bg-emerald-600 text-white shadow-xs"
              : "bg-card border border-border/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Dumbbell className="h-3.5 w-3.5" />
          <span>High Protein (&gt;20g)</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedFilter("veg")}
          className={`min-h-[38px] shrink-0 rounded-2xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            selectedFilter === "veg"
              ? "bg-emerald-600 text-white shadow-xs"
              : "bg-card border border-border/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
          <span>Pure Veg</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedFilter("non_veg")}
          className={`min-h-[38px] shrink-0 rounded-2xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            selectedFilter === "non_veg"
              ? "bg-rose-600 text-white shadow-xs"
              : "bg-card border border-border/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
          <span>Chicken & Eggs</span>
        </button>

        <button
          type="button"
          onClick={() => setSelectedFilter("low_calorie")}
          className={`min-h-[38px] shrink-0 rounded-2xl px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
            selectedFilter === "low_calorie"
              ? "bg-sky-600 text-white shadow-xs"
              : "bg-card border border-border/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Flame className="h-3.5 w-3.5" />
          <span>Low Calorie (&lt;300 kcal)</span>
        </button>
      </div>

      {/* Food Items List with Macro Pie Charts */}
      <div className="space-y-4">
        {filteredItems.map((item) => {
          const resolvedId = resolveItemId(item);
          const currentQuantity = getItemQuantity(resolvedId);
          const isExpanded = Boolean(expandedIngredients[item.id]);

          return (
            <div
              key={item.id}
              className="rounded-3xl border border-border/80 bg-card p-5 shadow-xs space-y-4 transition-all hover:border-foreground/20"
            >
              {/* Item Header Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <VegIndicator isVeg={item.is_veg} />
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-black text-emerald-800 dark:text-emerald-300">
                      <Sparkles className="h-3 w-3" />
                      <span>{item.proteinHighlight}</span>
                    </span>
                  </div>

                  <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                    {item.name}
                  </h2>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.description}
                  </p>
                </div>

                {/* Price Tag */}
                <div className="text-right shrink-0">
                  <span className="text-lg font-black text-foreground">
                    {formatPaise(item.price_paise)}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-semibold justify-end">
                    <Clock className="h-3 w-3" />
                    <span>~{item.prep_minutes}m</span>
                  </div>
                </div>
              </div>

              {/* Dietary Badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.dietaryBadges.map((badge) => (
                  <Badge
                    key={badge}
                    variant="outline"
                    className="text-[10px] font-semibold bg-muted/50 border-border/60 py-0.5"
                  >
                    {badge}
                  </Badge>
                ))}
              </div>

              {/* Interactive Nutrition Pie Chart & Macro Ratio */}
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40 text-xs font-bold text-foreground">
                  <span>Nutritional Macro Ratio</span>
                  <span className="text-muted-foreground font-semibold text-[11px]">
                    Fiber: <strong className="text-foreground">{item.macros.fiber_g}g</strong>
                  </span>
                </div>

                <NutritionPieChart macros={item.macros} size={110} />
              </div>

              {/* Essential Minerals & Micronutrients Grid */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Key Minerals & Micronutrients (% DV)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {item.minerals.map((mineral) => (
                    <div
                      key={mineral.name}
                      className="rounded-xl border border-border/50 bg-card p-2 text-center"
                    >
                      <span className="text-[10px] font-semibold text-muted-foreground block truncate">
                        {mineral.name}
                      </span>
                      <span className="text-xs font-extrabold text-foreground block">
                        {mineral.amount}
                      </span>
                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                        {mineral.dailyValuePercent}% DV
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Extracted Ingredients & Health Benefits (Expandable) */}
              <div className="rounded-2xl border border-border/50 bg-muted/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleIngredients(item.id)}
                  className="w-full p-3 flex items-center justify-between text-xs font-bold text-foreground hover:bg-muted/30 transition-colors cursor-pointer select-none"
                  aria-expanded={isExpanded}
                >
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Extracted Ingredients & Functional Health Benefits</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({item.extractedIngredients.length})
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {isExpanded && (
                  <div className="p-3 pt-0 space-y-2 border-t border-border/40 text-xs">
                    {item.extractedIngredients.map((ing) => (
                      <div
                        key={ing.name}
                        className="rounded-xl p-2 bg-card border border-border/50 space-y-0.5"
                      >
                        <span className="font-bold text-foreground block text-[11px]">
                          🌿 {ing.name}
                        </span>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {ing.benefit}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Action Bar: Add to Cart */}
              <div className="pt-2 flex items-center justify-between border-t border-border/50">
                <span className="text-xs font-semibold text-muted-foreground">
                  Made fresh to order
                </span>

                {currentQuantity === 0 ? (
                  <Button
                    type="button"
                    onClick={() => handleAddToCart(item)}
                    size="sm"
                    className="min-h-[40px] px-4 rounded-xl font-bold text-xs gap-1.5 active:scale-95 transition-transform"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add to Order</span>
                  </Button>
                ) : (
                  <div className="flex items-center rounded-xl border border-primary bg-primary/5 p-1 gap-2">
                    <button
                      type="button"
                      onClick={() => updateQuantity(resolvedId, currentQuantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-card hover:bg-muted text-foreground transition-colors cursor-pointer"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-xs font-extrabold w-5 text-center text-foreground">
                      {currentQuantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateQuantity(
                          resolvedId,
                          Math.min(MAX_ITEM_QUANTITY, currentQuantity + 1)
                        )
                      }
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-8 text-center space-y-2">
            <h3 className="font-bold text-sm">No items match your filter</h3>
            <p className="text-xs text-muted-foreground">
              Try selecting &quot;All Healthy&quot; or clearing your search query.
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedFilter("all");
                setSearchQuery("");
              }}
              className="mt-2 text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Floating 1-tap Cart Shortcut */}
      {hasHydrated && totalItemCount > 0 && <CartShortcut />}
    </div>
  );
}
