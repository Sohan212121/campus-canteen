"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Minus, Clock, ShoppingBag, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import { StarRatingDisplay } from "@/components/student/star-rating";
import { ItemReviewsSection } from "@/components/student/item-reviews-section";

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
  rating_avg?: number | null;
  rating_count?: number;
  calories_kcal?: number | null;
  ingredients?: string[];
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
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [isIngredientsOpen, setIsIngredientsOpen] = useState(false);
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
    toast.success(`Added ${quantity} × ${item.name} to cart`, {
      id: "cart-add-feedback",
      action: {
        label: "View cart",
        onClick: () => router.push("/cart"),
      },
    });
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
            aspect="4/3"
            sizes="(max-width: 640px) 100vw, 500px"
            className="h-full w-full object-cover"
            containerClassName="h-full w-full"
            placeholderClassName="h-full w-full"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
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
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <VegIndicator isVeg={item.is_veg} showLabel />
                {item.prep_minutes > 0 && (
                  <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    ~{item.prep_minutes} min
                  </Badge>
                )}
              </div>
              <h2 id="item-detail-title" className="text-xl font-bold tracking-tight break-words">
                {item.name}
              </h2>
              <div className="pt-0.5">
                <StarRatingDisplay
                  rating={item.rating_avg}
                  count={item.rating_count}
                  size="sm"
                />
              </div>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-1">
              <span className="text-xl font-bold text-foreground">
                {formatPaise(item.price_paise)}
              </span>
              {item.calories_kcal != null && (
                <span
                  className="inline-flex items-center rounded-full bg-secondary/80 px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                  aria-label={`About ${item.calories_kcal} calories per serving`}
                >
                  ~{item.calories_kcal} kcal
                </span>
              )}
            </div>
          </div>

          {item.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          )}

          {item.ingredients && item.ingredients.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setIsIngredientsOpen((prev) => !prev)}
                className="flex items-center justify-between w-full py-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
                aria-expanded={isIngredientsOpen}
                aria-controls="ingredients-panel"
              >
                <span>Ingredients ({item.ingredients.length})</span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
                    isIngredientsOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {isIngredientsOpen && (
                <div
                  id="ingredients-panel"
                  className="flex flex-wrap gap-1.5 pt-2 pb-1"
                >
                  {item.ingredients.map((ing, idx) => (
                    <span
                      key={`${ing}-${idx}`}
                      className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {ing}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {(item.calories_kcal != null || (item.ingredients && item.ingredients.length > 0)) && (
            <p className="text-[11px] text-muted-foreground/80 italic">
              Calorie and ingredient details are provided by the canteen and are approximate.
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

          {/* Customer Reviews Section */}
          <ItemReviewsSection menuItemId={item.id} itemName={item.name} />
        </div>

        {/* Footer with quantity stepper and add to cart */}
        <div className="p-4 border-t border-border bg-card/95 pb-[max(1rem,env(safe-area-inset-bottom,0px))] flex items-center gap-3">
          {!isOutOfStock ? (
            <>
              {/* Stepper (min 44px touch targets) */}
              <div className="flex items-center rounded-xl border border-border bg-background p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={handleDecrement}
                  disabled={quantity <= 1}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
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
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
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
