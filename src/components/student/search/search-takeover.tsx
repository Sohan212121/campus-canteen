"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft, Search, X, Clock, Sparkles, Utensils } from "lucide-react";

import { Input } from "@/components/ui/input";
import { VoiceSearchButton } from "@/components/ui/voice-search-button";
import { VegIndicator } from "@/components/student/veg-indicator";
import type { MenuItemData } from "@/components/student/item-detail-sheet";
import { formatPaise } from "@/lib/money";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

import {
  FOOD_CATEGORIES,
  type FoodCategory,
} from "@/lib/search/categories";
import {
  matchCategoryItems,
  getSortedCategoryTiles,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  getSearchSuggestions,
  type SearchSuggestion,
} from "@/lib/search/search-helpers";
import { DEV_SAMPLE_ITEMS } from "@/lib/search/sample-data";
import { CategoryTile } from "./category-tile";

export interface SearchTakeoverProps {
  isOpen: boolean;
  onClose: () => void;
  items: MenuItemData[];
  categoryMap?: Map<string, string>;
  onSelectCategory: (category: FoodCategory) => void;
  onSearchSubmit: (query: string) => void;
  onOpenItem?: (item: MenuItemData) => void;
  triggerRect?: DOMRect | null;
  initialQuery?: string;
  stayOnCurrentPage?: boolean;
}

