"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, ArrowRight } from "lucide-react";

import { useCartStore } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
import {
  calculateEstimatedCartTotal,
  calculateEstimatedCartTotalFromRegistry,
  getCartShortcutAriaLabel,
  getCartShortcutAnnouncement,
  shouldShowCartShortcut,
  type MenuItemPriceRef,
} from "@/lib/cart-shortcut";

interface CartShortcutProps {
  menuItems?: MenuItemPriceRef[];
  isDetailSheetOpen?: boolean;
}

export function CartShortcut({
  menuItems = [],
  isDetailSheetOpen = false,
}: CartShortcutProps) {
  const pathname = usePathname();
  const items = useCartStore((s) => s.items);
  const totalCount = useCartStore((s) => s.getTotalItemCount());
  const hasHydrated = useCartStore((s) => s.hasHydrated);

  // Polite live region announcement state
  const [announcement, setAnnouncement] = useState("");
  const prevCountRef = useRef<number | null>(null);

  // Announce only after hydration and strictly on addition
  useEffect(() => {
    if (!hasHydrated) return;

    if (prevCountRef.current === null) {
      // First client hydration: initialize count baseline without vocalizing
      prevCountRef.current = totalCount;
      return;
    }

    if (totalCount > prevCountRef.current) {
      setAnnouncement(getCartShortcutAnnouncement(totalCount));
    }

    prevCountRef.current = totalCount;
  }, [hasHydrated, totalCount]);

  // Compute estimated total from current menu prices passed as props, with fallback to in-memory registry
  const estimatedTotal = useMemo(() => {
    const directTotal = calculateEstimatedCartTotal(items, menuItems);
    if (directTotal > 0 || menuItems.length > 0) {
      return directTotal;
    }
    return calculateEstimatedCartTotalFromRegistry(items);
  }, [items, menuItems]);

  const isVisible = shouldShowCartShortcut({
    hasHydrated,
    totalCount,
    pathname,
    isDetailSheetOpen,
  });

  return (
    <>
      {/* 
        Always-mounted polite live region for screen readers.
        Ensures assistive technologies have an active observer ready to announce additions.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {isVisible && (
        <aside
          role="region"
          aria-label="Floating cart shortcut"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-40 mx-auto max-w-md pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <Link
            href="/cart"
            aria-label={getCartShortcutAriaLabel(totalCount, estimatedTotal)}
            className="flex min-h-[50px] w-full items-center justify-between gap-3 rounded-full bg-primary text-primary-foreground dark:bg-[#1a1614]/95 dark:border dark:border-[#FF385C]/40 dark:backdrop-blur-xl dark:text-white px-3.5 py-2 shadow-lg dark:shadow-[0_16px_36px_rgba(0,0,0,0.85)] transition-transform active:scale-[0.99] hover:bg-primary/95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* Left: Bag Icon badge + Items description */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 dark:bg-gradient-to-br dark:from-[#FF385C] dark:to-[#FF453A] text-primary-foreground dark:text-white shadow-2xs dark:shadow-[0_0_14px_rgba(255,56,92,0.6)]">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-bold font-headline uppercase tracking-wide leading-tight truncate text-primary-foreground dark:text-white">
                  {totalCount} {totalCount === 1 ? "Item" : "Items"} Added
                </span>
                <span className="text-[10px] sm:text-[11px] leading-tight text-primary-foreground/80 dark:text-stone-400 font-medium truncate">
                  Express Pickup &bull; Station Ready
                </span>
              </div>
            </div>

            {/* Right: Price tag + Action button pill */}
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/20 dark:bg-gradient-to-r dark:from-[#FF385C] dark:to-[#FF453A] text-primary-foreground dark:text-white font-headline text-xs sm:text-sm font-bold uppercase tracking-wider shrink-0 shadow-2xs dark:shadow-[0_4px_16px_rgba(255,56,92,0.5)]">
              <span>{formatPaise(estimatedTotal)}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </Link>
        </aside>
      )}
    </>
  );
}
