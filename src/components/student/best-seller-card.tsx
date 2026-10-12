"use client";

import { Plus, Minus, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { formatPaise } from "@/lib/money";
import { formatBestSellerBadge, formatUnitsSoldBadge } from "@/lib/best-sellers";
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
    addItem(item.id, 1);
    toast.success(`Added ${item.name} to cart`);
  };

  const handleIncrement = () => {
    if (isOutOfStock || currentQuantity >= effectiveMax) return;
    updateQuantity(item.id, currentQuantity + 1);
  };

  const handleDecrement = () => {
    updateQuantity(item.id, currentQuantity - 1);
  };

  const rankBadgeText = formatBestSellerBadge(rank);
  const unitsSoldText = formatUnitsSoldBadge(units_sold);

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 shadow-2xs transition-all hover:border-primary/40 hover:shadow-xs text-left ${
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
        {/* Card Image with Rank Badge overlay */}
        <div className="relative w-full overflow-hidden rounded-xl bg-muted">
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            aspect="4/3"
            sizes="(max-width: 640px) 230px, 260px"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            containerClassName="h-full w-full"
            placeholderClassName="h-full w-full"
          />

          {/* Rank Badge: Accessible Text, Never Color Alone */}
          <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background/95 backdrop-blur-xs px-2 py-0.5 text-[10px] font-bold tracking-tight text-foreground shadow-2xs border border-border/60">
            <TrendingUp className="h-3 w-3 text-amber-500" />
            <span>{rankBadgeText}</span>
          </div>

          {/* Units Sold Tag */}
          <div className="absolute bottom-2 left-2 rounded-md bg-background/90 backdrop-blur-xs px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-2xs">
            {unitsSoldText}
          </div>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-destructive leading-tight uppercase">
                Unavailable
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-2.5 space-y-1">
          <div className="flex items-center gap-1.5">
            <VegIndicator isVeg={item.is_veg} />
            <span className="text-xs font-bold text-foreground">
              {formatPaise(item.price_paise)}
            </span>
          </div>

          <h3 className="font-semibold text-foreground text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-[11px] text-muted-foreground line-clamp-1 leading-relaxed">
              {item.description}
            </p>
          )}
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
            className="min-h-[44px] w-full text-xs font-medium opacity-50 cursor-not-allowed"
          >
            Unavailable
          </Button>
        ) : currentQuantity > 0 ? (
          <div className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-primary bg-primary text-primary-foreground px-1 shadow-2xs">
            <button
              type="button"
              onClick={handleDecrement}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 text-primary-foreground transition-colors cursor-pointer"
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold px-1 select-none">
              {currentQuantity}
            </span>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={currentQuantity >= effectiveMax}
              className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 text-primary-foreground disabled:opacity-40 transition-colors cursor-pointer"
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
            className="min-h-[44px] w-full text-xs font-semibold rounded-xl border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            <span>Add</span>
          </Button>
        )}
      </div>
    </div>
  );
}
