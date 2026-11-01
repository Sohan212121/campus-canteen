"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Utensils,
  ArrowRight,
  Leaf,
  Flame,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MenuItemCard } from "@/components/student/menu-item-card";
import { ItemDetailSheet, type MenuItemData } from "@/components/student/item-detail-sheet";
import { BestSellersRow } from "@/components/student/best-sellers-row";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { type MenuItemPriceRef, registerMenuItemPrices } from "@/lib/cart-shortcut";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";

export type CategoryData = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

interface StudentHomeViewProps {
  categories: CategoryData[];
  initialItems: MenuItemData[];
  bestSellers?: BestSellerItem[];
}

// Meal filter types matching user request (Breakfast, Lunch, Snacks, Dinner, All, Beverages)
type MealType = "all" | "breakfast" | "lunch" | "snacks" | "dinner" | "beverages";

interface MealTabConfig {
  id: MealType;
  label: string;
  icon: string;
  color: string;
}

const MEAL_TABS: MealTabConfig[] = [
  { id: "all", label: "All Items", icon: "🍽️", color: "from-zinc-500/10 to-zinc-500/5" },
  { id: "breakfast", label: "Breakfast", icon: "🍳", color: "from-amber-500/15 to-orange-500/5" },
  { id: "lunch", label: "Lunch", icon: "🍱", color: "from-emerald-500/15 to-teal-500/5" },
  { id: "snacks", label: "Snacks", icon: "🥪", color: "from-purple-500/15 to-indigo-500/5" },
  { id: "dinner", label: "Dinner", icon: "🍛", color: "from-rose-500/15 to-red-500/5" },
  { id: "beverages", label: "Beverages", icon: "☕", color: "from-blue-500/15 to-cyan-500/5" },
];

// 5 motivating & food-themed banner slides (inspired by Zomato's Homely Subscriptions hero)
interface PromoSlide {
  id: string;
  badge: string;
  badgeIcon: string;
  title: string;
  subtitle: string;
  highlight: string;
  ctaText: string;
  gradient: string;
  accentBorder: string;
  emoji: string;
  mealTarget: MealType;
}

const PROMO_SLIDES: PromoSlide[] = [
  {
    id: "homely-meals",
    badge: "INTRODUCING",
    badgeIcon: "🍱",
    title: "Homely Meal Subscriptions",
    subtitle: "Pure desi goodness with fresh rotis, fragrant dal & homestyle thalis.",
    highlight: "Made fresh daily for campus students",
    ctaText: "Explore Meals",
    gradient: "from-purple-900 via-indigo-900 to-violet-950",
    accentBorder: "border-purple-500/40",
    emoji: "🍱",
    mealTarget: "lunch",
  },
  {
    id: "breakfast-rush",
    badge: "5-MIN QUICK FUEL",
    badgeIcon: "⚡",
    title: "Crispy Dosas & Filter Kaapi",
    subtitle: "Beat the morning rush. Hot, crispy breakfast ready before class starts.",
    highlight: "Average prep: ~4 mins",
    ctaText: "Order Breakfast",
    gradient: "from-amber-900 via-orange-900 to-amber-950",
    accentBorder: "border-amber-500/40",
    emoji: "🍳",
    mealTarget: "breakfast",
  },
  {
    id: "chef-biryani",
    badge: "CHEF'S SPECIAL",
    badgeIcon: "🔥",
    title: "Dum Biryani & Rich Curries",
    subtitle: "Aromatic basmati rice, tender spices & cooling raita kept piping warm.",
    highlight: "Student favorite on campus",
    ctaText: "Grab Biryani",
    gradient: "from-emerald-950 via-teal-900 to-green-950",
    accentBorder: "border-emerald-500/40",
    emoji: "🍛",
    mealTarget: "lunch",
  },
  {
    id: "study-snacks",
    badge: "4 PM BREAK RECHARGE",
    badgeIcon: "☕",
    title: "Hot Samosas, Puffs & Shakes",
    subtitle: "Recharge your energy between lectures with crunchiest campus snacks.",
    highlight: "Pairs best with hot masala chai",
    ctaText: "Snack Now",
    gradient: "from-indigo-950 via-blue-900 to-slate-900",
    accentBorder: "border-blue-500/40",
    emoji: "🥪",
    mealTarget: "snacks",
  },
  {
    id: "zero-queue",
    badge: "SMART DIGITAL PICKUP",
    badgeIcon: "⏱️",
    title: "Pre-Order & Skip The Line",
    subtitle: "Place your order ahead. Collect with your secure digital token in seconds.",
    highlight: "Zero physical wait time",
    ctaText: "View Full Menu",
    gradient: "from-rose-950 via-red-900 to-pink-950",
    accentBorder: "border-rose-500/40",
    emoji: "🚀",
    mealTarget: "all",
  },
];

