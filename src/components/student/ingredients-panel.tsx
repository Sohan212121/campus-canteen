"use client";

import React, { useState, useRef, useId } from "react";
import {
  Sparkles,
  ChevronDown,
  Drumstick,
  Milk,
  Carrot,
  Wheat,
  Flame,
  Utensils,
  Check,
} from "lucide-react";
import {
  categorizeIngredient,
  getPresentCategories,
  calculateGridRovingIndex,
  CATEGORY_METADATA,
  type IngredientCategory,
} from "@/lib/ingredient-categories";

export interface IngredientsPanelProps {
  ingredients?: string[];
  itemName?: string;
}

function CategoryIcon({
  category,
  className,
}: {
  category: IngredientCategory;
  className?: string;
}) {
  switch (category) {
    case "protein":
      return <Drumstick className={className} aria-hidden="true" />;
    case "dairy":
      return <Milk className={className} aria-hidden="true" />;
    case "vegetable":
      return <Carrot className={className} aria-hidden="true" />;
    case "grain":
      return <Wheat className={className} aria-hidden="true" />;
    case "sauce_spice":
      return <Flame className={className} aria-hidden="true" />;
    case "other":
    default:
      return <Utensils className={className} aria-hidden="true" />;
  }
}

export function IngredientsPanel({
  ingredients,
  itemName,
}: IngredientsPanelProps) {
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);

  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reset open state and selection when item changes (render-phase state adjustment)
  const itemKey = `${itemName ?? ""}-${ingredients?.join(",") ?? ""}`;
  const [prevItemKey, setPrevItemKey] = useState(itemKey);
  if (prevItemKey !== itemKey) {
    setPrevItemKey(itemKey);
    setIsOpen(false);
    setSelectedIdx(null);
    setFocusedIdx(0);
    setHasInteracted(false);
  }

  if (!ingredients || ingredients.length === 0) {
    return null;
  }

  // Pre-categorize ingredients
  const parsedIngredients = ingredients.map((ing) => categorizeIngredient(ing));
  const presentCategories = getPresentCategories(ingredients);

  const handleTileClick = (index: number) => {
    setHasInteracted(true);
    setFocusedIdx(index);
    setSelectedIdx((prev) => (prev === index ? null : index));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    // 2 columns on small screens, 3 columns on tablet/desktop (sm: breakpoint)
    const isSmallTablet =
      typeof window !== "undefined" && window.innerWidth >= 640;
    const columns = isSmallTablet ? 3 : 2;

    if (
      [
        "ArrowRight",
        "ArrowLeft",
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      const nextIdx = calculateGridRovingIndex(
        index,
        parsedIngredients.length,
        columns,
        e.key
      );
      setFocusedIdx(nextIdx);
      tileRefs.current[nextIdx]?.focus();
    }
  };

  const selectedIngredient =
    selectedIdx !== null ? parsedIngredients[selectedIdx] : null;
  const selectedMeta = selectedIngredient
    ? CATEGORY_METADATA[selectedIngredient.category]
    : null;

  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 shadow-2xs overflow-hidden transition-colors">
      {/* Header Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between w-full px-3.5 py-3 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors cursor-pointer select-none"
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-4 text-primary shrink-0" aria-hidden="true" />
          <span className="font-semibold text-foreground tracking-tight">
            What&apos;s inside
          </span>
          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground shrink-0">
            {ingredients.length} item{ingredients.length > 1 ? "s" : ""}
          </span>
        </div>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div id={panelId} className="px-3.5 pb-3.5 pt-1 space-y-3.5">
          {/* Ingredient Tiles Grid */}
          <ul
            className="grid grid-cols-2 sm:grid-cols-3 gap-2"
            role="list"
            aria-label="Ingredients list"
          >
            {parsedIngredients.map((item, idx) => {
              const meta = CATEGORY_METADATA[item.category];
              const isSelected = selectedIdx === idx;
              const delayMs = Math.min(idx * 30, 450);

              return (
                <li key={`${item.label}-${idx}`} className="list-none">
                  <button
                    ref={(el) => {
                      tileRefs.current[idx] = el;
                    }}
                    type="button"
                    tabIndex={focusedIdx === idx ? 0 : -1}
                    aria-pressed={isSelected}
                    onClick={() => handleTileClick(idx)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    style={{ animationDelay: `${delayMs}ms` }}
                    className={`w-full min-h-[44px] flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg border text-left transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-reduce:animate-none ${
                      meta.badgeClass
                    } ${
                      isSelected
                        ? `${meta.activeRingClass} scale-[1.02] shadow-xs motion-reduce:transform-none`
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <CategoryIcon
                        category={item.category}
                        className="size-3.5 shrink-0"
                      />
                      <span className="text-xs font-medium leading-tight break-words line-clamp-2">
                        {item.label}
                      </span>
                    </div>

                    {/* Selected state indicates with Check icon + ring, not color alone */}
                    {isSelected && (
                      <Check
                        className="size-3.5 shrink-0 text-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Legend row listing ONLY categories present in this item */}
          {presentCategories.length > 0 && (
            <div className="pt-1 border-t border-border/40">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/80">Types:</span>
                {presentCategories.map((cat) => (
                  <span
                    key={cat.id}
                    className="inline-flex items-center gap-1.5"
                  >
                    <span
                      className={`size-2 rounded-full shrink-0 ${cat.dotClass}`}
                      aria-hidden="true"
                    />
                    <span>{cat.displayName}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interactive selection status strip: aria-live polite, not announced on first render */}
          <div
            aria-live={hasInteracted ? "polite" : "off"}
            aria-atomic="true"
            className="rounded-lg bg-background/80 border border-border/60 px-3 py-1.5 text-xs text-foreground/90 flex items-center justify-between"
          >
            {selectedIngredient && selectedMeta ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-foreground truncate">
                  {selectedIngredient.label}
                </span>
                <span className="text-muted-foreground">&middot;</span>
                <span className="text-muted-foreground">
                  {selectedMeta.displayName}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground text-[11px]">
                Tap an ingredient to see its type
              </span>
            )}
            {selectedIngredient && (
              <button
                type="button"
                onClick={() => {
                  setHasInteracted(true);
                  setSelectedIdx(null);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground font-medium underline-offset-2 hover:underline ml-2 shrink-0 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Preserved approximate-details note at bottom of panel */}
          <p className="text-[11px] text-muted-foreground/80 italic pt-1">
            Calorie and ingredient details are provided by the canteen and are approximate.
          </p>
        </div>
      )}
    </div>
  );
}
