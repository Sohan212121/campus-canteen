"use client";

import { Plus, Minus, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface MenuItemCardProps {
  item: MenuItemData;
  onOpenDetail: (item: MenuItemData) => void;
}

export function MenuItemCard({ item, onOpenDetail }: MenuItemCardProps) {
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

  return (
    <div
      className={`group relative flex w-full gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/20 hover:shadow-xs text-left ${
        isOutOfStock ? "opacity-75 bg-muted/30" : ""
      }`}
    >
      {/* Clickable Information Area (non-nested real button) */}
      <button
        type="button"
        onClick={() => onOpenDetail(item)}
        className="flex flex-1 flex-col justify-between min-w-0 pr-1 text-left cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        aria-label={`View details for ${item.name}`}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <VegIndicator isVeg={item.is_veg} />
            {item.prep_minutes > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground font-medium">
                <Clock className="h-3 w-3 stroke-[2]" />
                ~{item.prep_minutes} min
              </span>
            )}
            {item.stock !== null && item.stock > 0 && item.stock <= 5 && !isOutOfStock && (
              <Badge variant="warning" className="text-[10px] py-0 px-1.5 font-normal">
                {item.stock} left
              </Badge>
            )}
          </div>

          <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-bold text-foreground text-sm sm:text-base">
            {formatPaise(item.price_paise)}
          </span>
          {isOutOfStock && (
            <span className="text-[11px] font-bold text-destructive uppercase tracking-wider">
              Out of Stock
            </span>
          )}
        </div>
      </button>

      {/* Right side: Image + Separate Non-Nested Action button */}
      <div className="relative flex flex-col items-center justify-between shrink-0 w-24 sm:w-28">
        <button
          type="button"
          onClick={() => onOpenDetail(item)}
          className="relative h-20 w-24 sm:h-22 sm:w-28 overflow-hidden rounded-lg bg-muted cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`View ${item.name} image`}
        >
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            placeholderClassName="h-full w-full"
          />
          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-destructive leading-tight uppercase">
                Unavailable
              </span>
            </div>
          )}
        </button>

        {/* Action button positioned below image (>= 44px touch targets) */}
        <div className="mt-2 w-full flex justify-center">
          {isOutOfStock ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              className="min-h-[44px] w-full text-xs font-medium opacity-50 cursor-not-allowed"
            >
              Add
            </Button>
          ) : currentQuantity > 0 ? (
            <div
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-primary bg-primary text-primary-foreground px-1 shadow-2xs"
            >
              <button
                type="button"
                onClick={handleDecrement}
                className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 text-primary-foreground transition-colors"
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
                className="flex h-10 w-9 items-center justify-center rounded-lg hover:bg-primary-foreground/20 text-primary-foreground disabled:opacity-40 transition-colors"
                aria-label={`Increase ${item.name} quantity`}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickAdd}
              className="min-h-[44px] w-full border-primary/40 font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all text-xs"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
