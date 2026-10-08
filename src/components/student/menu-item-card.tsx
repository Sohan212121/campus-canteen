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

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOutOfStock) return;
    addItem(item.id, 1);
    toast.success(`Added ${item.name} to cart`);
  };

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOutOfStock || currentQuantity >= effectiveMax) return;
    updateQuantity(item.id, currentQuantity + 1);
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateQuantity(item.id, currentQuantity - 1);
  };

  return (
    <div
      onClick={() => onOpenDetail(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(item);
        }
      }}
      className={`group relative flex w-full gap-3 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs transition-all hover:border-foreground/20 hover:shadow-xs active:scale-[0.99] text-left cursor-pointer ${
        isOutOfStock ? "opacity-70 bg-muted/30" : ""
      }`}
    >
      {/* Left side: Information */}
      <div className="flex flex-1 flex-col justify-between min-w-0 pr-1">
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

          <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug line-clamp-2">
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
      </div>

      {/* Right side: Image + Add/Stepper button */}
      <div className="relative flex flex-col items-center justify-between shrink-0 w-24 sm:w-28">
        <div className="relative h-20 w-24 sm:h-22 sm:w-28 overflow-hidden rounded-lg bg-muted">
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
        </div>

        {/* Action button positioned below image */}
        <div className="mt-2 w-full flex justify-center">
          {isOutOfStock ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              className="h-8 w-full text-xs font-medium opacity-50 cursor-not-allowed"
            >
              Add
            </Button>
          ) : currentQuantity > 0 ? (
            <div
              className="flex h-8 w-full items-center justify-between rounded-lg border border-primary bg-primary text-primary-foreground px-1 shadow-2xs"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={handleDecrement}
                className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-primary-foreground/20 text-primary-foreground transition-colors"
                aria-label={`Decrease ${item.name} quantity`}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-bold px-1 select-none">
                {currentQuantity}
              </span>
              <button
                type="button"
                onClick={handleIncrement}
                disabled={currentQuantity >= effectiveMax}
                className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-primary-foreground/20 text-primary-foreground disabled:opacity-40 transition-colors"
                aria-label={`Increase ${item.name} quantity`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickAdd}
              className="h-8 w-full border-primary/40 font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all text-xs"
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
