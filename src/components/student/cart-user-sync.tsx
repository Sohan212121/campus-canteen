"use client";

import { useEffect } from "react";
import { useCartStore } from "@/lib/cart-store";

/**
 * Headless client component that synchronizes the current authenticated user ID
 * with the cart store, resetting items if the user ID changes or upon sign-out.
 */
export function CartUserSync({ userId }: { userId: string | null }) {
  const syncUser = useCartStore((s) => s.syncUser);

  useEffect(() => {
    syncUser(userId);
  }, [userId, syncUser]);

  return null;
}
