import { formatPaise } from "@/lib/money";

export interface MenuItemPriceRef {
  id: string;
  price_paise: number;
}

export interface CartItemRef {
  menu_item_id: string;
  quantity: number;
}

/**
 * Calculates estimated subtotal in paise for items in cart based on provided menu prices.
 * Unknown or unlisted items are safely skipped.
 */
export function calculateEstimatedCartTotal(
  cartItems: CartItemRef[],
  menuItems: MenuItemPriceRef[]
): number {
  if (!cartItems || cartItems.length === 0 || !menuItems || menuItems.length === 0) {
    return 0;
  }

  const priceMap = new Map<string, number>();
  for (const item of menuItems) {
    if (item && typeof item.id === "string" && typeof item.price_paise === "number") {
      priceMap.set(item.id, item.price_paise);
    }
  }

  let totalPaise = 0;
  for (const cartItem of cartItems) {
    if (!cartItem || typeof cartItem.quantity !== "number" || cartItem.quantity <= 0) {
      continue;
    }
    const price = priceMap.get(cartItem.menu_item_id);
    if (typeof price === "number" && price > 0) {
      totalPaise += price * cartItem.quantity;
    }
  }

  return totalPaise;
}

/**
 * Formats an accessible name for the CartShortcut link.
 * Clarifies that the total is an estimate (the cart page is authoritative).
 */
export function getCartShortcutAriaLabel(count: number, totalPaise: number): string {
  const itemText = count === 1 ? "1 item" : `${count} items`;
  return `View cart, ${itemText}, estimated total ${formatPaise(totalPaise)}`;
}

/**
 * Screen reader announcement for polite aria-live region on item additions.
 */
export function getCartShortcutAnnouncement(count: number): string {
  if (count <= 0) return "";
  const itemText = count === 1 ? "1 item" : `${count} items`;
  return `Added to cart. ${itemText} in cart.`;
}

/**
 * Determines whether the CartShortcut floating bar should be visually displayed.
 */
export function shouldShowCartShortcut(params: {
  hasHydrated: boolean;
  totalCount: number;
  pathname: string | null;
  isDetailSheetOpen?: boolean;
}): boolean {
  const { hasHydrated, totalCount, pathname, isDetailSheetOpen } = params;
  if (!hasHydrated || totalCount <= 0) return false;
  if (isDetailSheetOpen) return false;
  if (!pathname) return true;
  if (pathname === "/cart" || pathname.startsWith("/cart/")) return false;
  if (pathname === "/checkout" || pathname.startsWith("/checkout/")) return false;
  return true;
}
