"use client";

import { useState, useEffect } from "react";
import { X, Plus, Minus, Clock, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";

export type MenuItemData = {
  id: string;
  canteen_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_paise: number;
  image_url: string | null;
  is_veg: boolean;
  is_available: boolean;
  stock: number | null;
  prep_minutes: number;
  is_active: boolean;
};

interface ItemDetailSheetProps {
  item: MenuItemData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ItemDetailSheet({ item, isOpen, onClose }: ItemDetailSheetProps) {
  // Prevent background scrolling when sheet is open
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  return <ItemDetailDialogContent key={item.id} item={item} onClose={onClose} />;
}

function ItemDetailDialogContent({
  item,
  onClose,
}: {
  item: MenuItemData;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const addItem = useCartStore((s) => s.addItem);
  const currentInCart = useCartStore((s) => s.getItemQuantity(item.id));

  const isOutOfStock =
    !item.is_active ||
    !item.is_available ||
    (item.stock !== null && item.stock <= 0);

  const effectiveMaxQty = Math.min(
    MAX_ITEM_QUANTITY,
    item.stock !== null ? Math.max(1, item.stock) : MAX_ITEM_QUANTITY
  );

  const handleIncrement = () => {
    if (quantity < effectiveMaxQty) {
      setQuantity((q) => q + 1);
    }
  };

  const handleDecrement = () => {
    if (quantity > 1) {
      setQuantity((q) => q - 1);
    }
  };

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    addItem(item.id, quantity);
    toast.success(`Added ${quantity} × ${item.name} to cart`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs transition-opacity duration-200 sm:items-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-detail-title"
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/80 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with image */}
        <div className="relative h-48 w-full bg-muted shrink-0">
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover"
            placeholderClassName="h-full w-full"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px] flex items-center justify-center">
              <span className="rounded-md bg-destructive px-3 py-1 text-xs font-bold text-destructive-foreground tracking-wide uppercase">
                Out of Stock
              </span>
            </div>
          )}
        </div>

        {/* Content scrollable body */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <VegIndicator isVeg={item.is_veg} showLabel />
                {item.prep_minutes > 0 && (
                  <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    ~{item.prep_minutes} min
                  </Badge>
                )}
              </div>
              <h2 id="item-detail-title" className="text-xl font-bold tracking-tight">
                {item.name}
              </h2>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xl font-bold text-foreground">
                {formatPaise(item.price_paise)}
              </span>
            </div>
          </div>

          {item.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          )}

          {item.stock !== null && !isOutOfStock && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Only {item.stock} left for today
            </p>
          )}

          {currentInCart > 0 && (
            <div className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground flex items-center justify-between">
              <span>Already in cart:</span>
              <span className="font-semibold text-foreground">
                {currentInCart} unit{currentInCart > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Footer with quantity stepper and add to cart */}
        <div className="p-4 border-t border-border bg-card/95 safe-area-bottom flex items-center gap-3">
          {!isOutOfStock ? (
            <>
              {/* Stepper (min 44px touch targets) */}
              <div className="flex items-center rounded-lg border border-border bg-background p-1 shrink-0">
                <button
                  type="button"
                  onClick={handleDecrement}
                  disabled={quantity <= 1}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm font-semibold select-none">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={handleIncrement}
                  disabled={quantity >= effectiveMaxQty}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Add to Cart button */}
              <Button
                type="button"
                className="flex-1 h-12 text-base font-semibold gap-2 shadow-sm"
                onClick={handleAddToCart}
              >
                <ShoppingBag className="h-4 w-4" />
                Add &bull; {formatPaise(item.price_paise * quantity)}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled
              variant="outline"
              className="w-full h-12 text-sm font-medium"
            >
              Item Currently Unavailable
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
