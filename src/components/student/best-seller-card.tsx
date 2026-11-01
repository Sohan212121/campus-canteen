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
        <div className="relative w-full overflow-hidden rounded-xl bg-muted dark:bg-[#25201c]">
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
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-primary/95 dark:bg-[#FF385C] text-white font-headline text-[10px] uppercase font-bold tracking-wider shadow-sm">
            {rankBadgeText}
          </div>

          {/* Rating Badge with Golden Star */}
          {item.rating_count !== undefined && item.rating_count !== null && item.rating_count > 0 && item.rating_avg != null ? (
            <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-background/95 dark:bg-black/70 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-foreground dark:text-amber-400 shadow-2xs border border-border/60 dark:border-white/10">
              <span className="text-amber-500 dark:text-amber-400">★</span>
              <span>{item.rating_avg.toFixed(1)}</span>
            </div>
          ) : (
            <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background/95 dark:bg-black/70 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold tracking-tight text-foreground dark:text-amber-400 shadow-2xs border border-border/60 dark:border-white/10">
              <TrendingUp className="h-3 w-3 text-amber-500" />
              <span>Hot</span>
            </div>
          )}

          {/* Prep time badge */}
          {item.prep_minutes > 0 && (
            <div className="absolute bottom-2 right-2 rounded-full bg-background/90 dark:bg-black/75 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:text-stone-300 shadow-2xs border border-border/40 dark:border-white/10">
              ~{item.prep_minutes}m
            </div>
          )}

          {/* Units Sold Tag */}
          <div className="absolute bottom-2 left-2 rounded-md bg-background/90 dark:bg-black/70 backdrop-blur-xs px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:text-stone-300 shadow-2xs">
            {unitsSoldText}
          </div>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-destructive leading-tight uppercase font-headline">
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
              <span className="text-xs font-bold text-foreground dark:text-stone-300">
                {item.is_veg ? "Veg" : "Non-Veg"}
              </span>
            </div>
          </div>

          <h3 className="font-bold text-foreground dark:text-white font-headline text-sm sm:text-base uppercase tracking-wide leading-snug line-clamp-1 group-hover:text-primary transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-[11px] text-muted-foreground dark:text-stone-400 line-clamp-1 leading-relaxed">
              {item.description}
            </p>
          )}

          <div className="pt-1">
            <span className="font-headline text-[18px] sm:text-[20px] font-bold text-foreground dark:text-white">
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
          <div className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-primary dark:border-[#FF385C]/60 bg-primary dark:bg-[#241f1c] text-primary-foreground dark:text-white px-1 shadow-2xs">
            <button
              type="button"
              onClick={handleDecrement}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 dark:hover:bg-white/10 text-primary-foreground dark:text-white transition-colors cursor-pointer"
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold px-1 select-none font-headline text-base">
              {currentQuantity}
            </span>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={currentQuantity >= effectiveMax}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 dark:hover:bg-white/10 text-primary-foreground dark:text-white disabled:opacity-40 transition-colors cursor-pointer"
              aria-label={`Increase ${item.name} quantity`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleQuickAdd}
            variant="outline"
            size="sm"
            className="min-h-[44px] w-full text-xs font-bold rounded-xl border-primary/40 text-primary dark:bg-[#FF385C] dark:hover:bg-[#FF453A] dark:text-white dark:border-none font-headline uppercase tracking-wider shadow-md dark:shadow-rose-950/40 hover:bg-primary hover:text-primary-foreground transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            <span>Add +</span>
          </Button>
        )}
      </div>
    </div>
  );
}
