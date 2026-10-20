"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, ArrowRight } from "lucide-react";

import { useCartStore } from "@/lib/cart-store";
import {
  calculateEstimatedCartTotal,
  formatCartShortcutVisibleLabel,
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
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-40 mx-auto max-w-md pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none motion-reduce:transition-none"
        >
          <Link
            href="/cart"
            aria-label={getCartShortcutAriaLabel(totalCount, estimatedTotal)}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lg transition-transform active:scale-[0.99] hover:bg-primary/95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {/* Visible label: Go to Cart · {count} items · {total} */}
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingBag className="h-4 w-4 shrink-0 opacity-90" />
              <span className="text-xs sm:text-sm font-bold leading-tight truncate">
                {formatCartShortcutVisibleLabel(totalCount, estimatedTotal)}
              </span>
            </div>

            {/* Right: Action arrow */}
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        </aside>
      )}
    </>
  );
}
