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
            className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-full bg-[#181615]/95 dark:bg-gradient-to-r dark:from-[#16171E] dark:to-[#0A0A0E] border border-[#3c342e] dark:border-[#262836] backdrop-blur-xl text-[#f6eedb] px-4 py-2 shadow-[0_16px_36px_rgba(24,22,21,0.55)] dark:shadow-2xl transition-transform active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#fe7543] dark:focus-visible:ring-[#FBBF24]"
          >
            {/* Left: Bag Icon badge + Items description */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#fe7543] to-[#d96b27] dark:bg-none dark:bg-[#090A0F] dark:border dark:border-[#F59E0B]/50 text-[#181615] dark:text-[#FBBF24] shadow-md shadow-black/30">
                <ShoppingBag className="h-4 w-4 stroke-[2.5]" />
                <span className="hidden dark:flex absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-[#EF4444] text-[9px] font-black text-white rounded-full items-center justify-center px-0.5 border border-[#090A0F]">
                  {totalCount}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-bold font-headline dark:font-display dark:tracking-wider uppercase tracking-wide leading-tight truncate text-[#f6eedb] dark:text-white">
                  {totalCount} {totalCount === 1 ? "Item" : "Items"} Added
                </span>
                <span className="text-[10px] sm:text-[11px] leading-tight text-[#decdb0]/80 dark:text-slate-400 font-medium truncate">
                  Express Pickup &bull; Fast Bites
                </span>
              </div>
            </div>

            {/* Right: Price tag + Action button pill */}
            <div className="flex items-center gap-1.5 px-4 py-1.5 sm:py-2 rounded-full bg-gradient-to-r from-[#fe7543] to-[#d96b27] dark:from-[#FBBF24] dark:to-[#F59E0B] hover:from-[#d96b27] hover:to-[#a84e10] text-[#181615] dark:text-[#090A0F] font-headline dark:font-display text-xs sm:text-sm font-bold dark:font-black uppercase tracking-wider shrink-0 shadow-[0_4px_16px_rgba(254,117,67,0.4)] dark:shadow-[#FBBF24]/20">
              <span>{formatPaise(estimatedTotal)}</span>
              <ArrowRight className="h-3.5 w-3.5 stroke-[2.5]" />
            </div>
          </Link>
        </aside>
      )}
    </>
  );
}
