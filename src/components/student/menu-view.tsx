"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Search, X, SlidersHorizontal, UtensilsCrossed } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VoiceSearchButton } from "@/components/ui/voice-search-button";
import { MenuItemCard } from "@/components/student/menu-item-card";
import { ItemDetailSheet, type MenuItemData } from "@/components/student/item-detail-sheet";
import { BestSellersRow } from "@/components/student/best-sellers-row";
import { CartShortcut } from "@/components/student/cart-shortcut";
import { useCartStore } from "@/lib/cart-store";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import { SearchTakeover } from "@/components/student/search/search-takeover";
import type { FoodCategory } from "@/lib/search/categories";
import { matchesAliasWholeWord } from "@/lib/search/search-helpers";

export type CategoryData = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

interface MenuViewProps {
  categories: CategoryData[];
  initialItems: MenuItemData[];
  bestSellers?: BestSellerItem[];
}

export function MenuView({ categories, initialItems, bestSellers = [] }: MenuViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [vegFilter, setVegFilter] = useState<"all" | "veg" | "non-veg">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItemData | null>(null);
  const [activeCategoryTile, setActiveCategoryTile] = useState<FoodCategory | null>(null);

  // Full-screen Search Takeover State: initial state reads ?search=open synchronously to avoid cascading renders
  const [isTakeoverOpen, setIsTakeoverOpen] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        return params.get("search") === "open";
      } catch {
        return false;
      }
    }
    return false;
  });
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const searchBarContainerRef = useRef<HTMLDivElement>(null);

  const foodItemsSectionRef = useRef<HTMLDivElement>(null);
  const filterSectionRef = useRef<HTMLDivElement>(null);

  // Category map for fast name lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [categories]);

  // Clean URL parameter ?search=open immediately so page refresh never re-triggers the takeover unexpectedly
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("search") === "open") {
        params.delete("search");
        const newQuery = params.toString() ? `?${params.toString()}` : "";
        window.history.replaceState({}, "", window.location.pathname + newQuery);
      }
    } catch {
      // Ignore URL manipulation errors in restricted environments
    }
  }, []);

  const openTakeover = useCallback(() => {
    if (searchBarContainerRef.current) {
      setTriggerRect(searchBarContainerRef.current.getBoundingClientRect());
    }
    setIsTakeoverOpen(true);
  }, []);

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

  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const hasHydrated = useCartStore((s) => s.hasHydrated);
  const isCartShortcutVisible = hasHydrated && totalItemCount > 0 && !selectedItem;

  // Filter items:
  // - Note: is_active=false items are already excluded or hidden per requirement 10.
  const filteredItems = useMemo(() => {
    return initialItems.filter((item) => {
      // Must be active
      if (!item.is_active) return false;

      // Active category tile filter (applied from search takeover)
      if (activeCategoryTile) {
        const categoryName = item.category_id ? categoryMap.get(item.category_id) || "" : "";
        const name = item.name || "";
        const desc = item.description || "";
        const matchesTile = activeCategoryTile.aliases.some((alias) => {
          return (
            matchesAliasWholeWord(name, alias) ||
            matchesAliasWholeWord(desc, alias) ||
            matchesAliasWholeWord(categoryName, alias)
          );
        });
        if (!matchesTile) return false;
      }

      // Category filter
      if (selectedCategory !== "all" && item.category_id !== selectedCategory) {
        return false;
      }

      // Veg filter
      if (vegFilter === "veg" && !item.is_veg) return false;
      if (vegFilter === "non-veg" && item.is_veg) return false;

      // Available only filter
      if (availableOnly) {
        if (!item.is_available || (item.stock !== null && item.stock <= 0)) {
          return false;
        }
      }

      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDesc = item.description?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesDesc) {
          return false;
        }
      }

      return true;
    });
  }, [
    initialItems,
    selectedCategory,
    vegFilter,
    availableOnly,
    searchQuery,
    activeCategoryTile,
    categoryMap,
  ]);

  const hasActiveFilters =
    selectedCategory !== "all" ||
    vegFilter !== "all" ||
    availableOnly ||
    searchQuery.trim().length > 0 ||
    activeCategoryTile !== null;

  const resetFilters = useCallback(() => {
    setSelectedCategory("all");
    setSearchQuery("");
    setVegFilter("all");
    setAvailableOnly(false);
    setActiveCategoryTile(null);
    scrollToFoodSection();
  }, [scrollToFoodSection]);

  const handleSelectCategoryFromTakeover = useCallback(
    (category: FoodCategory) => {
      setActiveCategoryTile(category);
      setSearchQuery(""); // Clear plain text search when tile is picked
      scrollToFoodSection();
    },
    [scrollToFoodSection]
  );

  const handleSearchSubmitFromTakeover = useCallback(
    (text: string) => {
      setActiveCategoryTile(null); // Clear tile filter if explicit text search is submitted
      setSearchQuery(text);
      scrollToFoodSection();
    },
    [scrollToFoodSection]
  );

  return (
    <div className="space-y-4">
      {/* Search Bar (Tapping or focusing opens full-screen SearchTakeover) */}
      <div
        ref={searchBarContainerRef}
        onClick={openTakeover}
        className="relative cursor-pointer"
        role="search"
      >
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#181513] dark:text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          readOnly
          placeholder="Search items, snacks, drinks..."
          value={searchQuery}
          onFocus={openTakeover}
          className="h-11 pl-9 pr-16 text-sm font-semibold bg-card border-2 border-[#181513]/40 dark:border-border/80 text-[#181513] dark:text-white placeholder:text-[#181513]/70 dark:placeholder:text-slate-400 rounded-xl cursor-pointer"
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchQuery("");
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div onClick={(e) => e.stopPropagation()}>
            <VoiceSearchButton
              onSearch={(transcript) => {
                setSearchQuery(transcript);
                setActiveCategoryTile(null);
                scrollToFoodSection();
              }}
            />
          </div>
        </div>
      </div>

      {/* Dismissible Category Filter Chip: "Showing: Biryani" */}
      {activeCategoryTile && (
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary animate-in fade-in duration-150">
          <span className="text-xs font-bold font-headline uppercase tracking-wider flex items-center gap-1.5">
            <span>Showing:</span>
            <span className="underline decoration-2">{activeCategoryTile.label}</span>
          </span>
          <button
            type="button"
            onClick={() => setActiveCategoryTile(null)}
            className="flex items-center gap-1 text-xs font-bold hover:underline cursor-pointer"
            aria-label={`Clear ${activeCategoryTile.label} filter`}
          >
            <span>Clear</span>
            <X className="h-3.5 w-3.5 stroke-[2.5]" />
          </button>
        </div>
      )}

      {/* Filter Row: Veg / Non-Veg segmented control + Available only toggle */}
      <div className="flex items-center justify-between gap-2 text-xs">
        {/* Veg / Non-Veg Chips */}
        <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => {
              setVegFilter("all");
              scrollToFoodSection();
            }}
            className={`min-h-[36px] rounded-md px-3 font-medium transition-colors ${
              vegFilter === "all"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => {
              setVegFilter("veg");
              scrollToFoodSection();
            }}
            className={`min-h-[36px] flex items-center gap-1 rounded-md px-3 font-medium transition-colors ${
              vegFilter === "veg"
                ? "bg-card text-emerald-700 dark:text-emerald-400 shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-600 inline-block" />
            Veg
          </button>
          <button
            type="button"
            onClick={() => {
              setVegFilter("non-veg");
              scrollToFoodSection();
            }}
            className={`min-h-[36px] flex items-center gap-1 rounded-md px-3 font-medium transition-colors ${
              vegFilter === "non-veg"
                ? "bg-card text-red-700 dark:text-red-400 shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-red-600 inline-block" />
            Non-Veg
          </button>
        </div>

        {/* Available only toggle button */}
        <button
          type="button"
          onClick={() => {
            setAvailableOnly(!availableOnly);
            scrollToFoodSection();
          }}
          className={`min-h-[36px] flex items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors ${
            availableOnly
              ? "border-primary bg-primary/10 text-primary font-semibold"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>In Stock Only</span>
        </button>
      </div>

      {/* Best Sellers Row: shown only when no search or filter is active and >= 3 items returned */}
      {!hasActiveFilters && bestSellers.length >= 3 && (
        <BestSellersRow
          bestSellers={bestSellers}
          onOpenDetail={(item) => setSelectedItem(item)}
        />
      )}

      {/* Horizontal Category Scroll Tabs */}
      <div
        ref={filterSectionRef}
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1 scroll-mt-3"
      >
        <button
          type="button"
          onClick={(e) => {
            setSelectedCategory("all");
            e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            scrollToFoodSection();
          }}
          className={`min-h-[38px] shrink-0 rounded-full px-4 text-xs font-semibold transition-all ${
            selectedCategory === "all"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "border border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          }`}
        >
          All Items ({initialItems.filter((i) => i.is_active).length})
        </button>
        {categories.map((cat) => {
          const count = initialItems.filter(
            (i) => i.is_active && i.category_id === cat.id
          ).length;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={(e) => {
                setSelectedCategory(cat.id);
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                scrollToFoodSection();
              }}
              className={`min-h-[38px] shrink-0 rounded-full px-4 text-xs font-semibold transition-all ${
                selectedCategory === cat.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-border/80 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {cat.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Results Count & active filter feedback */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>
          Showing {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-primary hover:underline font-medium"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Item List */}
      {filteredItems.length > 0 ? (
        <div
          ref={foodItemsSectionRef}
          key={`${selectedCategory}-${vegFilter}-${availableOnly}`}
          className={`space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out scroll-mt-4 ${isCartShortcutVisible ? "pb-20" : ""}`}
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
        /* Empty State */
        <div className={`rounded-2xl border border-dashed border-border/80 bg-muted/20 py-12 px-4 text-center space-y-3 ${isCartShortcutVisible ? "pb-20" : ""}`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-base">No items found</h3>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              We couldn&apos;t find any items matching your current filters or search query.
            </p>
          </div>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="mt-2 text-xs"
            >
              Reset Filters
            </Button>
          )}
        </div>
      )}

      {/* Detail Sheet */}
      <ItemDetailSheet
        item={selectedItem}
        isOpen={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
      />

      {/* Full-Screen Search Takeover: FLIP Glide, What's on your mind Grid & Recent Searches */}
      <SearchTakeover
        isOpen={isTakeoverOpen}
        onClose={() => setIsTakeoverOpen(false)}
        items={initialItems}
        categoryMap={categoryMap}
        onSelectCategory={handleSelectCategoryFromTakeover}
        onSearchSubmit={handleSearchSubmitFromTakeover}
        onOpenItem={(item) => setSelectedItem(item)}
        triggerRect={triggerRect}
        initialQuery={searchQuery}
      />

      {/* Floating 1-tap Cart Shortcut (visible on menu when cart has items) */}
      <CartShortcut
        menuItems={initialItems}
        isDetailSheetOpen={Boolean(selectedItem) || isTakeoverOpen}
      />
    </div>
  );
}