// Helper to test if item matches a meal type
function matchesMealType(
  item: MenuItemData,
  categoryMap: Map<string, string>,
  mealType: MealType
): boolean {
  if (mealType === "all") return true;

  const categoryName = (item.category_id ? categoryMap.get(item.category_id) : "")?.toLowerCase() || "";
  const name = item.name.toLowerCase();
  const desc = (item.description || "").toLowerCase();
  const combined = `${categoryName} ${name} ${desc}`;

  switch (mealType) {
    case "breakfast":
      return (
        categoryName.includes("breakfast") ||
        /dosa|idli|vada|poha|upma|paratha|bread|toast|omlette|egg|poori|puri|chole bhature|breakfast/.test(combined)
      );
    case "lunch":
      return (
        categoryName.includes("lunch") ||
        categoryName.includes("meal") ||
        /thali|biryani|rice|roti|dal|paneer|chicken|curry|meal|lunch|pulao|rajma|chawal|combo/.test(combined)
      );
    case "snacks":
      return (
        categoryName.includes("snack") ||
        categoryName.includes("fast food") ||
        categoryName.includes("chaat") ||
        /samosa|puff|sandwich|burger|roll|maggi|fries|chaat|snack|cutlet|pizza|nugget|pakoda|bhel|frankie/.test(combined)
      );
    case "dinner":
      return (
        categoryName.includes("dinner") ||
        categoryName.includes("meal") ||
        /dinner|thali|fried rice|noodles|chapati|meal|biryani|curry|paneer|roti|dal/.test(combined)
      );
    case "beverages":
      return (
        categoryName.includes("beverage") ||
        categoryName.includes("drink") ||
        categoryName.includes("juice") ||
        /tea|chai|coffee|kaapi|juice|shake|drink|beverage|lassi|water|soda|badam milk|cold drink/.test(combined)
      );
    default:
      return true;
  }
}