export function SearchTakeover({
  isOpen,
  onClose,
  items,
  categoryMap,
  onSelectCategory,
  onSearchSubmit,
  onOpenItem,
  triggerRect,
  initialQuery = "",
  stayOnCurrentPage = false,
}: SearchTakeoverProps) {
  const router = useRouter();
  const pathname = usePathname();
  const prefersReducedMotion = usePrefersReducedMotion();

  // Search input state: initialized directly so no cascading render occurs on mount
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    typeof window !== "undefined" ? loadRecentSearches() : []
  );
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  // Missing dish inline polite notice state
  const [unmatchedNotice, setUnmatchedNotice] = useState<{
    categoryLabel: string;
    timestamp: number;
  } | null>(null);
  const [shakingCategoryId, setShakingCategoryId] = useState<string | null>(null);

  // Development sample data toggle
  const [useSampleData, setUseSampleData] = useState(false);

  // DOM and animation references
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const micBtnRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const historyPushedRef = useRef(false);

  // Effective items (incorporating dev sample switch if active in non-production)
  const effectiveItems = useMemo(() => {
    if (process.env.NODE_ENV !== "production" && useSampleData) {
      return [...items, ...DEV_SAMPLE_ITEMS];
    }
    return items;
  }, [items, useSampleData]);

  // Debounce query for live suggestions (~150ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setActiveSuggestionIndex(-1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Sorted category tiles: categories with real dishes first!
  const sortedTiles = useMemo(() => {
    return getSortedCategoryTiles(FOOD_CATEGORIES, effectiveItems, categoryMap);
  }, [effectiveItems, categoryMap]);

  // Live suggestions (up to 6 items)
  const suggestions = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return getSearchSuggestions(effectiveItems, FOOD_CATEGORIES, debouncedQuery, 6);
  }, [effectiveItems, debouncedQuery]);

  // Curated suggested food items with name & image
  const suggestedDishes = useMemo(() => {
    return effectiveItems
      .filter((dish) => dish.is_active && dish.is_available)
      .slice(0, 6);
  }, [effectiveItems]);

  // Safe close handler that dismisses takeover and returns to the home screen
  const handleSafeClose = useCallback(() => {
    // 1. Immediately invoke onClose to close/unmount the takeover dialog
    onClose();

    // 2. Clear query & suggestions
    setQuery("");
    setDebouncedQuery("");
    setActiveSuggestionIndex(-1);

    // 3. Immediately restore body scrolling and remove takeover attribute
    if (typeof document !== "undefined") {
      document.body.removeAttribute("data-search-takeover-open");
      document.body.style.overflow = "";
    }

    // 4. Clean up the history entry if one was pushed
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      try {
        window.history.back();
      } catch {
        // Fallback ignore
      }
    }

    // 5. Always ensure the user returns/redirects to the home screen ("/") unless stayOnCurrentPage is true
    if (!stayOnCurrentPage) {
      if (pathname !== "/") {
        router.push("/");
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }, [onClose, pathname, router, stayOnCurrentPage]);

  // Body scroll lock & data-search-takeover-open attribute management
  useEffect(() => {
    if (!isOpen) return;

    // Set body attributes
    document.body.setAttribute("data-search-takeover-open", "true");
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Manage single history entry so browser Back dismisses takeover without leaving the page
    if (!historyPushedRef.current) {
      try {
        window.history.pushState({ searchTakeover: true }, "");
        historyPushedRef.current = true;
      } catch {
        // Ignore pushState errors in restricted environments
      }
    }

    const handlePopState = () => {
      // If user hit browser Back
      historyPushedRef.current = false;
      onClose();
      if (typeof document !== "undefined") {
        document.body.removeAttribute("data-search-takeover-open");
        document.body.style.overflow = "";
      }
      if (!stayOnCurrentPage && window.location.pathname !== "/") {
        router.push("/");
      }
    };

    window.addEventListener("popstate", handlePopState);

    // Auto-focus the search input
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("popstate", handlePopState);
      document.body.removeAttribute("data-search-takeover-open");
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose, router, stayOnCurrentPage]);

  // FLIP animation: measure source bar rect and smoothly shift search box from old position to top slot
  useEffect(() => {
    const searchBoxEl = searchBoxRef.current;
    const backBtnEl = backBtnRef.current;
    const micBtnEl = micBtnRef.current;
    const mainEl = mainContentRef.current;

    if (!isOpen || prefersReducedMotion || !triggerRect || !searchBoxEl) return;

    const targetRect = searchBoxEl.getBoundingClientRect();
    const deltaY = triggerRect.top - targetRect.top;
    const deltaX = triggerRect.left - targetRect.left;
    const scaleX = triggerRect.width / Math.max(1, targetRect.width);
    const scaleY = triggerRect.height / Math.max(1, targetRect.height);

    // Initial state: search box starts exactly where the tapped bar was on screen
    searchBoxEl.style.transformOrigin = "top left";
    searchBoxEl.style.transform = `translate3d(${deltaX.toFixed(1)}px, ${deltaY.toFixed(1)}px, 0) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;
    searchBoxEl.style.transition = "none";

    // Side buttons & content fade in while search bar shifts
    if (backBtnEl) {
      backBtnEl.style.opacity = "0";
      backBtnEl.style.transform = "translateX(-8px)";
      backBtnEl.style.transition = "none";
    }
    if (micBtnEl) {
      micBtnEl.style.opacity = "0";
      micBtnEl.style.transform = "translateX(8px)";
      micBtnEl.style.transition = "none";
    }
    if (mainEl) {
      mainEl.style.opacity = "0";
      mainEl.style.transform = "translateY(16px)";
      mainEl.style.transition = "none";
    }

    // Next frame: smooth ease-out shift to final top position
    const raf = requestAnimationFrame(() => {
      if (!searchBoxEl) return;
      searchBoxEl.style.transition = "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)";
      searchBoxEl.style.transform = "translate3d(0, 0, 0) scale(1, 1)";

      if (backBtnEl) {
        backBtnEl.style.transition = "opacity 220ms ease-out 40ms, transform 220ms ease-out 40ms";
        backBtnEl.style.opacity = "1";
        backBtnEl.style.transform = "translateX(0)";
      }
      if (micBtnEl) {
        micBtnEl.style.transition = "opacity 220ms ease-out 40ms, transform 220ms ease-out 40ms";
        micBtnEl.style.opacity = "1";
        micBtnEl.style.transform = "translateX(0)";
      }
      if (mainEl) {
        mainEl.style.transition = "opacity 260ms ease-out 50ms, transform 260ms cubic-bezier(0.16, 1, 0.3, 1) 50ms";
        mainEl.style.opacity = "1";
        mainEl.style.transform = "translateY(0)";
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      if (searchBoxEl) {
        searchBoxEl.style.transform = "";
        searchBoxEl.style.transition = "";
        searchBoxEl.style.transformOrigin = "";
      }
      if (backBtnEl) {
        backBtnEl.style.opacity = "";
        backBtnEl.style.transform = "";
        backBtnEl.style.transition = "";
      }
      if (micBtnEl) {
        micBtnEl.style.opacity = "";
        micBtnEl.style.transform = "";
        micBtnEl.style.transition = "";
      }
      if (mainEl) {
        mainEl.style.opacity = "";
        mainEl.style.transform = "";
        mainEl.style.transition = "";
      }
    };
  }, [isOpen, prefersReducedMotion, triggerRect]);

  // Execute text search submit
  const executeSearch = useCallback(
    (textToSearch: string) => {
      const trimmed = textToSearch.trim();
      if (!trimmed) return;

      const updated = saveRecentSearch(trimmed);
      setRecentSearches(updated);
      onSearchSubmit(trimmed);
      handleSafeClose();
    },
    [onSearchSubmit, handleSafeClose]
  );

  // Tile selection handler
  const handleTileSelect = useCallback(
    (category: FoodCategory) => {
      const matching = matchCategoryItems(effectiveItems, category, categoryMap);

      if (matching.length > 0) {
        // Matches found: save category to recent searches, close takeover, apply filter
        saveRecentSearch(category.label);
        onSelectCategory(category);
        handleSafeClose();
      } else {
        // Zero matches on current menu: stay in takeover, show polite live notice & shake
        setUnmatchedNotice({
          categoryLabel: category.label,
          timestamp: Date.now(),
        });
        setShakingCategoryId(category.id);
        setTimeout(() => {
          setShakingCategoryId(null);
        }, 400);
      }
    },
    [effectiveItems, categoryMap, onSelectCategory, handleSafeClose]
  );

  // Suggestion item click
  const handleSuggestionClick = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.type === "category" && suggestion.category) {
        handleTileSelect(suggestion.category);
      } else if (suggestion.type === "dish" && suggestion.dish) {
        if (onOpenItem) {
          // Open item detail sheet directly above or from takeover
          onOpenItem(suggestion.dish);
        } else {
          executeSearch(suggestion.title);
        }
      } else {
        executeSearch(suggestion.title);
      }
    },
    [handleTileSelect, onOpenItem, executeSearch]
  );

  // Keyboard navigation for suggestions and escape handling
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
      } else {
        handleSafeClose();
      }
      return;
    }

    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
          handleSuggestionClick(suggestions[activeSuggestionIndex]);
        } else if (query.trim()) {
          executeSearch(query);
        }
        return;
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (query.trim()) {
        executeSearch(query);
      }
    }
  };

  // Recent search chip click
  const handleRecentClick = (term: string) => {
    executeSearch(term);
  };

  // Clear recent searches
  const handleClearRecents = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search food and categories"
      className="fixed inset-0 z-[48] flex flex-col bg-[#f5efe4] dark:bg-[#090A0F] text-[#181513] dark:text-[#f8fafc] animate-in fade-in duration-200 motion-reduce:animate-none"
    >
      {/* =========================================================================
          TOP SLAB: 44px BACK BUTTON + AUTOFOCUSED SEARCH INPUT + MICROPHONE
          ========================================================================= */}
      <header
        ref={topBarRef}
        className="sticky top-0 z-30 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 bg-[#f5efe4]/95 dark:bg-[#090A0F]/95 backdrop-blur-md border-b border-[#ded5c4] dark:border-[#222533]"
      >
        {/* Back Button (44px Accessible Target) */}
        <button
          ref={backBtnRef}
          type="button"
          onClick={handleSafeClose}
          aria-label="Back to home screen"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#181513] dark:text-white hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
        </button>

        {/* Search Input Box with Search Icon & Clear Button */}
        <div ref={searchBoxRef} className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#181513]/70 dark:text-slate-400 pointer-events-none" />
          <Input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            placeholder='Search "dosa, biryani, samosa, thali..."'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-11 pl-10 pr-10 text-sm font-semibold bg-[#eae2d2] dark:bg-[#121319] border border-[#181513]/25 dark:border-[#262836] text-[#181513] dark:text-white placeholder:text-[#181513]/60 dark:placeholder:text-slate-400 rounded-2xl shadow-2xs focus-visible:ring-2 focus-visible:ring-primary"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search text"
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Microphone Button (Reusing & Extending existing voice-search-button) */}
        <div ref={micBtnRef} className="shrink-0">
          <VoiceSearchButton
            onSearch={(transcript) => {
              setQuery(transcript);
              executeSearch(transcript);
            }}
          />
        </div>
      </header>

      {/* =========================================================================
          MAIN SCROLLABLE CONTENT BODY (Mobile-First, scrolls inside itself)
          ========================================================================= */}
      <main
        ref={mainContentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]"
      >
        {/* LIVE SUGGESTIONS DROPDOWN (when query typed) */}
        {query.trim().length > 0 && (
          <section aria-label="Search suggestions" className="space-y-2">
            {suggestions.length > 0 ? (
              <ul className="rounded-2xl border border-[#ded5c4] dark:border-[#222533] bg-[#eae2d2]/70 dark:bg-[#121319]/80 backdrop-blur-md overflow-hidden divide-y divide-[#ded5c4]/60 dark:divide-[#222533]/80 shadow-md">
                {suggestions.map((suggestion, idx) => {
                  const isSelected = idx === activeSuggestionIndex;
                  return (
                    <li key={suggestion.id}>
                      <button
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className={cn(
                          "w-full px-4 py-3 text-left flex items-center justify-between gap-3 text-sm font-semibold transition-colors cursor-pointer",
                          isSelected
                            ? "bg-primary/15 text-primary"
                            : "hover:bg-black/5 dark:hover:bg-white/5 text-[#181513] dark:text-white"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {suggestion.type === "category" ? (
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                              <Utensils className="h-5 w-5" />
                            </div>
                          ) : (
                            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-border/40 bg-muted/20 relative">
                              {suggestion.dish?.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={suggestion.dish.image_url}
                                  alt={suggestion.dish.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-base">🍲</div>
                              )}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {suggestion.dish && <VegIndicator isVeg={suggestion.dish.is_veg} />}
                              <span className="truncate font-bold text-sm text-foreground">
                                {suggestion.title}
                              </span>
                            </div>
                            {suggestion.dish && (
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                {suggestion.dish.protein_g != null && (
                                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                    {suggestion.dish.protein_g}g protein
                                  </span>
                                )}
                                {suggestion.dish.calories_kcal != null && (
                                  <span>{suggestion.dish.calories_kcal} kcal</span>
                                )}
                              </div>
                            )}
                            {!suggestion.dish && suggestion.subtitle && (
                              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                                {suggestion.subtitle}
                              </span>
                            )}
                          </div>
                        </div>

                        {suggestion.dish && (
                          <span className="text-xs font-mono font-bold text-foreground shrink-0">
                            {formatPaise(suggestion.dish.price_paise)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-6 text-center rounded-2xl border border-dashed border-[#ded5c4] dark:border-[#222533] bg-[#eae2d2]/40 dark:bg-[#121319]/40 space-y-2">
                <p className="text-sm font-bold text-[#181513] dark:text-white">
                  No dishes found for &ldquo;{query}&rdquo;
                </p>
                <p className="text-xs text-muted-foreground">
                  Try searching by dish name, or tap any category tile below.
                </p>
              </div>
            )}
          </section>
        )}

        {/* RECENT SEARCHES ROW (when query is empty and recent searches exist) */}
        {!query.trim() && recentSearches.length > 0 && (
          <section aria-label="Recent searches" className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-headline">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span>Your Recent Searches</span>
              </span>

              <button
                type="button"
                onClick={handleClearRecents}
                className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleRecentClick(term)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#eae2d2] dark:bg-[#16171E] border border-[#ded5c4] dark:border-[#262836] text-xs font-semibold text-[#181513] dark:text-[#f8fafc] hover:border-primary active:scale-95 transition-all cursor-pointer shadow-2xs"
                >
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* SUGGESTED FOOD ITEMS (Showcases food items with name & image) */}
        {!query.trim() && suggestedDishes.length > 0 && (
          <section aria-label="Suggested dishes" className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-headline">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Suggested Dishes</span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {suggestedDishes.map((dish) => (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => {
                    if (onOpenItem) {
                      onOpenItem(dish);
                      handleSafeClose();
                    } else {
                      executeSearch(dish.name);
                    }
                  }}
                  className="w-full p-2.5 rounded-2xl border border-border/70 bg-card hover:border-primary/50 transition-all flex items-center gap-3 text-left cursor-pointer group shadow-2xs active:scale-[0.98]"
                >
                  <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-border/40 bg-muted/20">
                    {dish.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={dish.image_url}
                        alt={dish.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg">🥗</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <VegIndicator isVeg={dish.is_veg} />
                      <h4 className="text-xs sm:text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                        {dish.name}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {dish.protein_g != null && (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {dish.protein_g}g protein
                        </span>
                      )}
                      {dish.calories_kcal != null && (
                        <span>{dish.calories_kcal} kcal</span>
                      )}
                      <span className="font-bold text-foreground ml-auto font-mono">
                        {formatPaise(dish.price_paise)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* POLITE LIVE REGION: NOT ON OUR MENU INLINE NOTICE */}
        <div aria-live="polite" aria-atomic="true" className="w-full">
          {unmatchedNotice && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3 animate-in fade-in duration-200">
              <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-xs sm:text-sm">
                <p className="font-bold">
                  Sorry, {unmatchedNotice.categoryLabel} isn&rsquo;t on our menu right now.
                </p>
                <p className="text-amber-800/80 dark:text-amber-300/80 text-xs">
                  Try another category or search by dish name above.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* WHAT'S ON YOUR MIND? 3-COLUMN CATEGORY GRID */}
        <section aria-label="What's on your mind categories" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-muted-foreground font-headline">
              What&rsquo;s on your mind?
            </h2>

            {/* Development-only sample switch (Compiled out in production) */}
            {process.env.NODE_ENV !== "production" && (
              <button
                type="button"
                onClick={() => setUseSampleData((prev) => !prev)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border transition-colors cursor-pointer",
                  useSampleData
                    ? "bg-emerald-600 text-white border-emerald-700"
                    : "bg-muted text-muted-foreground border-border hover:text-foreground"
                )}
                title="Development preview: blends sample items to preview photo tiles"
              >
                Sample data: {useSampleData ? "ON" : "OFF"}
              </button>
            )}
          </div>

          {/* 3-Column Touch-Friendly Responsive Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {sortedTiles.map(({ category, matchingCount, photoUrl }) => (
              <CategoryTile
                key={category.id}
                category={category}
                photoUrl={photoUrl}
                matchingCount={matchingCount}
                onSelect={handleTileSelect}
                isShaking={shakingCategoryId === category.id}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
