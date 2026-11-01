"use client";

import { useRouter } from "next/navigation";
import { Plus, Minus, Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { StarRatingDisplay } from "@/components/student/star-rating";
import { formatPaise } from "@/lib/money";
import { registerMenuItemPrices } from "@/lib/cart-shortcut";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface MenuItemCardProps {
  item: MenuItemData;
  onOpenDetail: (item: MenuItemData) => void;
}

export function MenuItemCard({ item, onOpenDetail }: MenuItemCardProps) {
  const router = useRouter();
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

  return (
    <div
      className={`group relative flex w-full gap-3 rounded-2xl border border-[#decdb0] dark:border-[#352f2a] bg-[#efe3cb] dark:bg-[#1e1a17] p-3.5 shadow-2xs dark:shadow-sm transition-all hover:border-[#1d1713]/40 dark:hover:border-amber-500/40 hover:shadow-xs text-left ${
        isOutOfStock ? "opacity-75 bg-[#e8dac0]/40" : ""
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
              <span className="inline-flex items-center gap-0.5 text-[11px] text-[#635549] dark:text-stone-400 font-medium">
                <Clock className="h-3 w-3 stroke-[2]" />
                ~{item.prep_minutes} min
              </span>
            )}
            {item.stock !== null && item.stock > 0 && item.stock <= 5 && !isOutOfStock && (
              <Badge variant="warning" className="text-[10px] py-0 px-1.5 font-normal">
                {item.stock} left
              </Badge>
            )}
            {item.rating_count !== undefined && item.rating_count !== null && item.rating_count > 0 && (
              <StarRatingDisplay
                rating={item.rating_avg}
                count={item.rating_count}
                size="sm"
              />
            )}
          </div>

          <h3 className="font-bold text-[#1d1713] dark:text-white font-headline text-[15px] sm:text-[16px] uppercase tracking-wide leading-snug line-clamp-1 group-hover:text-[#d96b27] dark:group-hover:text-amber-400 transition-colors">
            {item.name}
          </h3>

          {item.description && (
            <p className="text-[11px] text-[#635549] dark:text-stone-400 line-clamp-1 leading-relaxed font-medium">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-bold text-[#1d1713] dark:text-white font-headline text-[18px] sm:text-[20px]">
            {formatPaise(item.price_paise)}
          </span>
          {isOutOfStock && (
            <span className="text-[11px] font-bold text-destructive uppercase tracking-wider font-headline">
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
          className="relative h-20 w-24 sm:h-22 sm:w-28 overflow-hidden rounded-xl bg-[#e8dac0] dark:bg-[#25201c] cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`View ${item.name} image`}
        >
          <MenuItemImage
            src={item.image_url}
            alt={item.name}
            aspect="4/3"
            sizes="(max-width: 640px) 100px, 120px"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
            containerClassName="h-full w-full"
            placeholderClassName="h-full w-full"
          />
          {isOutOfStock && (
            <div className="absolute inset-0 bg-[#181615]/70 backdrop-blur-[1px] flex items-center justify-center p-1 text-center">
              <span className="text-[10px] font-bold text-red-400 leading-tight uppercase font-headline">
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
              className="min-h-[44px] w-full text-xs font-medium opacity-50 cursor-not-allowed font-headline uppercase"
            >
              Add
            </Button>
          ) : currentQuantity > 0 ? (
            <div
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-[#362f2b] bg-[#181615] text-[#ffb94e] px-1 shadow-sm"
            >
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
              className="min-h-[44px] w-full bg-[#181615] hover:bg-[#d96b27] text-[#ffb94e] hover:text-[#f6eedb] border border-[#362f2b] font-headline uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-95 text-xs font-bold cursor-pointer flex items-center justify-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add +</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
