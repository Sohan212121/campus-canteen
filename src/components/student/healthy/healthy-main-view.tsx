"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Zap,
  SlidersHorizontal,
  Plus,
  Minus,
  Star,
  Search,
  X,
  Mic,
  ShoppingBag,
  Flame,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { VegIndicator } from "@/components/student/veg-indicator";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { calculateEstimatedCartTotal } from "@/lib/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
import { TopProteinRow } from "@/components/student/healthy/top-protein-row";
import { HealthyPreferencesSheet } from "@/components/student/healthy/healthy-preferences-sheet";
import { HealthyNutritionSheet } from "@/components/student/healthy/healthy-nutrition-sheet";
import { ProteinGoalCelebration } from "@/components/student/healthy/protein-goal-celebration";
import { enrichAndFilterProteinMenuItems } from "@/lib/real-menu-nutrition";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyMainViewProps {
  initialItems: MenuItemData[];
  initialOrderedProteinToday?: number;
  migrationPending?: boolean;
}

const CATEGORY_CHIPS = [
  { id: "all", label: "All Picks", emoji: "⚡" },
  { id: "chicken", label: "Chicken", emoji: "🍗" },
  { id: "eggs", label: "Eggs", emoji: "🥚" },
  { id: "paneer", label: "Paneer", emoji: "🧀" },
  { id: "dal", label: "Dal & Lentils", emoji: "🍲" },
  { id: "combos", label: "Combos & Thali", emoji: "🍱" },
  { id: "shakes", label: "Shakes & Lassi", emoji: "🥤" },
];

