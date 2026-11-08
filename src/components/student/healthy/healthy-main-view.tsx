"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
  Drumstick,
  Egg,
  Soup,
  UtensilsCrossed,
  CupSoda,
  type LucideIcon,
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
import { SearchTakeover } from "@/components/student/search/search-takeover";
import { enrichAndFilterProteinMenuItems } from "@/lib/real-menu-nutrition";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface HealthyMainViewProps {
  initialItems: MenuItemData[];
  initialOrderedProteinToday?: number;
  migrationPending?: boolean;
}

function CheeseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m3 11 16-6 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4z" />
      <path d="M19 5v12" />
      <circle cx="8" cy="14" r="1.2" />
      <circle cx="14" cy="13" r="1" />
      <circle cx="11" cy="9.5" r="1" />
    </svg>
  );
}

interface CategoryChipConfig {
  id: string;
  label: string;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
}

const CATEGORY_CHIPS: CategoryChipConfig[] = [
  { id: "all", label: "All Picks", icon: Zap },
  { id: "chicken", label: "Chicken", icon: Drumstick },
  { id: "eggs", label: "Eggs", icon: Egg },
  { id: "paneer", label: "Paneer", icon: CheeseIcon },
  { id: "dal", label: "Dal & Lentils", icon: Soup },
  { id: "combos", label: "Combos & Thali", icon: UtensilsCrossed },
  { id: "shakes", label: "Shakes & Lassi", icon: CupSoda },
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

  // Search Takeover & Smooth Scroll states
  const [isTakeoverOpen, setIsTakeoverOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const searchBarContainerRef = useRef<HTMLDivElement>(null);
  const catalogSectionRef = useRef<HTMLElement>(null);

  const openTakeover = useCallback(() => {
    if (searchBarContainerRef.current) {
      setTriggerRect(searchBarContainerRef.current.getBoundingClientRect());
    }
    setIsTakeoverOpen(true);
  }, []);

  const scrollToCatalog = useCallback(() => {
    if (catalogSectionRef.current) {
      catalogSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Always stay at the top when entering or clicking the Healthy section
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

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
  const CIRCUMFERENCE = 182.2;
  const targetProteinGoal = 100;
  const totalProtein = Math.round(initialOrderedProteinToday + totalCartProtein);
  const hudConsumed = Math.min(targetProteinGoal, totalProtein);
  const hudToGo = Math.max(0, targetProteinGoal - totalProtein);
  const isGoalHit = totalProtein >= targetProteinGoal;
  const progressRatio = isGoalHit ? 1 : totalProtein / targetProteinGoal;
  const actualTargetOffset = CIRCUMFERENCE * (1 - progressRatio);

  // Dynamic progress ring gauge sweep animation:
  // Starts empty -> smoothly sweeps to 100% full -> smoothly returns and parks at actual user progress
  const [ringOffset, setRingOffset] = useState<number>(CIRCUMFERENCE);
  const [ringTransition, setRingTransition] = useState<string>("none");
  const [isSweepComplete, setIsSweepComplete] = useState<boolean>(false);
  const [displayConsumed, setDisplayConsumed] = useState<number>(hudConsumed);
  const sweepTimersRef = useRef<NodeJS.Timeout[]>([]);
  const animFrameRef = useRef<number | null>(null);

  const triggerSweep = useCallback(() => {
    sweepTimersRef.current.forEach(clearTimeout);
    sweepTimersRef.current = [];
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Respect reduced motion: immediately show actual target without sweep
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRingOffset(actualTargetOffset);
      setRingTransition("stroke-dashoffset 0.65s cubic-bezier(0.16, 1, 0.3, 1)");
      setDisplayConsumed(hudConsumed);
      setIsSweepComplete(true);
      return;
    }

    setIsSweepComplete(false);
    // 1. Start from 0
    setRingOffset(CIRCUMFERENCE);
    setRingTransition("none");
    setDisplayConsumed(0);

    const FORWARD_START = 50;
    const FORWARD_DURATION = 750;
    const HOLD_DURATION = 100;
    const REVERSE_START = FORWARD_START + FORWARD_DURATION + HOLD_DURATION; // 900ms
    const REVERSE_DURATION = 850;
    const TOTAL_DURATION = REVERSE_START + REVERSE_DURATION; // 1750ms

    // Smoothly trigger SVG ring transition in sync with number interpolation
    const t1 = setTimeout(() => {
      setRingTransition("stroke-dashoffset 0.75s cubic-bezier(0.22, 1, 0.36, 1)");
      setRingOffset(0);
    }, FORWARD_START);

    const t2 = setTimeout(() => {
      setRingTransition("stroke-dashoffset 0.85s cubic-bezier(0.16, 1, 0.3, 1)");
      setRingOffset(actualTargetOffset);
    }, REVERSE_START);

    const t3 = setTimeout(() => {
      setIsSweepComplete(true);
      setRingTransition("stroke-dashoffset 0.65s cubic-bezier(0.16, 1, 0.3, 1)");
      setDisplayConsumed(hudConsumed);
    }, TOTAL_DURATION + 50);

    sweepTimersRef.current = [t1, t2, t3];

    // Animate the displayed protein numbers in exact real-time sync with the ring sweep
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const animateValues = (now: number) => {
      const elapsed = now - startTime;

      if (elapsed < FORWARD_START) {
        setDisplayConsumed(0);
        animFrameRef.current = requestAnimationFrame(animateValues);
      } else if (elapsed < FORWARD_START + FORWARD_DURATION) {
        // Forward phase: numbers count up from 0 to 100g
        const progress = Math.min(1, Math.max(0, (elapsed - FORWARD_START) / FORWARD_DURATION));
        const eased = easeOutCubic(progress);
        const val = Math.min(100, Math.round(eased * 100));
        setDisplayConsumed(val);
        animFrameRef.current = requestAnimationFrame(animateValues);
      } else if (elapsed < REVERSE_START) {
        // Peak hold: display 100g
        setDisplayConsumed(100);
        animFrameRef.current = requestAnimationFrame(animateValues);
      } else if (elapsed < TOTAL_DURATION) {
        // Reverse phase: numbers smoothly glide down from 100g back to user's actual progress
        const progress = Math.min(1, Math.max(0, (elapsed - REVERSE_START) / REVERSE_DURATION));
        const eased = easeOutCubic(progress);
        const val = Math.round(100 - eased * (100 - hudConsumed));
        setDisplayConsumed(val);
        animFrameRef.current = requestAnimationFrame(animateValues);
      } else {
        // Sweep finished: lock onto exact user progress
        setDisplayConsumed(hudConsumed);
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(animateValues);
  }, [actualTargetOffset, hudConsumed]);

  // Run the dynamic sweep transition every time the user opens the Healthy section
  useEffect(() => {
    triggerSweep();
    return () => {
      sweepTimersRef.current.forEach(clearTimeout);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [triggerSweep]);

  // Track cart updates reactively after the initial sweep is complete
  useEffect(() => {
    if (isSweepComplete) {
      setRingOffset(actualTargetOffset);
      setDisplayConsumed(hudConsumed);
    }
  }, [actualTargetOffset, hudConsumed, isSweepComplete]);

  // Calculate live to-go amount based on currently animated consumed value
  const displayToGo = Math.max(0, targetProteinGoal - displayConsumed);

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

      // Search query filter (matches name, description, or ingredients)
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = dish.name.toLowerCase().includes(q);
        const matchesDesc = dish.description?.toLowerCase().includes(q);
        const matchesIngredients = dish.ingredients?.some((ing) => ing.toLowerCase().includes(q));
        if (!matchesName && !matchesDesc && !matchesIngredients) return false;
      }

      // Wellness category filter
      if (selectedCategory !== "all") {
        const lowerName = dish.name.toLowerCase();
        const lowerDesc = dish.description?.toLowerCase() || "";
        const lowerIngredients = dish.ingredients?.join(" ").toLowerCase() || "";
        const combined = `${lowerName} ${lowerDesc} ${lowerIngredients}`;

        if (selectedCategory === "chicken") {
          if (!combined.includes("chicken")) return false;
        } else if (selectedCategory === "eggs") {
          if (!combined.includes("egg") && !combined.includes("omelette") && !combined.includes("bhurji")) return false;
        } else if (selectedCategory === "paneer") {
          if (!combined.includes("paneer")) return false;
        } else if (selectedCategory === "dal") {
          if (
            !combined.includes("dal") &&
            !combined.includes("rajma") &&
            !combined.includes("chole") &&
            !combined.includes("soya") &&
            !combined.includes("lentil") &&
            !combined.includes("bean")
          ) {
            return false;
          }
        } else if (selectedCategory === "combos") {
          if (
            !combined.includes("combo") &&
            !combined.includes("thali") &&
            !combined.includes("rice") &&
            !combined.includes("chilla") &&
            !combined.includes("bowl")
          ) {
            return false;
          }
        } else if (selectedCategory === "shakes") {
          if (
            !combined.includes("shake") &&
            !combined.includes("lassi") &&
            !combined.includes("smoothie") &&
            !combined.includes("milk") &&
            !combined.includes("whey")
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

  const isSheetOpen = isPreferencesOpen || selectedDish !== null || showCelebration || isTakeoverOpen;

  return (
    <div className="-mx-4 -mt-3 px-4 pt-3 pb-28 bg-[#fcf9f2] dark:bg-transparent min-h-screen text-[#1c1c18] dark:text-foreground selection:bg-[#c2f02e] selection:text-[#00241a] space-y-4">
      {/* =========================================================================
          HEADER ROW: PROTEIN PICKS
          ========================================================================= */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <div className="flex flex-col">
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
            className="w-8 h-8 rounded-full bg-[#e8f5e9] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-[#81c784] active:scale-90 transition-transform shadow-2xs hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
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
          className="relative w-10 h-10 rounded-full bg-[#e8f5e9] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-[#81c784] shadow-xs active:scale-90 transition-transform hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
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
          SEARCH & FILTER BAR (Tapping opens full-screen SearchTakeover)
          ========================================================================= */}
      <div className="flex items-center gap-2 pt-0.5">
        <div
          ref={searchBarContainerRef}
          onClick={openTakeover}
          className="flex-1 h-12 rounded-full bg-white dark:bg-[#161311] shadow-[0_8px_24px_-4px_rgba(11,59,46,0.06)] dark:shadow-none border border-[#c0c8c3]/40 dark:border-[#3b533a]/60 pl-4 pr-1.5 flex items-center gap-2.5 cursor-pointer hover:border-[#10b981]/50 transition-colors"
          role="search"
        >
          <Search className="h-4.5 w-4.5 text-[#00241a] dark:text-white shrink-0" />
          <input
            type="text"
            readOnly
            value={searchQuery}
            onFocus={openTakeover}
            placeholder="Search chicken, paneer, eggs, whey…"
            className="w-full bg-transparent text-[#00241a] dark:text-white placeholder-[#414945]/60 dark:placeholder-stone-500 text-xs sm:text-sm outline-none font-medium cursor-pointer"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchQuery("");
                setTimeout(scrollToCatalog, 50);
              }}
              aria-label="Clear search"
              className="w-9 h-9 rounded-full bg-[#e8f5e9] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-[#81c784] hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60 active:scale-90 transition-transform cursor-pointer shrink-0"
            >
              <X className="h-4 w-4 stroke-[2.25]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={openTakeover}
              aria-label="Voice search"
              className="w-9 h-9 rounded-full bg-[#e8f5e9] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-[#81c784] hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60 active:scale-90 transition-transform cursor-pointer shrink-0"
            >
              <Mic className="h-4.5 w-4.5 stroke-[2.25]" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsPreferencesOpen(true)}
          aria-label="Open macro targets"
          className="h-12 w-12 rounded-full bg-[#e8f5e9] dark:bg-[#1e291c] flex items-center justify-center text-[#00241a] dark:text-[#81c784] relative shadow-xs active:scale-90 transition-transform hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60 shrink-0 cursor-pointer"
        >
          <SlidersHorizontal className="h-5 w-5" />
          <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#ff6f4f] ring-2 ring-white dark:ring-[#161311]" />
        </button>
      </div>

      {/* =========================================================================
          DAILY PROTEIN GOAL HERO CARD (LAYOUT SIZE & HEIGHT KEPT ROCK-SOLID CONSTANT)
          ========================================================================= */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#050d0a] via-[#071b12] to-[#0a1410] text-white p-5 sm:p-6 shadow-[0_20px_45px_-10px_rgba(0,0,0,0.7),0_0_25px_rgba(210,248,36,0.12)] border border-[#10b981]/30 transition-all select-none min-h-[215px] sm:min-h-[230px] flex flex-col justify-between">
        {/* Glow Spheres */}
        <div className="absolute -top-12 -right-8 w-48 h-48 rounded-full bg-[#d2f824]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-44 h-44 rounded-full bg-[#06b6d4]/20 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 right-1/4 w-36 h-36 rounded-full bg-[#8b5cf6]/15 blur-2xl pointer-events-none" />

        {/* Circular Gourmet Fuel Thumbnail in Top Right */}
        <div className="absolute -top-3 -right-3 w-32 h-32 sm:w-36 sm:h-36 rounded-full overflow-hidden shadow-[0_12px_36px_rgba(0,0,0,0.7),0_0_24px_rgba(210,248,36,0.35)] pointer-events-none ring-2 ring-[#d2f824]/50 transform rotate-3">
          <MenuItemImage
            src={activeItems[0]?.image_url}
            alt="Protein Fuel Bowl"
            aspect="square"
            sizes="144px"
            className="w-full h-full object-cover"
            containerClassName="w-full h-full"
          />
        </div>

        {/* Top Tag */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 self-start bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 shadow-xs">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#c5f331] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#c5f331] shadow-[0_0_8px_#c5f331]" />
            </span>
            <span className="text-[11px] sm:text-xs uppercase text-[#c5f331] tracking-wider font-bold font-headline flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 fill-current text-[#c5f331]" />
              <span>Daily Protein Target</span>
            </span>
          </div>
        </div>

        {/* Circular Radial Progress Ring & Target Messaging */}
        <div className="relative z-10 flex items-center gap-3.5 sm:gap-4.5 pt-2 flex-1 min-w-0 pr-2">
          {/* SVG Ring Dial (Scaled up from 88px to 104px / 114px with dynamic startup sweep) */}
          <div
            onClick={triggerSweep}
            className="relative w-[104px] h-[104px] sm:w-[114px] sm:h-[114px] shrink-0 flex items-center justify-center cursor-pointer select-none active:scale-95 transition-transform"
            role="button"
            tabIndex={0}
            aria-label={`Protein Progress Dial: ${hudConsumed} grams consumed out of ${targetProteinGoal} grams target. Tap to replay sweep.`}
          >
            <svg className="w-[104px] h-[104px] sm:w-[114px] sm:h-[114px] -rotate-90 transform" viewBox="0 0 72 72">
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
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
                strokeLinecap="round"
                strokeWidth="6"
                style={{
                  transition: ringTransition,
                  filter: "drop-shadow(0 0 8px rgba(210, 248, 36, 0.75))",
                }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none pointer-events-none">
              <span className="text-2xl sm:text-3xl text-white font-extrabold tracking-tight font-headline">
                {displayConsumed}
                <span className="text-xs sm:text-sm font-semibold text-[#c5f331]">g</span>
              </span>
              <span className="text-[10px] sm:text-xs text-[#a2d0be] mt-1 font-bold uppercase tracking-wider font-headline">
                / {targetProteinGoal}g
              </span>
            </div>
          </div>

          {/* Protein Target Messaging & Goal Status */}
          <div className="flex flex-col min-w-0 flex-1">
            {isSweepComplete && isGoalHit ? (
              <button
                type="button"
                onClick={() => setShowCelebration(true)}
                className="text-left group cursor-pointer"
              >
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-xl sm:text-2xl text-[#d2f824] tracking-tight font-black drop-shadow-[0_0_12px_rgba(210,248,36,0.35)] font-headline group-hover:underline">
                    Goal Crushed!
                  </span>
                  <span className="text-lg leading-none">⚡</span>
                </div>
                <span className="text-xs sm:text-sm text-stone-300 leading-snug font-medium block mt-1">
                  Target achieved! Tap to view celebration 🎉
                </span>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-2xl sm:text-3xl font-black text-[#d2f824] tracking-tight font-headline drop-shadow-[0_0_14px_rgba(210,248,36,0.4)]">
                    {displayToGo}g
                  </span>
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#c5f331] bg-[#c5f331]/15 px-2 py-0.5 rounded-full border border-[#c5f331]/30 font-headline">
                    to go
                  </span>
                </div>
                <span className="text-xs sm:text-sm text-stone-300/90 leading-snug font-medium mt-1">
                  {totalProtein === 0
                    ? "Add high-protein meals to hit your daily goal"
                    : "Reach your daily muscle protein synthesis threshold"}
                </span>
              </>
            )}
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
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setTimeout(scrollToCatalog, 50);
                }}
                className={`shrink-0 h-9 px-4 rounded-full font-headline text-xs uppercase flex items-center gap-1.5 transition-all duration-150 active:scale-95 cursor-pointer ${
                  isSelected
                    ? "bg-[#c2f02e] text-[#00241a] font-bold shadow-xs border border-[#a8db00]"
                    : "bg-[#e8f5e9] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] hover:bg-[#d8eedd] dark:hover:bg-[#253323] font-semibold border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
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
            onPointerUp={() => setTimeout(scrollToCatalog, 50)}
            onTouchEnd={() => setTimeout(scrollToCatalog, 50)}
            onMouseUp={() => setTimeout(scrollToCatalog, 50)}
            onKeyUp={() => setTimeout(scrollToCatalog, 50)}
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
            onClick={() => {
              setIsVegOnly((prev) => !prev);
              setTimeout(scrollToCatalog, 50);
            }}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isVegOnly
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs border border-[#a8db00]"
                : "bg-[#e8f5e9] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isVegOnly ? "bg-[#00241a]" : "bg-[#2e7d32] dark:bg-[#4CAF50]"
              }`}
            />
            <span>Veg only</span>
          </button>

          {/* < 500 kcal Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsUnder500Kcal((prev) => !prev);
              setTimeout(scrollToCatalog, 50);
            }}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isUnder500Kcal
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs border border-[#a8db00]"
                : "bg-[#e8f5e9] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
            }`}
          >
            <span>&lt; 500 kcal</span>
          </button>

          {/* High Protein Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsHighProtein((prev) => !prev);
              setTimeout(scrollToCatalog, 50);
            }}
            className={`shrink-0 h-8 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer font-headline ${
              isHighProtein
                ? "bg-[#c2f02e] text-[#00241a] shadow-xs border border-[#a8db00]"
                : "bg-[#e8f5e9] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] hover:bg-[#d8eedd] dark:hover:bg-[#253323] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60"
            }`}
          >
            <span>High protein</span>
          </button>

          {/* Sort Dropdown */}
          <div className="shrink-0 flex items-center gap-1 bg-[#e8f5e9] dark:bg-[#1e291c] text-[#00241a] dark:text-[#ede7e1] text-xs px-2.5 h-8 rounded-full border border-[#cbe6d4]/60 dark:border-[#3b533a]/60 hover:bg-[#d8eedd] dark:hover:bg-[#253323] transition-colors">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as typeof sortBy);
                setTimeout(scrollToCatalog, 50);
              }}
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
      <section
        ref={catalogSectionRef}
        id="healthy-dishes-catalog"
        className="space-y-3 pt-2 scroll-mt-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#506600] dark:text-[#81c784] font-headline">
              Catalog
            </span>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-[#00241a] dark:text-[#ede7e1] font-headline">
              All High-Protein Meals
            </h2>
          </div>
          <span className="text-[11px] font-bold text-[#00241a] dark:text-[#81c784] bg-[#e8f5e9] dark:bg-[#1e291c] border border-[#cbe6d4]/60 dark:border-[#3b533a]/60 px-2.5 py-1 rounded-full font-headline">
            {filteredDishes.length} Dishes
          </span>
        </div>

        {/* ACTIVE FILTER FEEDBACK PILLS */}
        {(searchQuery || selectedCategory !== "all" || minProtein > 10 || isVegOnly || isUnder500Kcal || isHighProtein) && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="text-[10px] uppercase font-bold text-[#414945] dark:text-stone-400 mr-1">
              Active:
            </span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                &ldquo;{searchQuery}&rdquo;
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedCategory !== "all" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                {CATEGORY_CHIPS.find((c) => c.id === selectedCategory)?.label}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {minProtein > 10 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                {minProtein}g+ protein
                <button
                  type="button"
                  onClick={() => {
                    setMinProtein(10);
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {isVegOnly && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                Veg only
                <button
                  type="button"
                  onClick={() => {
                    setIsVegOnly(false);
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {isUnder500Kcal && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                &lt; 500 kcal
                <button
                  type="button"
                  onClick={() => {
                    setIsUnder500Kcal(false);
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {isHighProtein && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#c2f02e]/30 dark:bg-emerald-950/60 text-[#00241a] dark:text-emerald-300 px-2.5 py-0.5 rounded-full border border-[#c2f02e]/60">
                High protein (25g+)
                <button
                  type="button"
                  onClick={() => {
                    setIsHighProtein(false);
                    setTimeout(scrollToCatalog, 50);
                  }}
                  className="cursor-pointer hover:opacity-75"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("all");
                setMinProtein(10);
                setIsVegOnly(false);
                setIsUnder500Kcal(false);
                setIsHighProtein(false);
                setTimeout(scrollToCatalog, 50);
              }}
              className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer ml-1"
            >
              Reset all
            </button>
          </div>
        )}

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
          FULL-SCREEN SEARCH TAKEOVER: SUGGESTED DISHES WITH NAME & IMAGE
          ========================================================================= */}
      <SearchTakeover
        isOpen={isTakeoverOpen}
        onClose={() => {
          setIsTakeoverOpen(false);
          setTriggerRect(null);
        }}
        items={activeItems}
        stayOnCurrentPage={true}
        onSelectCategory={(category) => {
          setIsTakeoverOpen(false);
          setSearchQuery(category.label);
          setTimeout(scrollToCatalog, 150);
        }}
        onSearchSubmit={(q) => {
          setIsTakeoverOpen(false);
          setSearchQuery(q);
          setTimeout(scrollToCatalog, 150);
        }}
        onOpenItem={(dish) => {
          setIsTakeoverOpen(false);
          setSelectedDish(dish);
        }}
        triggerRect={triggerRect}
        initialQuery={searchQuery}
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
