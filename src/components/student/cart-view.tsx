"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MenuItemImage } from "@/components/student/menu-item-image";
import { formatPaise } from "@/lib/money";
import { useCartStore, MAX_ITEM_QUANTITY } from "@/lib/cart-store";
import {
  getCartItemDetailsAction,
  type CartItemDetail,
} from "@/server/actions/cart";

export function CartView() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const hasHydrated = useCartStore((s) => s.hasHydrated);

  const [serverDetails, setServerDetails] = useState<Record<string, CartItemDetail>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Load fresh item details from the server whenever cart item IDs change
  useEffect(() => {
    if (!hasHydrated || items.length === 0) return;

    let ignore = false;
    const itemIds = items.map((i) => i.menu_item_id);

    async function fetchDetails() {
      setIsLoading(true);
      const res = await getCartItemDetailsAction(itemIds);
      if (ignore) return;

      if (res.success && res.data) {
        const map: Record<string, CartItemDetail> = {};
        res.data.forEach((item) => {
          map[item.id] = item;
        });
        setServerDetails(map);
      } else {
        toast.error("Could not refresh live menu prices.");
      }
      setIsLoading(false);
    }

    fetchDetails();
    return () => {
      ignore = true;
    };
  }, [hasHydrated, items]);

  // Calculate line items purely without local variable mutations
  const enrichedItems = useMemo(() => {
    return items.map((cartItem) => {
      const detail = serverDetails[cartItem.menu_item_id];

      // Status: 1. Deleted/not found
      if (!detail) {
        return {
          cartItem,
          detail: null,
          status: "missing" as const,
          effectiveQuantity: 0,
          lineTotalPaise: 0,
        };
      }

      // Status: 2. Inactive / Out of stock
      const isUnavailable =
        !detail.is_active ||
        !detail.is_available ||
        (detail.stock !== null && detail.stock <= 0);

      if (isUnavailable) {
        return {
          cartItem,
          detail,
          status: "unavailable" as const,
          effectiveQuantity: 0,
          lineTotalPaise: 0,
        };
      }

      // Status: 3. Quantity exceeds available stock
      if (detail.stock !== null && cartItem.quantity > detail.stock) {
        const effectiveQty = detail.stock;
        return {
          cartItem,
          detail,
          status: "capped" as const,
          effectiveQuantity: effectiveQty,
          lineTotalPaise: detail.price_paise * effectiveQty,
        };
      }

      // Status: 4. Fully available
      const effectiveQty = cartItem.quantity;
      return {
        cartItem,
        detail,
        status: "available" as const,
        effectiveQuantity: effectiveQty,
        lineTotalPaise: detail.price_paise * effectiveQty,
      };
    });
  }, [items, serverDetails]);

  const hasUnavailableItems = enrichedItems.some(
    (i) => i.status === "missing" || i.status === "unavailable"
  );
  const hasStockCappedItems = enrichedItems.some((i) => i.status === "capped");
  const subtotalPaise = enrichedItems.reduce(
    (sum, i) => sum + i.lineTotalPaise,
    0
  );

  if (!hasHydrated || (isLoading && Object.keys(serverDetails).length === 0)) {
    return (
      <div className="space-y-4 py-8 text-center">
        <RefreshCw className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading your cart items...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-card p-8 text-center space-y-4 my-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ShoppingBag className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold">Your cart is empty</h2>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Looks like you haven&apos;t added any food items yet. Browse the campus menu to order ahead.
          </p>
        </div>
        <Link
          href="/menu"
          className={buttonVariants({
            className: "rounded-xl h-11 px-6 font-semibold gap-2 inline-flex items-center",
          })}
        >
          Browse Menu <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Your Cart</h1>
        <button
          type="button"
          onClick={() => {
            clearCart();
            toast.info("Cart cleared");
          }}
          className="text-xs font-medium text-destructive hover:underline min-h-[44px] flex items-center px-1"
        >
          Clear cart
        </button>
      </div>

      {/* Warnings banner if items are unavailable or capped */}
      {hasUnavailableItems && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Some items are currently unavailable</p>
            <p className="opacity-90">
              Unavailable items are excluded from your order total. You can remove them below.
            </p>
          </div>
        </div>
      )}

      {hasStockCappedItems && !hasUnavailableItems && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Limited stock adjustment</p>
            <p className="opacity-90">
              Some quantities were capped at maximum remaining stock.
            </p>
          </div>
        </div>
      )}

      {/* Cart items list */}
      <div className="space-y-3">
        {enrichedItems.map(({ cartItem, detail, status, effectiveQuantity, lineTotalPaise }) => {
          const isInvalid = status === "missing" || status === "unavailable";
          const maxAvailable = detail?.stock !== null && detail?.stock !== undefined ? detail.stock : MAX_ITEM_QUANTITY;

          return (
            <div
              key={cartItem.menu_item_id}
              className={`flex gap-3 rounded-xl border p-3.5 shadow-2xs transition-colors ${
                isInvalid
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border/80 bg-card"
              }`}
            >
              {/* Item Thumbnail */}
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                <MenuItemImage
                  src={detail?.image_url}
                  alt={detail?.name ?? "Item"}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* Item Info */}
              <div className="flex flex-1 flex-col justify-between min-w-0">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-snug line-clamp-1">
                      {detail?.name ?? "Unavailable Item"}
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        removeItem(cartItem.menu_item_id);
                        toast.info("Removed from cart");
                      }}
                      className="text-muted-foreground hover:text-destructive p-1 min-h-[32px] min-w-[32px] flex items-center justify-center -mr-1 -mt-1"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Status Badges */}
                  {status === "missing" && (
                    <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                      No longer on menu
                    </Badge>
                  )}
                  {status === "unavailable" && (
                    <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                      Out of stock
                    </Badge>
                  )}
                  {status === "capped" && (
                    <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                      Only {effectiveQuantity} left (capped)
                    </Badge>
                  )}

                  {!isInvalid && detail && (
                    <p className="text-xs text-muted-foreground">
                      {formatPaise(detail.price_paise)} each
                    </p>
                  )}
                </div>

                {/* Bottom row: Stepper + Line Total */}
                <div className="mt-2.5 flex items-center justify-between">
                  {!isInvalid ? (
                    <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(cartItem.menu_item_id, cartItem.quantity - 1)
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-foreground transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center text-xs font-bold select-none">
                        {cartItem.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(cartItem.menu_item_id, cartItem.quantity + 1)
                        }
                        disabled={cartItem.quantity >= maxAvailable || cartItem.quantity >= MAX_ITEM_QUANTITY}
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-foreground disabled:opacity-40 transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeItem(cartItem.menu_item_id)}
                      className="text-xs text-destructive hover:underline font-medium min-h-[36px] flex items-center"
                    >
                      Remove from cart
                    </button>
                  )}

                  <div className="text-right">
                    {!isInvalid ? (
                      <span className="font-bold text-sm sm:text-base text-foreground">
                        {formatPaise(lineTotalPaise)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground line-through">
                        Excluded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Financial Summary Card */}
      <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3 shadow-2xs">
        <h4 className="font-semibold text-sm">Bill Summary</h4>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <dt>Subtotal</dt>
            <dd className="font-medium text-foreground">{formatPaise(subtotalPaise)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>Pre-order Convenience Fee</dt>
            <dd className="font-medium text-foreground">₹0</dd>
          </div>
          <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
            <dt>To Pay</dt>
            <dd className="text-primary">{formatPaise(subtotalPaise)}</dd>
          </div>
        </dl>
      </div>

      {/* Checkout Button & Phase 5 Execution */}
      <div className="space-y-2 pt-2">
        {/*
          * =====================================================================
          * PHASE 5 VERIFICATION NOTE:
          * In Phase 5, the server order-creation action (placeOrderAction)
          * strictly re-reads item prices, availability, and kitchen capacity
          * directly from the database inside an atomic transaction.
          * Client-computed subtotals and totals are untrusted and for display only.
          * =====================================================================
          */}
        {hasUnavailableItems ? (
          <Button
            type="button"
            disabled
            className="w-full h-12 text-sm font-semibold opacity-60 cursor-not-allowed"
          >
            Remove unavailable items to checkout
          </Button>
        ) : (
          <Link
            href="/checkout"
            className={buttonVariants({
              size: "lg",
              className:
                "w-full h-12 text-base font-semibold shadow-xs inline-flex items-center justify-center gap-2",
            })}
          >
            <span>Proceed to Checkout</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
        <p className="text-center text-[11px] text-muted-foreground">
          You will select ASAP or scheduled pickup on the checkout screen.
        </p>
      </div>
    </div>
  );
}