export function HealthyMainView({
  initialItems = [],
  initialOrderedProteinToday = 0,
}: HealthyMainViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [minProtein, setMinProtein] = useState<number>(10);
  const [isVegOnly, setIsVegOnly] = useState<boolean>(false);
  const [isUnder500Kcal, setIsUnder500Kcal] = useState<boolean>(false);
  const [isHighProtein, setIsHighProtein] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<"protein-desc" | "calories-asc" | "rating-desc">("protein-desc");
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [selectedDish, setSelectedDish] = useState<MenuItemData | null>(null);

  // Celebration state when daily protein goal is reached
  const [showCelebration, setShowCelebration] = useState(false);
  const celebratedRef = useRef<boolean>(false);

  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const getItemQuantity = useCartStore((s) => s.getItemQuantity);
  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const cartItems = useCartStore((s) => s.items);

  // Active items: strictly real menu items filtered for protein content (>= 10g) & availability
  const activeItems = useMemo(() => {
    return enrichAndFilterProteinMenuItems(initialItems);
  }, [initialItems]);

  // Estimated cart total for docked tray
  const estimatedTotal = useMemo(() => {
    return calculateEstimatedCartTotal(
      cartItems,
      activeItems.map((i) => ({ id: i.id, price_paise: i.price_paise }))
    );
  }, [cartItems, activeItems]);

  // Total protein in currently active cart
  const totalCartProtein = useMemo(() => {
    return cartItems.reduce((acc, cartItem) => {
      const match = activeItems.find((d) => d.id === cartItem.menu_item_id);
      return acc + (match?.protein_g || 0) * cartItem.quantity;
    }, 0);
  }, [cartItems, activeItems]);

  // Daily target and protein progress calculation
  // Progress is 0 if no protein food was ordered today and nothing is in cart
  const targetProteinGoal = 100;
  const totalProtein = Math.round(initialOrderedProteinToday + totalCartProtein);
  const hudConsumed = Math.min(targetProteinGoal, totalProtein);
  const hudToGo = Math.max(0, targetProteinGoal - totalProtein);
  const isGoalHit = totalProtein >= targetProteinGoal;
  const progressRatio = isGoalHit ? 1 : totalProtein / targetProteinGoal;

  // Circumference = 2 * PI * 29 = 182.2
  // When totalProtein === 0: progressDashoffset = 182.2 (ring is 0% filled)
  const progressDashoffset = 182.2 * (1 - progressRatio);

  // Trigger celebration modal when protein goal is hit
  useEffect(() => {
    if (isGoalHit && !celebratedRef.current) {
      celebratedRef.current = true;
      const timer = setTimeout(() => {
        setShowCelebration(true);
      }, 400);
      return () => clearTimeout(timer);
    } else if (!isGoalHit && celebratedRef.current) {
      celebratedRef.current = false;
    }
  }, [isGoalHit]);

  // Filter dishes by category, search query, protein slider, dietary flags, and sort
  const filteredDishes = useMemo(() => {
    const result = activeItems.filter((dish) => {
      if (!dish.is_active || !dish.is_available) return false;

      // Search query filter
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = dish.name.toLowerCase().includes(q);
        const matchesDesc = dish.description?.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc) return false;
      }

      // Wellness category filter
      if (selectedCategory !== "all") {
        const lowerName = dish.name.toLowerCase();
        if (selectedCategory === "chicken") {
          if (!lowerName.includes("chicken")) return false;
        } else if (selectedCategory === "eggs") {
          if (!lowerName.includes("egg") && !lowerName.includes("omelette")) return false;
        } else if (selectedCategory === "paneer") {
          if (!lowerName.includes("paneer")) return false;
        } else if (selectedCategory === "dal") {
          if (
            !lowerName.includes("dal") &&
            !lowerName.includes("rajma") &&
            !lowerName.includes("chole") &&
            !lowerName.includes("soya")
          ) {
            return false;
          }
        } else if (selectedCategory === "combos") {
          if (
            !lowerName.includes("combo") &&
            !lowerName.includes("thali") &&
            !lowerName.includes("rice") &&
            !lowerName.includes("chilla")
          ) {
            return false;
          }
        } else if (selectedCategory === "shakes") {
          if (
            !lowerName.includes("shake") &&
            !lowerName.includes("lassi") &&
            !lowerName.includes("smoothie") &&
            !lowerName.includes("milk")
          ) {
            return false;
          }
        }
      }

      // Minimum protein slider filter
      if (dish.protein_g == null || dish.protein_g < minProtein) {
        return false;
      }

      // Dietary toggle: Veg only
      if (isVegOnly && !dish.is_veg) {
        return false;
      }

      // Calorie toggle: < 500 kcal
      if (isUnder500Kcal) {
        if (dish.calories_kcal == null || dish.calories_kcal >= 500) {
          return false;
        }
      }

      // High protein toggle: >= 25g
      if (isHighProtein) {
        if (dish.protein_g == null || dish.protein_g < 25) {
          return false;
        }
      }

      return true;
    });

    // Sorting
    result.sort((a, b) => {
      if (sortBy === "protein-desc") {
        return (b.protein_g || 0) - (a.protein_g || 0);
      } else if (sortBy === "calories-asc") {
        return (a.calories_kcal || 9999) - (b.calories_kcal || 9999);
      } else if (sortBy === "rating-desc") {
        return (b.rating_avg || 0) - (a.rating_avg || 0);
      }
      return 0;
    });

    return result;
  }, [
    activeItems,
    searchQuery,
    selectedCategory,
    minProtein,
    isVegOnly,
    isUnder500Kcal,
    isHighProtein,
    sortBy,
  ]);

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
    toast.success(`Logged ${dish.name} (+${dish.protein_g}g protein)`);
  };

  const isSheetOpen = isPreferencesOpen || selectedDish !== null || showCelebration;

  return (
    <div className="-mx-4 -mt-3 px-4 pt-3 pb-28 bg-[#fcf9f2] dark:bg-transparent min-h-screen text-[#1c1c18] dark:text-foreground selection:bg-[#c2f02e] selection:text-[#00241a] space-y-4">
      {/* =========================================================================
          HEADER ROW: HEY ATHLETE 👋 & PROTEIN PICKS
          ========================================================================= */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <div className="flex flex-col">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#506600] dark:text-[#81c784] flex items-center gap-1 font-headline">
            <span>Hey Athlete</span>
            <span className="text-sm leading-none">👋</span>
          </span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#00241a] dark:text-[#ede7e1] font-headline">
            Protein Picks
          </h1>
        </div>
      </header>

      {/* SUBTITLE & QUICK CART ACTION ROW */}
      <div className="flex items-center justify-between pt-0.5 pb-1">
        <div className="flex items-center gap-2">
          <Link
            href="/menu"
            className="w-8 h-8 rounded-full bg-[#f0eee7] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-white active:scale-90 transition-transform shadow-2xs hover:bg-[#ebe8e1]"
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-xs sm:text-sm text-[#414945] dark:text-stone-400 font-medium">
            Let&apos;s hit your protein goal today
          </span>
        </div>

        <Link
          href="/cart"
          className="relative w-10 h-10 rounded-full bg-[#ebe8e1] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-white shadow-xs active:scale-90 transition-transform hover:bg-[#e5e2db]"
          aria-label="Fuel cart"
        >
          <ShoppingBag className="h-4.5 w-4.5" />
          {totalItemCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#c2f02e] text-[#00241a] font-bold text-[11px] flex items-center justify-center shadow-[0_2px_8px_rgba(194,240,46,0.7)] font-headline">
              {totalItemCount}
            </span>
          )}
        </Link>
      </div>

      {/* =========================================================================
          SEARCH & FILTER BAR
          ========================================================================= */}
      <div className="flex items-center gap-2 pt-0.5">
        <div className="flex-1 h-12 rounded-full bg-white dark:bg-[#161311] shadow-[0_8px_24px_-4px_rgba(11,59,46,0.06)] dark:shadow-none border border-[#c0c8c3]/40 dark:border-[#3b533a]/60 px-4 flex items-center gap-2.5">
          <Search className="h-4.5 w-4.5 text-[#00241a] dark:text-white shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chicken, paneer, eggs, whey…"
            className="w-full bg-transparent text-[#00241a] dark:text-white placeholder-[#414945]/60 dark:placeholder-stone-500 text-xs sm:text-sm outline-none font-medium"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="text-[#414945] dark:text-stone-400 hover:text-[#00241a] p-1"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Voice search"
              className="text-[#414945] dark:text-stone-400 hover:text-[#00241a] p-1"
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsPreferencesOpen(true)}
          aria-label="Open macro targets"
          className="h-12 w-12 rounded-full bg-[#ebe8e1] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-white relative shadow-xs active:scale-90 transition-transform hover:bg-[#e5e2db] shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="h-5 w-5" />
          <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#ff6f4f] ring-2 ring-white dark:ring-[#161311]" />
        </button>
      </div>

      {/* SHARED-ELEMENT ANNOTATION TAG */}
      <div className="flex items-center gap-1.5 bg-[#f6f3ec] dark:bg-[#1e291c]/60 px-3 py-1.5 rounded-xl border border-[#c0c8c3]/30 dark:border-white/5">
        <Zap className="h-3.5 w-3.5 text-[#506600] dark:text-[#81c784] shrink-0" />
        <span className="text-[10px] sm:text-[11px] font-bold text-[#414945] dark:text-stone-400 uppercase tracking-wider truncate font-headline">
          High-Protein Fuel: Tap any dish to inspect complete macro pie charts &amp; minerals
        </span>
      </div>

      {/* =========================================================================
          DAILY PROTEIN GOAL HERO CARD (LAYOUT SIZE & HEIGHT KEPT ROCK-SOLID CONSTANT)
          ========================================================================= */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#050d0a] via-[#071b12] to-[#0a1410] text-white p-4 sm:p-5 shadow-[0_20px_45px_-10px_rgba(0,0,0,0.7),0_0_25px_rgba(210,248,36,0.12)] border border-[#10b981]/30 transition-all select-none">
        {/* Glow Spheres */}
        <div className="absolute -top-12 -right-8 w-48 h-48 rounded-full bg-[#d2f824]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-44 h-44 rounded-full bg-[#06b6d4]/20 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 right-1/4 w-36 h-36 rounded-full bg-[#8b5cf6]/15 blur-2xl pointer-events-none" />

        {/* Circular Gourmet Fuel Thumbnail in Top Right */}
        <div className="absolute -top-2 -right-2 w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.6),0_0_20px_rgba(210,248,36,0.3)] pointer-events-none ring-2 ring-[#d2f824]/50 transform rotate-3">
          <MenuItemImage
            src={activeItems[0]?.image_url}
            alt="Protein Fuel Bowl"
            aspect="square"
            sizes="128px"
            className="w-full h-full object-cover"
            containerClassName="w-full h-full"
          />
        </div>

        {/* Top Tag & Circular Radial Progress Ring */}
        <div className="relative z-10 flex flex-col gap-2 max-w-[210px] sm:max-w-[240px]">
          {/* Daily Protein Target Badge (Replaces AI Athletic HUD with identical size & height) */}
          <div className="inline-flex items-center gap-1.5 self-start bg-white/10 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/20 shadow-xs">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#c5f331] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#c5f331] shadow-[0_0_8px_#c5f331]" />
            </span>
            <span className="text-[10px] uppercase text-[#c5f331] tracking-wider font-bold font-headline flex items-center gap-1">
              <Flame className="h-3 w-3 fill-current text-[#c5f331]" />
              <span>Daily Protein Target</span>
            </span>
          </div>

          <div className="flex items-center gap-3 pt-0.5">
            {/* SVG Ring Dial (Starts at 0% and fills as protein items are added/ordered) */}
            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
              <svg className="w-20 h-20 -rotate-90 transform" viewBox="0 0 72 72">
                <defs>
                  <linearGradient id="proteinRingGrad" x1="0%" x2="100%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="#d2f824" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
                <circle
                  className="stroke-[#a2d0be]/20"
                  cx="36"
                  cy="36"
                  fill="none"
                  r="29"
                  strokeWidth="6"
                />
                <circle
                  cx="36"
                  cy="36"
                  fill="none"
                  r="29"
                  stroke="url(#proteinRingGrad)"
                  strokeDasharray="182.2"
                  strokeDashoffset={progressDashoffset}
                  strokeLinecap="round"
                  strokeWidth="6"
                  style={{
                    filter: "drop-shadow(0 0 7px rgba(210, 248, 36, 0.7))",
                    transition: "stroke-dashoffset 0.65s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                <span className="text-[17px] sm:text-[18px] text-white font-bold tracking-tight font-headline">
                  {hudConsumed}
                  <span className="text-[11px] font-medium text-[#c5f331]">g</span>
                </span>
                <span className="text-[9px] text-[#a2d0be] mt-0.5 font-bold uppercase tracking-wider font-headline">
                  / {targetProteinGoal}g
                </span>
              </div>
            </div>

            {/* Protein Target Messaging & Goal Status */}
            <div className="flex flex-col">
              {isGoalHit ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCelebration(true)}
                    className="text-left group cursor-pointer"
                  >
                    <span className="text-lg sm:text-xl text-[#d2f824] tracking-tight font-black drop-shadow-[0_0_12px_rgba(210,248,36,0.35)] font-headline flex items-center gap-1 group-hover:underline">
                      Goal Crushed! ⚡
                    </span>
                    <span className="text-xs text-stone-300 leading-tight mt-0.5 font-medium block">
                      Target achieved! Tap to view celebration 🎉
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <span className="text-lg sm:text-xl text-[#d2f824] tracking-tight font-bold drop-shadow-[0_0_12px_rgba(210,248,36,0.35)] font-headline">
                    {hudToGo}g to go
                  </span>
                  <span className="text-xs text-stone-300 leading-tight mt-0.5 font-medium">
                    {totalProtein === 0
                      ? "Add high-protein meals to begin your daily fuel streak"
                      : "Reach your daily muscle protein synthesis threshold"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3 Micro-Metric Summary Boxes */}
        <div className="relative z-10 grid grid-cols-3 gap-2 pt-3.5 mt-3 border-t border-white/10">
          <div className="bg-white/5 backdrop-blur-md rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/10 shadow-xs">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Energy Left
            </span>
            <span className="text-xs sm:text-sm text-white font-bold mt-0.5 font-headline">
              1,240 <span className="text-[9px] font-normal text-stone-300">kcal</span>
            </span>
          </div>

          <div className="bg-white/5 backdrop-blur-md rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/10 shadow-xs">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Carb Limit
            </span>
            <span className="text-xs sm:text-sm text-white font-bold mt-0.5 font-headline">
              85<span className="text-[9px] font-normal text-stone-300">g</span>
            </span>
          </div>

          <div className="bg-white/5 backdrop-blur-md rounded-xl p-2 flex flex-col items-center justify-center text-center border border-white/10 shadow-xs">
            <span className="text-[9px] uppercase tracking-wider text-[#a2d0be] font-bold font-headline">
              Healthy Fats
            </span>
            <span className="text-xs sm:text-sm text-white font-bold mt-0.5 font-headline">
              28<span className="text-[9px] font-normal text-stone-300">g</span>
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================================
          HORIZONTAL CATEGORY CHIPS CAROUSEL
          ========================================================================= */}
      <div className="-mx-4 px-4 overflow-x-auto no-scrollbar py-1">
        <div className="flex items-center gap-2">
          {CATEGORY_CHIPS.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`shrink-0 h-9 px-4 rounded-full font-headline text-xs uppercase flex items-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer ${
                  isSelected
                    ? "bg-[#c2f02e] text-[#00241a] font-bold shadow-xs"
                    : "bg-[#f0eee7] dark:bg-[#1e291c] text-[#1c1c18] dark:text-[#ede7e1] hover:bg-[#ebe8e1] dark:hover:bg-[#253323] font-semibold"
                }`}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* =========================================================================
          SMART FILTER CARD: MIN PROTEIN SLIDER & QUICK TOGGLES
          ========================================================================= */}
      <div className="bg-white dark:bg-[#161311] rounded-2xl p-4 shadow-[0_8px_24px_-4px_rgba(11,59,46,0.06)] dark:shadow-none border border-[#c0c8c3]/40 dark:border-[#3b533a]/60 flex flex-col gap-3">
        {/* Slider Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-4 w-4 text-[#506600] dark:text-[#81c784]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#00241a] dark:text-white font-headline">
              Min Protein Intake
            </span>
          </div>
          <div className="flex items-center gap-1 bg-[#c2f02e]/30 dark:bg-[#2E7D32]/40 px-2.5 py-0.5 rounded-full">
            <span className="text-xs font-bold text-[#00241a] dark:text-[#81c784] font-headline">
              {minProtein}g+
            </span>
            <span className="text-[9px] uppercase tracking-wider text-[#506600] dark:text-stone-300 font-bold">
              per dish
            </span>
          </div>
        </div>

        {/* Range Slider */}
        <div className="relative flex items-center w-full py-0.5">
          <input
            type="range"
            min="10"
            max="50"
            step="5"
            value={minProtein}
            onChange={(e) => setMinProtein(Number(e.target.value))}
            className="w-full h-2 bg-[#ebe8e1] dark:bg-stone-800 rounded-full appearance-none accent-[#506600] dark:accent-[#4CAF50] cursor-pointer"
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-[#414945] dark:text-stone-400 font-bold uppercase tracking-wider font-headline">
          <span>10g</span>
          <span>20g</span>
          <span className="text-[#506600] dark:text-[#81c784] font-black">30g (Target)</span>
          <span>40g</span>
          <span>50g+</span>
        </div>

        {/* Quick Toggles & Sort Dropdown */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
          {/* Veg Only Toggle */}
          <button
            type="button"
            onClick={() => setIsVegOnly((prev) => !prev)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isVegOnly
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs"
                : "bg-[#f0eee7] dark:bg-[#1e291c] text-[#1c1c18] dark:text-[#ede7e1] hover:bg-[#ebe8e1]"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isVegOnly ? "bg-[#00241a]" : "bg-[#506600] dark:bg-[#4CAF50]"
              }`}
            />
            <span>Veg only</span>
          </button>

          {/* < 500 kcal Toggle */}
          <button
            type="button"
            onClick={() => setIsUnder500Kcal((prev) => !prev)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isUnder500Kcal
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs"
                : "bg-[#f0eee7] dark:bg-[#1e291c] text-[#1c1c18] dark:text-[#ede7e1] hover:bg-[#ebe8e1]"
            }`}
          >
            <span>&lt; 500 kcal</span>
          </button>

          {/* High Protein Toggle */}
          <button
            type="button"
            onClick={() => setIsHighProtein((prev) => !prev)}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isHighProtein
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs"
                : "bg-[#f0eee7] dark:bg-[#1e291c] text-[#1c1c18] dark:text-[#ede7e1] hover:bg-[#ebe8e1]"
            }`}
          >
            <span>High protein</span>
          </button>

          {/* Sort Dropdown */}
          <div className="shrink-0 flex items-center gap-1 bg-[#f0eee7] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] text-xs px-2.5 h-8 rounded-full">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-transparent outline-none text-xs font-bold text-[#00241a] dark:text-[#ede7e1] cursor-pointer font-headline pr-1"
            >
              <option value="protein-desc">Protein: High to Low</option>
              <option value="calories-asc">Calories: Low to High</option>
              <option value="rating-desc">Top Rated ★</option>
            </select>
          </div>
        </div>
      </div>

      {/* =========================================================================
          CHEF RECOMMENDED: TOP PROTEIN PICKS (CAROUSEL)
          ========================================================================= */}
      <TopProteinRow
        items={activeItems}
        onOpenDish={(dish) => setSelectedDish(dish)}
        onAddToCart={handleAddToCart}
        getItemQuantity={getItemQuantity}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeItem}
      />

      {/* =========================================================================
          CATALOG: ALL HIGH-PROTEIN MEALS (2-COLUMN GRID)
          ========================================================================= */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#506600] dark:text-[#81c784] font-headline">
              Catalog
            </span>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#00241a] dark:text-[#ede7e1] font-headline">
              All High-Protein Meals
            </h2>
          </div>
          <span className="text-[11px] font-bold text-[#414945] dark:text-[#c4bdb3] bg-[#f0eee7] dark:bg-[#1e291c] px-2.5 py-1 rounded-full font-headline">
            {filteredDishes.length} Dishes
          </span>
        </div>

        {filteredDishes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#c0c8c3]/60 dark:border-[#3b533a]/60 bg-white/60 dark:bg-[#1e291c]/40 p-8 text-center space-y-3 shadow-2xs">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f0eee7] dark:bg-[#2E7D32]/20 text-[#506600] dark:text-[#81c784]">
              <Zap className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-[#00241a] dark:text-[#ede7e1]">
                No dishes match your active filter
              </p>
              <p className="text-xs text-[#414945] dark:text-[#c4bdb3]">
                Try lowering the protein slider or resetting the category filter.
              </p>
            </div>
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchQuery("");
                  setMinProtein(10);
                  setIsVegOnly(false);
                  setIsUnder500Kcal(false);
                  setIsHighProtein(false);
                }}
                className="h-8 text-xs font-bold rounded-xl"
              >
                Reset Filters
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {filteredDishes.map((dish) => {
              const currentQty = getItemQuantity(dish.id);

              return (
                <div
                  key={dish.id}
                  onClick={() => setSelectedDish(dish)}
                  className="bg-[#f6f3ec] dark:bg-[#1e291c]/75 rounded-2xl p-2.5 sm:p-3 shadow-[0_8px_24px_-4px_rgba(11,59,46,0.06)] flex flex-col justify-between border border-[#c0c8c3]/30 dark:border-[#3b533a]/50 hover:shadow-md transition-all cursor-pointer group select-none"
                >
                  <div>
                    {/* Thumbnail Image with Coral Badge & Veg Indicator */}
                    <div className="relative w-full h-28 sm:h-32 rounded-xl overflow-hidden mb-2 shadow-xs bg-muted/20">
                      <MenuItemImage
                        src={dish.image_url}
                        alt={dish.name}
                        aspect="square"
                        sizes="(max-width: 640px) 50vw, 200px"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        containerClassName="w-full h-full"
                      />

                      {/* Top Left Coral Protein Badge */}
                      {dish.protein_g != null && (
                        <div className="absolute top-1.5 left-1.5 bg-[#691000] text-white px-2 py-0.5 rounded-full shadow-xs flex items-center gap-0.5 border border-[#ff6f4f]/30 z-10">
                          <Zap className="h-2.5 w-2.5 text-[#c2f02e] fill-[#c2f02e]" />
                          <span className="font-bold text-[10.5px] tracking-tight font-headline">
                            {dish.protein_g}g
                          </span>
                        </div>
                      )}

                      {/* Top Right Veg Indicator */}
                      <div className="absolute top-1.5 right-1.5 p-0.5 rounded bg-white/95 dark:bg-black/90 shadow-2xs backdrop-blur-md z-10">
                        <VegIndicator isVeg={dish.is_veg} />
                      </div>
                    </div>

                    {/* Dish Name */}
                    <h3 className="font-bold text-[13px] sm:text-sm text-[#00241a] dark:text-[#ede7e1] group-hover:text-[#506600] dark:group-hover:text-[#81c784] transition-colors line-clamp-1 font-headline">
                      {dish.name}
                    </h3>

                    {/* Calories & Rating */}
                    <div className="flex items-center justify-between text-[11px] text-[#414945] dark:text-[#c4bdb3] mt-1 font-medium">
                      <span className="text-[#506600] dark:text-[#ffb74d] font-semibold">
                        {dish.calories_kcal || 350} kcal
                      </span>
                      <span className="flex items-center text-[#00241a] dark:text-white font-bold">
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500 mr-0.5" />
                        {dish.rating_avg ? dish.rating_avg.toFixed(1) : "4.8"}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Price & Circular Add / Stepper */}
                  <div className="flex items-center justify-between mt-2.5 pt-1.5 border-t border-[#c0c8c3]/20 dark:border-stone-800">
                    <span className="font-bold text-sm sm:text-base text-[#00241a] dark:text-white font-headline">
                      {formatPaise(dish.price_paise)}
                    </span>

                    {currentQty > 0 ? (
                      <div
                        className="flex items-center gap-1 bg-white dark:bg-[#141210] border border-[#c0c8c3]/40 dark:border-stone-700 rounded-full p-0.5 shadow-2xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label={`Decrease ${dish.name} quantity`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (currentQty === 1) removeItem(dish.id);
                            else updateQuantity(dish.id, currentQty - 1);
                          }}
                          className="w-6 h-6 rounded-full bg-[#f6f3ec] dark:bg-stone-800 text-[#00241a] dark:text-white flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-xs font-bold text-[#00241a] dark:text-white w-4 text-center select-none font-headline">
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
                          className="w-6 h-6 rounded-full bg-[#0b3b2e] dark:bg-[#2E7D32] text-white flex items-center justify-center active:scale-90 transition-transform cursor-pointer disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Add ${dish.name} to meal`}
                        onClick={(e) => handleAddToCart(e, dish)}
                        className="h-8 w-8 rounded-full bg-[#0b3b2e] dark:bg-[#2E7D32] hover:bg-[#10b981] dark:hover:bg-[#4CAF50] text-white font-bold flex items-center justify-center shadow-xs active:scale-90 transition-transform cursor-pointer"
                      >
                        <Plus className="h-4 w-4 stroke-[2.5]" />
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
          PROTEIN GOAL CELEBRATION MODAL (TRANSITION MANNER)
          ========================================================================= */}
      <ProteinGoalCelebration
        isOpen={showCelebration}
        onClose={() => setShowCelebration(false)}
        proteinGrams={totalProtein}
        targetGoal={targetProteinGoal}
        cartCount={totalItemCount}
      />

      {/* =========================================================================
          PREFERENCES & NUTRITION DETAIL BOTTOM SHEETS
          ========================================================================= */}
      <HealthyPreferencesSheet
        items={activeItems}
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onOpenDishDetail={(dish) => {
          setIsPreferencesOpen(false);
          setSelectedDish(dish);
        }}
      />

      <HealthyNutritionSheet
        item={selectedDish}
        isOpen={selectedDish !== null}
        onClose={() => setSelectedDish(null)}
      />

      {/* =========================================================================
          FLOATING GLASS CART BAR (DOCKED ABOVE BOTTOM NAVIGATION)
          ========================================================================= */}
      {totalItemCount > 0 && !isSheetOpen && (
        <aside
          role="region"
          aria-label="Floating fuel cart"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-40 mx-auto max-w-md pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="h-14 rounded-full bg-[#00241a]/95 dark:bg-[#1b2b1a]/95 backdrop-blur-xl px-3.5 flex items-center justify-between shadow-[0_16px_36px_-6px_rgba(0,36,26,0.5)] border border-[#a2d0be]/20 dark:border-[#3b533a] text-white transition-all select-none">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-[#c2f02e] flex items-center justify-center text-[#00241a] shrink-0 shadow-[0_2px_8px_rgba(194,240,46,0.7)]">
                <Zap className="h-4 w-4 fill-current" />
              </div>
              <div className="flex flex-col truncate">
                <span className="text-xs font-bold text-white tracking-tight truncate font-headline">
                  {totalItemCount} Fuel {totalItemCount === 1 ? "Item" : "Items"} •{" "}
                  <span className="text-[#c2f02e]">{totalCartProtein}g protein</span>
                </span>
                <span className="text-[11px] text-[#a2d0be] font-medium leading-tight">
                  {formatPaise(estimatedTotal)} Total • Ready in ~15-20 min
                </span>
              </div>
            </div>

            <Link
              href="/cart"
              className="shrink-0 h-9 px-3.5 rounded-full bg-[#c2f02e] text-[#00241a] font-headline font-bold text-xs uppercase flex items-center gap-1.5 shadow-[0_4px_12px_rgba(194,240,46,0.5)] hover:bg-[#aad600] active:scale-95 transition-transform"
            >
              <span>View Cart</span>
              <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
            </Link>
          </div>
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
