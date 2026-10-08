"use client";

import { useState, useMemo } from "react";
import { Search, X, SlidersHorizontal, UtensilsCrossed } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MenuItemCard } from "@/components/student/menu-item-card";
import { ItemDetailSheet, type MenuItemData } from "@/components/student/item-detail-sheet";

export type CategoryData = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

interface MenuViewProps {
  categories: CategoryData[];
  initialItems: MenuItemData[];
}

export function MenuView({ categories, initialItems }: MenuViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [vegFilter, setVegFilter] = useState<"all" | "veg" | "non-veg">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItemData | null>(null);

  // Filter items:
  // - Note: is_active=false items are already excluded or hidden per requirement 10.
  const filteredItems = useMemo(() => {
    return initialItems.filter((item) => {
      // Must be active
      if (!item.is_active) return false;

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
  }, [initialItems, selectedCategory, vegFilter, availableOnly, searchQuery]);

  const hasActiveFilters =
    selectedCategory !== "all" ||
    vegFilter !== "all" ||
    availableOnly ||
    searchQuery.trim().length > 0;

  const resetFilters = () => {
    setSelectedCategory("all");
    setSearchQuery("");
    setVegFilter("all");
    setAvailableOnly(false);
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search items, snacks, drinks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-11 pl-9 pr-9 text-sm bg-card border-border/80 rounded-xl"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Filter Row: Veg / Non-Veg segmented control + Available only toggle */}
      <div className="flex items-center justify-between gap-2 text-xs">
        {/* Veg / Non-Veg Chips */}
        <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setVegFilter("all")}
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
            onClick={() => setVegFilter("veg")}
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
            onClick={() => setVegFilter("non-veg")}
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
          onClick={() => setAvailableOnly(!availableOnly)}
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

      {/* Horizontal Category Scroll Tabs */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
        <button
          type="button"
          onClick={() => setSelectedCategory("all")}
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
              onClick={() => setSelectedCategory(cat.id)}
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
        <div className="space-y-3">
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
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 py-12 px-4 text-center space-y-3">
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
    </div>
  );
}
