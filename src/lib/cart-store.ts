import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

export const MAX_ITEM_QUANTITY = 10;
export const CART_STORAGE_KEY = "campus-canteen-cart";

export type CartItem = {
  menu_item_id: string;
  quantity: number;
};

export interface CartState {
  userId: string | null;
  items: CartItem[];
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  syncUser: (currentUserId: string | null) => void;
  addItem: (menuItemId: string, quantity?: number) => void;
  removeItem: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  clearCart: () => void;
  getItemQuantity: (menuItemId: string) => number;
  getTotalItemCount: () => number;
}

const memoryStorageMap: Record<string, string> = {};
const fallbackMemoryStorage: StateStorage = {
  getItem: (name: string) => memoryStorageMap[name] ?? null,
  setItem: (name: string, value: string) => {
    memoryStorageMap[name] = value;
  },
  removeItem: (name: string) => {
    delete memoryStorageMap[name];
  },
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      userId: null,
      items: [],
      hasHydrated: false,

      setHasHydrated: (hasHydrated: boolean) => {
        set({ hasHydrated });
      },

      syncUser: (currentUserId: string | null) => {
        set((state) => {
          if (!currentUserId) {
            // User signed out
            return { userId: null, items: [] };
          }
          if (state.userId && state.userId !== currentUserId) {
            // Different user signed in -> clear previous user's cart
            return { userId: currentUserId, items: [] };
          }
          return { userId: currentUserId };
        });
      },

      addItem: (menuItemId: string, quantity = 1) => {
        if (quantity <= 0) return;
        set((state) => {
          const existingIndex = state.items.findIndex(
            (item) => item.menu_item_id === menuItemId
          );
          if (existingIndex > -1) {
            const updated = [...state.items];
            const newQty = Math.min(
              MAX_ITEM_QUANTITY,
              updated[existingIndex].quantity + quantity
            );
            updated[existingIndex] = {
              ...updated[existingIndex],
              quantity: newQty,
            };
            return { items: updated };
          }

          return {
            items: [
              ...state.items,
              {
                menu_item_id: menuItemId,
                quantity: Math.min(MAX_ITEM_QUANTITY, quantity),
              },
            ],
          };
        });
      },

      removeItem: (menuItemId: string) => {
        set((state) => ({
          items: state.items.filter((item) => item.menu_item_id !== menuItemId),
        }));
      },

      updateQuantity: (menuItemId: string, quantity: number) => {
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter(
                (item) => item.menu_item_id !== menuItemId
              ),
            };
          }
          const clampedQty = Math.min(MAX_ITEM_QUANTITY, quantity);
          return {
            items: state.items.map((item) =>
              item.menu_item_id === menuItemId
                ? { ...item, quantity: clampedQty }
                : item
            ),
          };
        });
      },

      clearCart: () => {
        set({ items: [] });
      },

      getItemQuantity: (menuItemId: string) => {
        const item = get().items.find(
          (entry) => entry.menu_item_id === menuItemId
        );
        return item ? item.quantity : 0;
      },

      getTotalItemCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage;
        }
        return fallbackMemoryStorage;
      }),
      partialize: (state) => ({
        userId: state.userId,
        items: state.items,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

