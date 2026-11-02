"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Utensils,
  ArrowRight,
  Leaf,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VoiceSearchButton } from "@/components/ui/voice-search-button";
import { cn } from "@/lib/utils";
import { MenuItemCard } from "@/components/student/menu-item-card";
import { ItemDetailSheet, type MenuItemData } from "@/components/student/item-detail-sheet";
import { BestSellersRow } from "@/components/student/best-sellers-row";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { type MenuItemPriceRef, registerMenuItemPrices } from "@/lib/cart-shortcut";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";
import { SearchTakeover } from "@/components/student/search/search-takeover";
import type { FoodCategory } from "@/lib/search/categories";
import { matchesAliasWholeWord } from "@/lib/search/search-helpers";

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
  const [activeCategoryTile, setActiveCategoryTile] = useState<FoodCategory | null>(null);

  // Search Takeover states
  const [isTakeoverOpen, setIsTakeoverOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const searchBarContainerRef = useRef<HTMLDivElement>(null);

  const openTakeover = useCallback(() => {
    if (searchBarContainerRef.current) {
      setTriggerRect(searchBarContainerRef.current.getBoundingClientRect());
    }
    setIsTakeoverOpen(true);
  }, []);

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

  // Auto-transition interval: advances every 2.2 seconds (smooth right-to-left slide)
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % PROMO_SLIDES.length);
    }, 2200);

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

      // Active category tile alias matching from SearchTakeover
      if (activeCategoryTile) {
        const catName = (item.category_id ? categoryMap.get(item.category_id) : "") || "";
        const matchesAlias = activeCategoryTile.aliases.some((alias) =>
          matchesAliasWholeWord(item.name, alias) ||
          (item.description ? matchesAliasWholeWord(item.description, alias) : false) ||
          (catName ? matchesAliasWholeWord(catName, alias) : false)
        );
        if (!matchesAlias) {
          return false;
        }
      }

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
    activeCategoryTile,
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
    activeCategoryTile !== null ||
    selectedMeal !== "all" ||
    selectedCategory !== "all" ||
    isVegOnly ||
    inStockOnly ||
    under100Only;

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setActiveCategoryTile(null);
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
              className="group flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
              aria-label={`Filter by ${tab.label}`}
            >
              <div
                className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center p-2 text-2xl transition-all shadow-xs relative",
                  isSelected
                    ? "bg-white dark:bg-[#1E2230] border-2 border-[#DC2626] dark:border-[#EF4444] shadow-md shadow-[#DC2626]/20 dark:shadow-[#EF4444]/25 scale-105"
                    : "bg-white dark:bg-[#1E2230] border border-black/20 dark:border-white/20 hover:border-[#DC2626]/50 hover:bg-[#FAF8F5] dark:hover:bg-[#252A3B] hover:shadow-xs"
                )}
              >
                <span className="filter drop-shadow-xs transition-transform duration-200 group-hover:scale-110">{tab.icon}</span>
                {isSelected && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#DC2626] dark:bg-[#EF4444] border-2 border-white dark:border-[#090A0F]" />
                )}
              </div>
              <span
                className={cn(
                  "font-headline text-[11px] uppercase tracking-wider font-bold transition-colors",
                  isSelected
                    ? "text-[#DC2626] dark:text-[#EF4444] font-black"
                    : "text-[#635e58] dark:text-slate-400 group-hover:text-[#181513] dark:group-hover:text-white"
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
          Visible Right-to-Left Sliding Window Carousel
          ========================================================================= */}
      <section
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b1917] via-[#231f1d] to-[#141210] dark:from-[#16171E] dark:via-[#101117] dark:to-[#0A0A0E] border border-[#36322e] dark:border-[#262836] text-[#f5efe4] shadow-md dark:shadow-2xl select-none"
        aria-label="Campus food highlights and subscriptions"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Ambient Radial Glow */}
        <div
          className="absolute -top-16 -left-16 w-48 h-48 bg-[#d9531e]/20 dark:bg-[#F59E0B]/10 rounded-full blur-3xl pointer-events-none z-10"
          aria-hidden="true"
        />

        {/* Dynamic Dot Indicators (Top-right corner) */}
        <div className="absolute top-4 right-4 flex items-center gap-1 z-20 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10 dark:bg-[#090A0F]/90 dark:border-[#262836]">
          {PROMO_SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlide(idx)}
              className={`h-1.5 rounded-full transition-all duration-200 cursor-pointer ${
                idx === currentSlide
                  ? "w-4 bg-[#ffb94e] dark:bg-[#FBBF24] shadow-xs"
                  : "w-1.5 bg-white/40 dark:bg-slate-600 hover:bg-white/70"
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>

        {/* Sliding Horizontal Track Window (Glides smoothly from right to left) */}
        <div
          className="flex w-full transition-transform duration-350 ease-out will-change-transform"
          style={{ transform: `translateX(-${currentSlide * 100}%)` }}
        >
          {PROMO_SLIDES.map((slide, idx) => (
            <div
              key={slide.id}
              className="min-w-full w-full shrink-0 relative px-6 py-6 sm:px-7 sm:py-7 flex flex-col justify-between min-h-[210px] sm:min-h-[235px] overflow-hidden"
            >
              {/* Slide Content: Left Text & CTA */}
              <div className="relative z-10 flex flex-col justify-between h-full space-y-4">
                <div className="max-w-[60%] sm:max-w-[66%] space-y-2.5 pt-1">
                  {/* Main headline */}
                  <h3 className="font-headline text-2xl sm:text-[30px] font-bold text-[#f5efe4] dark:text-white uppercase leading-[1.0] tracking-tight font-display">
                    {slide.id === "homely-meals" ? (
                      <>
                        FOOD THAT <br />
                        <span className="text-[#d9531e] dark:text-[#FBBF24] dark:drop-shadow-sm">HITS THE SPOT</span>
                      </>
                    ) : (
                      slide.title
                    )}
                  </h3>

                  {/* Subtitle */}
                  <p className="font-body text-[12px] sm:text-[13px] text-[#ded5c4]/80 dark:text-slate-300 line-clamp-2 pt-0.5 font-medium leading-relaxed">
                    {slide.subtitle}
                  </p>
                </div>

                {/* CTA Button */}
                <div className="pt-2 pb-0.5 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleSlideCta(slide.mealTarget)}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#d9531e] to-[#ea642d] dark:from-[#FBBF24] dark:to-[#F59E0B] hover:from-[#bf4414] hover:to-[#d9531e] dark:hover:brightness-110 text-[#f5efe4] dark:text-[#090A0F] font-headline text-[13px] tracking-wider uppercase font-bold dark:font-black shadow-[0_4px_16px_rgba(217,83,30,0.45)] dark:shadow-[#FBBF24]/25 active:scale-95 transition-all cursor-pointer"
                  >
                    <span>{slide.ctaText}</span>
                    <ArrowRight className="h-3.5 w-3.5 font-bold" />
                  </button>
                </div>
              </div>

              {/* Spotlight Decorative Circular Dish Frame on the Right (moves synchronously with this slide) */}
              <div className="absolute -right-5 -bottom-5 w-40 h-40 sm:w-50 sm:h-50 rounded-full overflow-hidden shadow-2xl border-2 border-[#d9531e]/40 dark:border-[#F59E0B]/50 bg-[#1b1917] dark:bg-[#090A0F] shrink-0 pointer-events-none">
                {slideImages[idx] ? (
                  <img
                    src={slideImages[idx]}
                    alt={slide.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-amber-950/60 to-black/80">
                    {slide.emoji}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: SEARCH BAR & SLIDING VEG TOGGLE SWITCH (ZOMATO STYLE)
          ========================================================================= */}
      <section className="space-y-3">
        <div className="flex items-center gap-2.5">
          {/* Search Box */}
          <div ref={searchBarContainerRef} className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#181513] dark:text-slate-300 pointer-events-none" />
            <Input
              type="text"
              readOnly
              placeholder='Search "dosa, biryani, samosa, meals..."'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={openTakeover}
              onFocus={openTakeover}
              className="h-12 pl-10 pr-16 text-sm font-semibold bg-[#eae2d2] dark:bg-[#121319] border border-[#181513]/25 dark:border-[#222533] text-[#181513] dark:text-white placeholder:text-[#181513]/70 dark:placeholder:text-slate-400 rounded-2xl shadow-2xs focus-visible:ring-[#181513] focus-visible:dark:ring-[#FBBF24] cursor-pointer"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <VoiceSearchButton
                onSearch={(transcript) => {
                  setSearchQuery(transcript);
                  scrollToFoodSection();
                }}
              />
            </div>
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
                  ? "bg-black border-red-500 text-white ring-1 ring-red-500/40 shadow-sm shadow-red-500/30"
                  : "bg-black border-[#222533] text-slate-300 hover:border-red-500/50"
              }`}
              aria-label="Toggle pure vegetarian filter"
            >
              <div className="flex flex-col text-left font-headline">
                <span className={`text-[11px] font-bold tracking-wider leading-none transition-colors ${isVegOnly ? "text-red-500 font-black" : "text-white"}`}>
                  VEG
                </span>
                <span className={`text-[9px] leading-tight transition-colors ${isVegOnly ? "text-red-400 font-bold" : "text-red-500"}`}>
                  ONLY
                </span>
              </div>

              {/* Sliding Track & Thumb */}
              <div
                className={`relative h-6 w-11 rounded-full transition-colors duration-200 p-0.5 flex items-center ${
                  isVegOnly ? "bg-red-600 shadow-inner" : "bg-[#222533] border border-[#333]"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ease-out flex items-center justify-center ${
                    isVegOnly ? "translate-x-5" : "translate-x-0"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full transition-colors ${
                      isVegOnly ? "bg-red-600" : "bg-neutral-600"
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
            className="min-h-[36px] h-9 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs font-headline tracking-wide uppercase border-2 border-emerald-900/40"
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
            className={`min-h-[36px] h-9 px-3.5 rounded-xl border-2 text-xs font-headline uppercase tracking-wider font-extrabold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              inStockOnly
                ? "bg-[#1b1917] dark:bg-[#1C1F2B] border-[#181513] dark:border-[#FBBF24] text-[#d97706] dark:text-[#FBBF24] shadow-xs"
                : "bg-[#eae2d2] dark:bg-[#121319] border-[#181513]/40 dark:border-[#222533] text-[#181513] dark:text-slate-100 hover:border-[#181513]"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${inStockOnly ? "bg-[#d97706] dark:bg-[#FBBF24]" : "bg-emerald-600"}`} />
            <span>In Stock Only</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUnder100Only((prev) => !prev);
              scrollToFoodSection();
            }}
            className={`min-h-[36px] h-9 px-3.5 rounded-xl border-2 text-xs font-headline uppercase tracking-wider font-extrabold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              under100Only
                ? "bg-[#1b1917] dark:bg-[#1C1F2B] border-[#181513] dark:border-[#FBBF24] text-[#d97706] dark:text-[#FBBF24] shadow-xs"
                : "bg-[#eae2d2] dark:bg-[#121319] border-[#181513]/40 dark:border-[#222533] text-[#181513] dark:text-slate-100 hover:border-[#181513]"
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
              className="min-h-[36px] h-9 px-3 rounded-xl border-2 border-red-600/50 bg-red-600/10 hover:bg-red-600/20 text-red-700 dark:text-red-400 text-xs font-headline uppercase tracking-wider font-black transition-all flex items-center gap-1 cursor-pointer active:scale-95"
            >
              <X className="h-3.5 w-3.5 stroke-[3]" />
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
          SECTION 4: CATEGORIZED FOOD ITEMS LIST (Breakfast / Lunch / Snacks / etc.)
          ========================================================================= */}
      <section
        id="home-food-section"
        ref={foodItemsSectionRef}
        className="space-y-3.5 scroll-mt-4"
        aria-label="Available Food Items"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="font-headline text-[10px] uppercase tracking-widest text-[#a86822] dark:text-[#FBBF24] font-black block font-sans">
              CHEF SELECTION
            </span>
            <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-tight text-foreground dark:text-white font-headline dark:font-display">
              {selectedMeal === "all"
                ? "Today's Campus Picks"
                : `${MEAL_TABS.find((m) => m.id === selectedMeal)?.label} Menu`}
            </h2>
          </div>

          {isVegOnly && (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
              Veg Only
            </Badge>
          )}
        </div>

        {/* Dismissible category tile filter chip from SearchTakeover */}
        {activeCategoryTile && (
          <div className="flex items-center gap-2 pt-1 pb-1">
            <span className="text-xs font-semibold text-muted-foreground">Showing:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[#EA580C]/10 text-[#EA580C] dark:bg-[#EA580C]/20 border border-[#EA580C]/30 shadow-2xs">
              <span>{activeCategoryTile.label}</span>
              <button
                type="button"
                onClick={() => setActiveCategoryTile(null)}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/20 transition-colors cursor-pointer"
                aria-label={`Clear ${activeCategoryTile.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

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

      {/* Full-Screen Search Takeover Dialog (FLIP animated, zero logo transition) */}
      <SearchTakeover
        isOpen={isTakeoverOpen}
        onClose={() => setIsTakeoverOpen(false)}
        items={initialItems}
        initialQuery={searchQuery}
        triggerRect={triggerRect}
        onSelectCategory={(category) => {
          setIsTakeoverOpen(false);
          setActiveCategoryTile(category);
          scrollToFoodSection();
        }}
        onSearchSubmit={(term: string) => {
          setIsTakeoverOpen(false);
          setSearchQuery(term);
          scrollToFoodSection();
        }}
        onOpenItem={(dish) => {
          setSelectedItem(dish);
        }}
      />
    </div>
  );
}
