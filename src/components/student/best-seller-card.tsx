"use client";

import { useRouter } from "next/navigation";
import { Plus, Minus, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { FavoriteButton } from "@/components/student/favorite-button";
import { formatPaise } from "@/lib/money";
import { formatBestSellerBadge, formatUnitsSoldBadge } from "@/lib/best-sellers";
import { registerMenuItemPrices } from "@/lib/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface BestSellerCardProps {
  bestSeller: BestSellerItem;
  onOpenDetail: (item: MenuItemData) => void;
  className?: string;
}

export function BestSellerCard({
  bestSeller,
  onOpenDetail,
  className = "",
}: BestSellerCardProps) {
  const router = useRouter();
  const { item, rank, units_sold } = bestSeller;
  const currentQuantity = useCartStore((s) => s.getItemQuantity(item.id));
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);

  const isOutOfStock =
    !item.is_active ||
    !item.is_available ||
    (item.stock !== null && item.stock <= 0);

  const effectiveMax = Math.min(
    MAX_ITEM_QUANTITY,
    item.stock !== null ? Math.max(1, item.stock) : MAX_ITEM_QUANTITY
  );

  const handleQuickAdd = () => {
    if (isOutOfStock) return;
    registerMenuItemPrices([{ id: item.id, price_paise: item.price_paise }]);
    addItem(item.id, 1);
    toast.success(`Added ${item.name} to cart`, {
      id: "cart-add-feedback",
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
  };

  const handleIncrement = () => {
    if (isOutOfStock || currentQuantity >= effectiveMax) return;
    registerMenuItemPrices([{ id: item.id, price_paise: item.price_paise }]);
    updateQuantity(item.id, currentQuantity + 1);
  };

  const handleDecrement = () => {
    updateQuantity(item.id, currentQuantity - 1);
  };

  const rankBadgeText = formatBestSellerBadge(rank);
  const unitsSoldText = formatUnitsSoldBadge(units_sold);

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-2xl border border-border/80 dark:border-[#222533] bg-card dark:bg-[#121319] p-3 shadow-2xs dark:shadow-lg transition-all hover:border-primary/40 dark:hover:border-[#FBBF24]/50 hover:shadow-xs text-left ${
        isOutOfStock ? "opacity-75 bg-muted/30" : ""
      } ${className}`}
    >
      {/* Image & Favorite Button Container */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-[#e8dac0] dark:bg-[#090A0F]">
        <button
          type="button"
          onClick={() => onOpenDetail(item)}
          className="relative w-full h-full text-left cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring block"
          aria-label={`View details for ${item.name}, ${rankBadgeText}`}
        >
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            aspect="4/3"
            sizes="(max-width: 640px) 230px, 260px"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300 rounded-2xl"
            containerClassName="h-full w-full"
            placeholderClassName="h-full w-full"
          />

          {/* Rank Badge: Top-Left */}
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#181615] text-[#fe7543] dark:bg-gradient-to-r dark:from-red-600 dark:to-rose-500 dark:text-white dark:border-transparent font-headline text-[10px] uppercase font-bold tracking-wider shadow-sm border border-[#362f2b]">
            {rankBadgeText}
          </div>

          {/* Prep time badge */}
          {item.prep_minutes > 0 && (
            <div className="absolute bottom-2 right-2 rounded-full bg-[#181615]/80 dark:bg-black/80 dark:border-white/10 dark:text-slate-300 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-[#f6eedb] shadow-2xs border border-[#362f2b]">
              ~{item.prep_minutes}m
            </div>
          )}

          {/* Units Sold Tag */}
          <div className="absolute bottom-2 left-2 rounded-md bg-[#181615]/80 dark:bg-[#16171E] dark:border-[#262836] dark:text-slate-300 backdrop-blur-xs px-1.5 py-0.5 text-[10px] font-medium text-[#decdb0] border border-[#362f2b]/60 shadow-2xs">
            {unitsSoldText}
          </div>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-[#181615]/75 dark:bg-black/80 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-red-400 leading-tight uppercase font-headline">
                Unavailable
              </span>
            </div>
          )}
        </button>

        {/* Favorite Heart Button: Top-Right */}
        <div className="absolute top-2 right-2 z-10">
          <FavoriteButton item={item} size="sm" variant="floating" />
        </div>
      </div>

      {/* Info click area */}
      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="flex flex-col text-left cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring w-full"
        aria-label={`View details for ${item.name}`}
      >

        {/* Info */}
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <VegIndicator isVeg={item.is_veg} />
              <span className="text-xs font-bold text-[#1d1713] dark:text-slate-300">
                {item.is_veg ? "Veg" : "Non-Veg"}
              </span>
            </div>
          </div>

          <h3 className="font-bold text-[#1d1713] dark:text-white font-headline dark:font-display text-[15px] sm:text-[18px] uppercase tracking-wide leading-snug line-clamp-1 group-hover:text-[#d96b27] dark:group-hover:text-[#FBBF24] transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-[11px] text-[#635549] dark:text-slate-400 line-clamp-1 leading-relaxed font-medium">
              {item.description}
            </p>
          )}

          <div className="pt-1">
            <span className="font-headline dark:font-display text-[18px] sm:text-[20px] font-bold text-[#1d1713] dark:text-[#FBBF24]">
              {formatPaise(item.price_paise)}
            </span>
          </div>
        </div>
      </button>

      {/* Action / Stepper Button (>= 44px touch targets) */}
      <div className="mt-3 pt-1 border-t border-transparent dark:border-[#1E202B]">
        {isOutOfStock ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="min-h-[44px] w-full text-xs font-medium opacity-50 cursor-not-allowed font-headline uppercase dark:bg-[#121319] dark:border-[#222533] dark:text-slate-500"
          >
            Unavailable
          </Button>
        ) : currentQuantity > 0 ? (
          <div className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[#EAB308] dark:border-[#FBBF24]/60 bg-[#FACC15] dark:bg-[#FBBF24] text-[#181513] px-1 shadow-sm font-bold">
            <button
              type="button"
              onClick={handleDecrement}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-black/10 text-[#181513] transition-colors cursor-pointer"
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="h-4 w-4 stroke-[2.5]" />
            </button>
            <span className="text-xs font-extrabold px-1 select-none font-headline dark:font-display text-base text-[#181513]">
              {currentQuantity}
            </span>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={currentQuantity >= effectiveMax}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-black/10 text-[#181513] disabled:opacity-40 transition-colors cursor-pointer"
              aria-label={`Increase ${item.name} quantity`}
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleQuickAdd}
            className="min-h-[44px] w-full text-xs font-extrabold rounded-xl bg-[#FACC15] hover:bg-[#EAB308] dark:bg-[#FBBF24] hover:dark:bg-[#F59E0B] text-[#181513] dark:text-[#181513] border border-[#EAB308] dark:border-[#F59E0B] font-headline dark:font-sans uppercase tracking-wider shadow-sm transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>Add +</span>
          </button>
        )}
      </div>
    </div>
  );
}
