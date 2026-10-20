"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, ArrowRight } from "lucide-react";

import { useCartStore } from "@/lib/cart-store";
import { formatPaise } from "@/lib/money";
import {
  calculateEstimatedCartTotal,
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

  // Compute estimated total from current menu prices passed as props
  const estimatedTotal = useMemo(() => {
    return calculateEstimatedCartTotal(items, menuItems);
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
          className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-30 mx-auto max-w-md pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <Link
            href="/cart"
            aria-label={getCartShortcutAriaLabel(totalCount, estimatedTotal)}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lg transition-transform active:scale-[0.99] hover:bg-primary/95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* Left: Cart badge, item count & estimated price */}
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-7 min-w-[28px] items-center justify-center rounded-xl bg-primary-foreground/20 px-2 text-xs font-bold text-primary-foreground">
                <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                {totalCount}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold leading-tight truncate">
                  {totalCount === 1 ? "1 item" : `${totalCount} items`}
                </span>
                <span className="text-[11px] text-primary-foreground/80 leading-tight">
                  Est. {formatPaise(estimatedTotal)}
                </span>
              </div>
            </div>

            {/* Right: View cart action */}
            <div className="flex items-center gap-1.5 text-xs font-bold tracking-wide shrink-0">
              <span>View cart</span>
              <ArrowRight className="h-4 w-4" />
            </div>
          </Link>
        </aside>
      )}
    </>
  );
}
