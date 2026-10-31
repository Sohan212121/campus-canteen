"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Utensils,
  ArrowRight,
  Leaf,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MenuItemCard } from "@/components/student/menu-item-card";
import { ItemDetailSheet, type MenuItemData } from "@/components/student/item-detail-sheet";
import { BestSellersRow } from "@/components/student/best-sellers-row";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { type MenuItemPriceRef, registerMenuItemPrices } from "@/lib/cart-shortcut";
import type { BestSellerItem } from "@/server/actions/best-sellers";

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
          SECTION 1: AUTO-TRANSITIONING PROMO CAROUSEL (Right-to-Left Sliding)
          ========================================================================= */}
      <section
        className="relative overflow-hidden rounded-3xl shadow-md border border-border/60"
        aria-label="Campus food highlights and subscriptions"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Sliding Slides Track (transform: translateX(-N * 100%)) */}
        <div
          className="flex transition-transform duration-700 ease-out will-change-transform"
          style={{ transform: `translateX(-${currentSlide * 100}%)` }}
        >
          {PROMO_SLIDES.map((slide) => (
            <div
              key={slide.id}
              className={`w-full shrink-0 min-h-[220px] sm:min-h-[240px] bg-gradient-to-br ${slide.gradient} text-white p-5 sm:p-6 flex flex-col justify-between relative overflow-hidden`}
            >
              {/* Background ambient circular glow */}
              <div
                className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/10 blur-2xl pointer-events-none"
                aria-hidden="true"
              />
              <div
                className="absolute -left-12 -bottom-12 h-44 w-44 rounded-full bg-black/20 blur-xl pointer-events-none"
                aria-hidden="true"
              />

              {/* Slide Top Row: Badge & Large Food Emoji Graphic */}
              <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-[11px] font-black uppercase tracking-wider text-white shadow-2xs">
                  <span>{slide.badgeIcon}</span>
                  <span>{slide.badge}</span>
                </div>
                <div className="text-4xl sm:text-5xl filter drop-shadow-md animate-bounce duration-1000 select-none">
                  {slide.emoji}
                </div>
              </div>

              {/* Slide Middle: Headline & Tagline */}
              <div className="space-y-1.5 my-2 relative z-10">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight text-white drop-shadow-sm leading-tight">
                  {slide.title}
                </h3>
                <p className="text-xs sm:text-sm text-white/85 line-clamp-2 leading-relaxed max-w-md">
                  {slide.subtitle}
                </p>
                <div className="inline-flex items-center text-[11px] font-semibold text-white/90 bg-black/20 px-2.5 py-0.5 rounded-lg backdrop-blur-xs">
                  <span>{slide.highlight}</span>
                </div>
              </div>

              {/* Slide Bottom Row: CTA Button */}
              <div className="relative z-10 pt-1">
                <button
                  type="button"
                  onClick={() => handleSlideCta(slide.mealTarget)}
                  className="min-h-[44px] h-10 px-4 rounded-xl font-bold text-xs bg-white text-zinc-950 hover:bg-white/90 active:scale-95 transition-all shadow-md inline-flex items-center gap-2 group cursor-pointer"
                >
                  <span>{slide.ctaText}</span>
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Carousel Navigation Chevron Arrows */}
        <button
          type="button"
          onClick={() => setCurrentSlide((prev) => (prev - 1 + PROMO_SLIDES.length) % PROMO_SLIDES.length)}
          className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-xs border border-white/10 active:scale-90 transition-all z-20 cursor-pointer"
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCurrentSlide((prev) => (prev + 1) % PROMO_SLIDES.length)}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-xs border border-white/10 active:scale-90 transition-all z-20 cursor-pointer"
          aria-label="Next slide"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Dynamic Dot Indicators (Active dot extends smoothly) */}
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20 bg-black/30 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
          {PROMO_SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                idx === currentSlide ? "w-6 bg-white shadow-xs" : "w-2 bg-white/40 hover:bg-white/70"
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
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder='Search "dosa, biryani, samosa, meals..."'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 pl-10 pr-9 text-sm font-medium bg-card border-border/80 rounded-2xl shadow-2xs focus-visible:ring-primary"
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

          {/* Smooth Sliding VEG Switch Toggle (Matching Zomato's Top-Right Toggle) */}
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
                  ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-800 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                  : "bg-card border-border/80 text-muted-foreground hover:border-foreground/30"
              }`}
              aria-label="Toggle pure vegetarian filter"
            >
              <div className="flex flex-col text-left">
                <span className="text-[11px] font-black tracking-wider leading-none">VEG</span>
                <span className="text-[9px] opacity-75 leading-tight">ONLY</span>
              </div>

              {/* Sliding Track & Thumb */}
              <div
                className={`relative h-6 w-11 rounded-full transition-colors duration-200 p-0.5 flex items-center ${
                  isVegOnly ? "bg-emerald-600" : "bg-muted-foreground/30"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-200 ease-out flex items-center justify-center ${
                    isVegOnly ? "translate-x-5" : "translate-x-0"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full transition-colors ${
                      isVegOnly ? "bg-emerald-600" : "bg-muted-foreground/50"
                    }`}
                  />
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* =========================================================================
            SECTION 3: MEAL TABS (Breakfast, Lunch, Snacks, Dinner, All, Beverages)
            ========================================================================= */}
        <div
          ref={filterSectionRef}
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 scroll-mt-3"
        >
          {MEAL_TABS.map((tab) => {
            const count = initialItems.filter((i) => i.is_active && matchesMealType(i, categoryMap, tab.id)).length;
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
                className={`min-h-[44px] shrink-0 rounded-2xl px-3.5 py-2 text-xs font-bold transition-all duration-200 flex items-center gap-2 border cursor-pointer active:scale-95 ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-xs ring-1 ring-primary/30"
                    : "bg-card border-border/80 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <span className="text-sm select-none">{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                    isSelected ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Smart Quick Filter Chips (In Stock, Under ₹100, Fast Prep, Healthy Mode) */}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          <Link
            href="/healthy"
            prefetch={true}
            className="min-h-[36px] h-9 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-xs"
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
            className={`min-h-[36px] h-9 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              inStockOnly
                ? "bg-primary/10 border-primary text-primary shadow-2xs"
                : "bg-card border-border/80 text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${inStockOnly ? "bg-primary" : "bg-emerald-500"}`} />
            <span>In Stock Only</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUnder100Only((prev) => !prev);
              scrollToFoodSection();
            }}
            className={`min-h-[36px] h-9 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              under100Only
                ? "bg-primary/10 border-primary text-primary shadow-2xs"
                : "bg-card border-border/80 text-muted-foreground hover:text-foreground"
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
              className="min-h-[36px] h-9 px-3 rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <X className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </section>

      {/* =========================================================================
          SECTION 4: BEST SELLERS / RECOMMENDED FOR YOU (When no search active)
          ========================================================================= */}
      {!hasActiveFilters && bestSellers.length >= 3 && (
        <section className="space-y-3" aria-labelledby="home-bestsellers-heading">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <TrendingUp className="h-4 w-4" />
              </div>
              <h2 id="home-bestsellers-heading" className="text-base font-bold tracking-tight">
                Recommended For You
              </h2>
            </div>
            <Link
              href="/menu"
              className="text-xs font-semibold text-primary hover:underline flex min-h-[44px] items-center gap-1"
            >
              View Full Menu <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <BestSellersRow
            bestSellers={bestSellers}
            onOpenDetail={(item) => setSelectedItem(item)}
          />
        </section>
      )}

      {/* =========================================================================
          SECTION 5: CATEGORIZED FOOD ITEMS LIST (Breakfast / Lunch / Snacks / etc.)
          ========================================================================= */}
      <section
        id="home-food-section"
        ref={foodItemsSectionRef}
        className="space-y-3 scroll-mt-4"
        aria-label="Available Food Items"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">
              {selectedMeal === "all"
                ? "All Canteen Items"
                : `${MEAL_TABS.find((m) => m.id === selectedMeal)?.label} Menu`}
            </h2>
            <span className="text-xs text-muted-foreground font-semibold">
              ({filteredItems.length})
            </span>
          </div>

          {isVegOnly && (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
              Veg Only
            </Badge>
          )}
        </div>

        {/* Items List (Full Width Cards with Smooth Filter Transition) */}
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
          <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-8 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Utensils className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm">No food items found</h3>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                No items match your active search or filters. Try resetting or selecting another category.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Reset All Filters
            </button>
          </div>
        )}
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
