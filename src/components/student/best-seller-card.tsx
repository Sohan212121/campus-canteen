"use client";

import { useRouter } from "next/navigation";
import { Plus, Minus, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
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
      className={`group relative flex flex-col justify-between rounded-2xl border border-border/80 dark:border-[#352f2a] bg-card dark:bg-[#1e1a17] p-3 shadow-2xs dark:shadow-md transition-all hover:border-primary/40 dark:hover:border-[#FF385C]/50 hover:shadow-xs text-left ${
        isOutOfStock ? "opacity-75 bg-muted/30" : ""
      } ${className}`}
    >
      {/* Clickable Image & Info Section */}
      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="flex flex-col text-left cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        aria-label={`View details for ${item.name}, ${rankBadgeText}`}
      >
        {/* Card Image with Rank & Rating Badges overlay */}
        <div className="relative w-full overflow-hidden rounded-xl bg-[#e8dac0] dark:bg-[#25201c]">
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            aspect="4/3"
            sizes="(max-width: 640px) 230px, 260px"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            containerClassName="h-full w-full"
            placeholderClassName="h-full w-full"
          />

          {/* Rank Badge: Prominent Fast-Casual Corner Badge */}
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#181615] text-[#fe7543] font-headline text-[10px] uppercase font-bold tracking-wider shadow-sm border border-[#362f2b]">
            {rankBadgeText}
          </div>

          {/* Rating Badge with Golden Star */}
          {item.rating_count !== undefined && item.rating_count !== null && item.rating_count > 0 && item.rating_avg != null ? (
            <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-[#181615]/90 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-[#f6eedb] shadow-2xs border border-[#362f2b]">
              <span className="text-[#ffb94e]">★</span>
              <span>{item.rating_avg.toFixed(1)}</span>
            </div>
          ) : (
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-[#181615]/90 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold tracking-tight text-[#f6eedb] shadow-2xs border border-[#362f2b]">
              <TrendingUp className="h-3 w-3 text-[#ffb94e]" />
              <span>Hot</span>
            </div>
          )}

          {/* Prep time badge */}
          {item.prep_minutes > 0 && (
            <div className="absolute bottom-2 right-2 rounded-full bg-[#181615]/80 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-[#f6eedb] shadow-2xs border border-[#362f2b]">
              ~{item.prep_minutes}m
            </div>
          )}

          {/* Units Sold Tag */}
          <div className="absolute bottom-2 left-2 rounded-md bg-[#181615]/80 backdrop-blur-xs px-1.5 py-0.5 text-[10px] font-medium text-[#decdb0] border border-[#362f2b]/60 shadow-2xs">
            {unitsSoldText}
          </div>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-[#181615]/75 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-red-400 leading-tight uppercase font-headline">
                Unavailable
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              <VegIndicator isVeg={item.is_veg} />
              <span className="text-xs font-bold text-[#1d1713] dark:text-stone-300">
                {item.is_veg ? "Veg" : "Non-Veg"}
              </span>
            </div>
          </div>

          <h3 className="font-bold text-[#1d1713] dark:text-white font-headline text-[15px] sm:text-[16px] uppercase tracking-wide leading-snug line-clamp-1 group-hover:text-[#d96b27] dark:group-hover:text-amber-400 transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-[11px] text-[#635549] dark:text-stone-400 line-clamp-1 leading-relaxed font-medium">
              {item.description}
            </p>
          )}

          <div className="pt-1">
            <span className="font-headline text-[18px] sm:text-[20px] font-bold text-[#1d1713] dark:text-white">
              {formatPaise(item.price_paise)}
            </span>
          </div>
        </div>
      </button>

      {/* Action / Stepper Button (>= 44px touch targets) */}
      <div className="mt-3 pt-1">
        {isOutOfStock ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="min-h-[44px] w-full text-xs font-medium opacity-50 cursor-not-allowed font-headline uppercase"
          >
            Unavailable
          </Button>
        ) : currentQuantity > 0 ? (
          <div className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[#362f2b] bg-[#181615] text-[#ffb94e] px-1 shadow-sm">
            <button
              type="button"
              onClick={handleDecrement}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-white/10 text-[#ffb94e] transition-colors cursor-pointer"
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold px-1 select-none font-headline text-base text-[#f6eedb]">
              {currentQuantity}
            </span>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={currentQuantity >= effectiveMax}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-white/10 text-[#ffb94e] disabled:opacity-40 transition-colors cursor-pointer"
              aria-label={`Increase ${item.name} quantity`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleQuickAdd}
            className="min-h-[44px] w-full text-xs font-bold rounded-xl bg-[#181615] hover:bg-[#d96b27] text-[#ffb94e] hover:text-[#f6eedb] border border-[#362f2b] font-headline uppercase tracking-wider shadow-sm transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add +</span>
          </button>
        )}
      </div>
    </div>
  );
}