export function StudentHomeView({
  categories,
  initialItems,
  bestSellers = [],
}: StudentHomeViewProps) {
  const { startTransition } = useNavigationTransition();
  // 1. Carousel state (changes every 2.5s with right-to-left sliding animation)
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // 2. Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMeal, setSelectedMeal] = useState<MealType>("all");
  const [isVegOnly, setIsVegOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [under100Only, setUnder100Only] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // 3. Item detail modal & cart state
  const [selectedItem, setSelectedItem] = useState<MenuItemData | null>(null);
  const filterSectionRef = useRef<HTMLDivElement>(null);
  const foodItemsSectionRef = useRef<HTMLElement>(null);

  // Memoized price references for CartShortcut calculation
  const allPriceRefs = useMemo(() => {
    const list: MenuItemPriceRef[] = initialItems.map((i) => ({
      id: i.id,
      price_paise: i.price_paise,
    }));
    if (bestSellers) {
      for (const bs of bestSellers) {
        if (bs.item && !list.some((i) => i.id === bs.item.id)) {
          list.push({ id: bs.item.id, price_paise: bs.item.price_paise });
        }
      }
    }
    registerMenuItemPrices(list);
    return list;
  }, [initialItems, bestSellers]);

  // Smooth auto-scroll to the filtered food items section when any filter is clicked
  const scrollToFoodSection = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        const target = filterSectionRef.current || foodItemsSectionRef.current;
        if (target) {
          target.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 50);
    });
  }, []);

  // Category map for rapid lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  // Pre-resolve representative dish image for each hero slide
  const slideImages = useMemo(() => {
    return PROMO_SLIDES.map((slide) => {
      const match = initialItems.find(
        (i) => i.image_url && matchesMealType(i, categoryMap, slide.mealTarget)
      );
      return match?.image_url || initialItems.find((i) => i.image_url)?.image_url;
    });
  }, [initialItems, categoryMap]);

  // Auto-transition interval: advances every 2.8 seconds (smooth right-to-left slide)
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % PROMO_SLIDES.length);
    }, 2800);

    return () => clearInterval(timer);
  }, [isPaused]);

  // Touch swipe support for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return;
    const diff = touchStartX.current - touchEndX.current;
    // Swipe left (next)
    if (diff > 50) {
      setCurrentSlide((prev) => (prev + 1) % PROMO_SLIDES.length);
    }
    // Swipe right (prev)
    if (diff < -50) {
      setCurrentSlide((prev) => (prev - 1 + PROMO_SLIDES.length) % PROMO_SLIDES.length);
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  // Filtered menu items calculation
  const filteredItems = useMemo(() => {
    return initialItems.filter((item) => {
      if (!item.is_active) return false;

      // Meal type filter (Breakfast / Lunch / Snacks / Dinner / Beverages)
      if (selectedMeal !== "all" && !matchesMealType(item, categoryMap, selectedMeal)) {
        return false;
      }

      // Canteen custom category filter
      if (selectedCategory !== "all" && item.category_id !== selectedCategory) {
        return false;
      }

      // Sliding Veg toggle
      if (isVegOnly && !item.is_veg) {
        return false;
      }

      // In-stock only filter
      if (inStockOnly && (!item.is_available || (item.stock !== null && item.stock <= 0))) {
        return false;
      }

      // Under ₹100 filter (10,000 paise)
      if (under100Only && item.price_paise > 10000) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDesc = item.description?.toLowerCase().includes(query) ?? false;
        const matchesCat = (item.category_id ? categoryMap.get(item.category_id) : "")?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesDesc && !matchesCat) {
          return false;
        }
      }

      return true;
    });
  }, [
    initialItems,
    selectedMeal,
    selectedCategory,
    isVegOnly,
    inStockOnly,
    under100Only,
    searchQuery,
    categoryMap,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedMeal !== "all" ||
    selectedCategory !== "all" ||
    isVegOnly ||
    inStockOnly ||
    under100Only;

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedMeal("all");
    setSelectedCategory("all");
    setIsVegOnly(false);
    setInStockOnly(false);
    setUnder100Only(false);
  }, []);

  const handleSlideCta = (mealTarget: MealType) => {
    setSelectedMeal(mealTarget);
    scrollToFoodSection();
  };

  return (
    <div className="space-y-6">
      {/* =========================================================================
          CATEGORY CIRCLES BAR ("Something for Every Craving" Style)
          ========================================================================= */}
      {/* =========================================================================
          CATEGORY SCROLL: ARCHITECTURAL HIGH-CONTRAST DARK BENTO CHIPS
          ========================================================================= */}
      <div
        ref={filterSectionRef}
        className="flex items-center -mx-4 px-4 overflow-x-auto no-scrollbar gap-2.5 pt-1 pb-1 select-none scroll-mt-3"
        aria-label="Something for Every Craving"
      >
        {MEAL_TABS.map((tab) => {
          const isSelected = selectedMeal === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={(e) => {
                setSelectedMeal(tab.id);
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                scrollToFoodSection();
              }}
              className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
              aria-label={`Filter by ${tab.label}`}
            >
              <div
                className={cn(
                  "w-14 h-14 rounded-2xl bg-[#1b1917] flex items-center justify-center p-2 text-2xl transition-all shadow-sm",
                  isSelected
                    ? "border-2 border-[#d9531e] text-[#d9531e] shadow-md shadow-[#1b1917]/25"
                    : "border border-[#36322e] hover:border-[#c2630d] text-[#f5efe4]"
                )}
              >
                <span className="filter drop-shadow">{tab.icon}</span>
              </div>
              <span
                className={cn(
                  "font-headline text-[11px] uppercase tracking-wider font-bold transition-colors",
                  isSelected ? "text-[#d9531e]" : "text-[#181513] dark:text-stone-300"
                )}
              >
                {tab.id === "all" ? "All" : tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          SECTION 1: HIGH-IMPACT FAST-CASUAL HERO BANNER (Smoked & Golden Style)
          ========================================================================= */}
      <section
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b1917] via-[#231f1d] to-[#141210] border border-[#36322e] text-[#f5efe4] shadow-md p-5 select-none"
        aria-label="Campus food highlights and subscriptions"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Ambient Radial Glow */}
        <div
          className="absolute -top-16 -left-16 w-48 h-48 bg-[#d9531e]/20 rounded-full blur-3xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Sliding Content Container */}
        <div className="relative z-10 flex flex-col justify-between min-h-[175px] space-y-3">
          <div className="max-w-[62%] sm:max-w-[68%] space-y-2">
            {/* Eyebrow badge */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#36322e] border border-[#e5891e]/40 text-[#e5891e] font-headline text-[11px] tracking-widest uppercase font-bold">
              <span>⚡</span>
              <span>{PROMO_SLIDES[currentSlide].badge}</span>
            </div>

            {/* Main headline */}
            <h3 className="font-headline text-2xl sm:text-[30px] font-bold text-[#f5efe4] uppercase leading-[0.95] tracking-tight">
              {PROMO_SLIDES[currentSlide].id === "homely-meals" ? (
                <>
                  FOOD THAT <br />
                  <span className="text-[#d9531e]">HITS THE SPOT</span>
                </>
              ) : (
                PROMO_SLIDES[currentSlide].title
              )}
            </h3>

            {/* Subtitle */}
            <p className="font-body text-[12px] text-[#ded5c4]/80 line-clamp-2 pt-0.5 font-medium leading-snug">
              {PROMO_SLIDES[currentSlide].subtitle}
            </p>
          </div>

          {/* CTA Button and Readiness badge */}
          <div className="pt-1 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleSlideCta(PROMO_SLIDES[currentSlide].mealTarget)}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#d9531e] to-[#ea642d] hover:from-[#bf4414] hover:to-[#d9531e] text-[#f5efe4] font-headline text-[13px] tracking-wider uppercase font-bold shadow-[0_4px_16px_rgba(217,83,30,0.45)] active:scale-95 transition-all cursor-pointer"
            >
              <span>{PROMO_SLIDES[currentSlide].ctaText}</span>
              <ArrowRight className="h-3.5 w-3.5 font-bold" />
            </button>

            <span className="font-headline text-[11px] uppercase tracking-wider text-[#ded5c4] font-bold px-2.5 py-1.5 rounded-lg bg-[#2e2926] border border-[#3d3834]">
              Station 3 Ready
            </span>
          </div>
        </div>

        {/* Spotlight Decorative Circular Dish Frame on the Right */}
        <div className="absolute -right-6 -bottom-6 w-36 h-36 sm:w-44 sm:h-44 rounded-full overflow-hidden shadow-2xl border-2 border-[#d9531e]/40 bg-[#1b1917] shrink-0 pointer-events-none">
          {slideImages[currentSlide] ? (
            <img
              src={slideImages[currentSlide]}
              alt={PROMO_SLIDES[currentSlide].title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-amber-950/60 to-black/80">
              {PROMO_SLIDES[currentSlide].emoji}
            </div>
          )}
        </div>

        {/* Dynamic Dot Indicators */}
        <div className="absolute top-3 right-3 flex items-center gap-1 z-20 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10">
          {PROMO_SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlide(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                idx === currentSlide ? "w-4 bg-[#ffb94e] shadow-xs" : "w-1.5 bg-white/40 hover:bg-white/70"
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: SEARCH BAR & SLIDING VEG TOGGLE SWITCH (ZOMATO STYLE)
          ========================================================================= */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#635e58] dark:text-stone-400 pointer-events-none" />
            <Input
              type="text"
              placeholder='Search "dosa, biryani, samosa, meals..."'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 pl-10 pr-9 text-sm font-medium bg-[#eae2d2] dark:bg-[#1e1a17] border-[#ded5c4] dark:border-[#352f2a] text-[#181513] dark:text-white placeholder:text-[#635e58]/80 dark:placeholder:text-stone-400 rounded-2xl shadow-2xs focus-visible:ring-[#d9531e]"
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

          {/* Smooth Sliding VEG Switch Toggle */}
          <div className="shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={isVegOnly}
              onClick={() => {
                setIsVegOnly((prev) => !prev);
                scrollToFoodSection();
              }}
              className={`min-h-[48px] h-12 px-3 rounded-2xl border transition-all duration-200 flex items-center gap-2 shadow-2xs cursor-pointer active:scale-95 select-none ${
                isVegOnly
                  ? "bg-emerald-500/15 border-emerald-500 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                  : "bg-[#eae2d2] dark:bg-[#1e1a17] border-[#ded5c4] dark:border-[#352f2a] text-[#635e58] dark:text-stone-400 hover:border-[#181513]/40"
              }`}
              aria-label="Toggle pure vegetarian filter"
            >
              <div className="flex flex-col text-left font-headline">
                <span className="text-[11px] font-bold tracking-wider leading-none">VEG</span>
                <span className="text-[9px] opacity-75 leading-tight">ONLY</span>
              </div>

              {/* Sliding Track & Thumb */}
              <div
                className={`relative h-6 w-11 rounded-full transition-colors duration-200 p-0.5 flex items-center ${
                  isVegOnly ? "bg-emerald-600" : "bg-[#ded5c4] dark:bg-stone-700"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-200 ease-out flex items-center justify-center ${
                    isVegOnly ? "translate-x-5" : "translate-x-0"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full transition-colors ${
                      isVegOnly ? "bg-emerald-600" : "bg-[#635e58]/50 dark:bg-stone-500"
                    }`}
                  />
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Smart Quick Filter Chips (In Stock, Under ₹100, Healthy Mode) */}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          <Link
            href="/healthy"
            prefetch={true}
            onClick={() => {
              startTransition("/healthy", "Healthy Mode");
            }}
            className="min-h-[36px] h-9 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs font-headline tracking-wide uppercase"
            aria-label="Healthy Mode & High-Protein Fuel"
          >
            <Leaf className="h-3.5 w-3.5" />
            <span>Healthy Mode</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setInStockOnly((prev) => !prev);
              scrollToFoodSection();
            }}
            className={`min-h-[36px] h-9 px-3.5 rounded-xl border text-xs font-headline uppercase tracking-wider font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              inStockOnly
                ? "bg-[#1b1917] border-[#36322e] text-[#e5891e] shadow-2xs"
                : "bg-[#eae2d2] dark:bg-[#1e1a17] border-[#ded5c4] dark:border-[#352f2a] text-[#635e58] dark:text-stone-300 hover:border-[#181513]/40"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${inStockOnly ? "bg-[#d9531e]" : "bg-emerald-500"}`} />
            <span>In Stock Only</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUnder100Only((prev) => !prev);
              scrollToFoodSection();
            }}
            className={`min-h-[36px] h-9 px-3.5 rounded-xl border text-xs font-headline uppercase tracking-wider font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              under100Only
                ? "bg-[#1b1917] border-[#36322e] text-[#e5891e] shadow-2xs"
                : "bg-[#eae2d2] dark:bg-[#1e1a17] border-[#ded5c4] dark:border-[#352f2a] text-[#635e58] dark:text-stone-300 hover:border-[#181513]/40"
            }`}
          >
            <span>💰</span>
            <span>Under ₹100</span>
          </button>

          {/* Quick reset button if any filter is active */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                handleResetFilters();
                scrollToFoodSection();
              }}
              className="min-h-[36px] h-9 px-3 rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1 cursor-pointer font-headline uppercase tracking-wider"
            >
              <X className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: BEST SELLERS / RECOMMENDED FOR YOU (When no search active)
          ========================================================================= */}
      {!hasActiveFilters && bestSellers.length >= 3 && (
        <section className="space-y-3" aria-labelledby="home-bestsellers-heading">
          <BestSellersRow
            bestSellers={bestSellers}
            onOpenDetail={(item) => setSelectedItem(item)}
          />
        </section>
      )}

      {/* =========================================================================
          SECTION 4: COMBO IT BETTER PROMO BANNER (Fast-Casual Style from Redesign)
          ========================================================================= */}
      <Link
        href="/menu"
        prefetch={true}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#1b1917] via-[#231f1d] to-[#141210] border border-[#36322e] p-4 sm:p-5 flex items-center justify-between shadow-lg shadow-black/15 transition-all select-none group block"
      >
        <div className="space-y-1 max-w-[72%] z-10">
          <div className="inline-flex items-center gap-1.5 text-[#e5891e] font-headline text-[11px] uppercase tracking-widest font-bold">
            <Flame className="h-3.5 w-3.5 text-[#d9531e]" />
            <span>COMBO IT BETTER</span>
          </div>
          <h3 className="font-headline text-lg sm:text-xl uppercase text-[#f5efe4] font-bold leading-tight">
            Meal + Drink = <span className="text-[#d9531e]">Save 20%</span>
          </h3>
          <p className="font-body text-[12px] text-[#ded5c4]/80 font-medium line-clamp-2">
            Pair any hot main dish with iced lemon tea or cold coffee.
          </p>
        </div>
        <div className="w-14 h-14 rounded-full bg-[#231f1d] border border-[#36322e] text-[#d9531e] flex items-center justify-center shrink-0 shadow-md text-2xl group-hover:scale-105 transition-transform">
          🍱
        </div>
      </Link>

      {/* =========================================================================
          SECTION 5: CATEGORIZED FOOD ITEMS LIST (Breakfast / Lunch / Snacks / etc.)
          ========================================================================= */}
      <section
        id="home-food-section"
        ref={foodItemsSectionRef}
        className="space-y-3.5 scroll-mt-4"
        aria-label="Available Food Items"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="font-headline text-[11px] uppercase tracking-widest text-[#a86822] dark:text-amber-500 font-bold block">
              CHEF SELECTION
            </span>
            <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-tight text-foreground dark:text-white font-headline">
              {selectedMeal === "all"
                ? "Today's Campus Picks"
                : `${MEAL_TABS.find((m) => m.id === selectedMeal)?.label} Menu`}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-headline text-[11px] uppercase tracking-wider text-[#ffb94e] font-bold px-2.5 py-1 rounded bg-[#181615] border border-[#362f2b]">
              Station A &amp; C
            </span>
            {isVegOnly && (
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                Veg Only
              </Badge>
            )}
          </div>
        </div>

        {/* Items List (Fast-Casual Cards with Smooth Filter Transition) */}
        {filteredItems.length > 0 ? (
          <div
            key={`${selectedMeal}-${isVegOnly}-${inStockOnly}-${under100Only}-${selectedCategory}`}
            className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out"
          >
            {filteredItems.map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                onOpenDetail={(it) => setSelectedItem(it)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/80 dark:border-[#352f2a] bg-muted/20 dark:bg-[#1a1614] p-8 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted dark:bg-[#25201c] text-muted-foreground dark:text-stone-400">
              <Utensils className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm text-foreground dark:text-white font-headline uppercase">
                No food items found
              </h3>
              <p className="text-xs text-muted-foreground dark:text-stone-400 max-w-xs mx-auto">
                No items match your active search or filters. Try resetting or selecting another category.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-primary text-primary-foreground dark:bg-[#FF385C] dark:hover:bg-[#FF453A] dark:text-white font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all cursor-pointer font-headline uppercase tracking-wider"
            >
              <X className="h-3.5 w-3.5" />
              Reset All Filters
            </button>
          </div>
        )}

        {/* Micro-interactive Reassurance Footnote matching redesign */}
        <div className="pt-3 pb-2 text-center">
          <p className="font-headline text-[11px] uppercase tracking-wider text-muted-foreground dark:text-stone-500">
            Freshly Made &bull; Quality Ingredients &bull; Campus Kitchen Curfew 9:30 PM
          </p>
        </div>
      </section>

      {/* Item Detail Sheet Modal (Calories, Ingredients, Reviews, Add to Cart) */}
      {selectedItem && (
        <ItemDetailSheet
          item={selectedItem}
          isOpen={Boolean(selectedItem)}
          onClose={() => setSelectedItem(null)}
        />
      )}

      {/* Floating Bottom Cart Shortcut Bar */}
      <CartShortcut
        menuItems={allPriceRefs}
        isDetailSheetOpen={Boolean(selectedItem)}
      />
    </div>
  );
}
