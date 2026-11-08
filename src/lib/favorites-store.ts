import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { toast } from "sonner";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

export const FAVORITES_STORAGE_KEY = "campus-canteen-favorites";

export type FavoriteItem = {
  id: string;
  canteen_id?: string;
  category_id?: string | null;
  name: string;
  description?: string | null;
  price_paise: number;
  image_url?: string | null;
  is_veg: boolean;
  is_available?: boolean;
  stock?: number | null;
  prep_minutes?: number;
  is_active?: boolean;
  rating_avg?: number | null;
  rating_count?: number;
  calories_kcal?: number | null;
  protein_g?: number | null;
  added_at: number;
};

export interface FavoritesState {
  items: Record<string, FavoriteItem>;
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  toggleFavorite: (item: MenuItemData | FavoriteItem) => boolean;
  addFavorite: (item: MenuItemData | FavoriteItem) => void;
  removeFavorite: (itemId: string) => void;
  isFavorite: (itemId: string) => boolean;
  getFavoritesCount: () => number;
  getFavoritesList: () => FavoriteItem[];
  clearFavorites: () => void;
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

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      items: {},
      hasHydrated: false,

      setHasHydrated: (hasHydrated: boolean) => {
        set({ hasHydrated });
      },

      toggleFavorite: (item) => {
        const currentItems = get().items;
        const exists = Boolean(currentItems[item.id]);

        if (exists) {
          const next = { ...currentItems };
          delete next[item.id];
          set({ items: next });
          toast.info(`Removed ${item.name} from favorites`, {
            id: `fav-${item.id}`,
          });
          return false;
        } else {
          const favoriteItem: FavoriteItem = {
            id: item.id,
            canteen_id: item.canteen_id,
            category_id: item.category_id,
            name: item.name,
            description: item.description,
            price_paise: item.price_paise,
            image_url: item.image_url,
            is_veg: item.is_veg,
            is_available: item.is_available ?? true,
            stock: item.stock ?? null,
            prep_minutes: item.prep_minutes ?? 0,
            is_active: item.is_active ?? true,
            rating_avg: item.rating_avg,
            rating_count: item.rating_count,
            calories_kcal: item.calories_kcal,
            protein_g: item.protein_g,
            added_at: Date.now(),
          };

          set({
            items: {
              ...currentItems,
              [item.id]: favoriteItem,
            },
          });
          toast.success(`Saved ${item.name} to favorites ❤️`, {
            id: `fav-${item.id}`,
          });
          return true;
        }
      },

      addFavorite: (item) => {
        const currentItems = get().items;
        if (currentItems[item.id]) return;

        const favoriteItem: FavoriteItem = {
          id: item.id,
          canteen_id: item.canteen_id,
          category_id: item.category_id,
          name: item.name,
          description: item.description,
          price_paise: item.price_paise,
          image_url: item.image_url,
          is_veg: item.is_veg,
          is_available: item.is_available ?? true,
          stock: item.stock ?? null,
          prep_minutes: item.prep_minutes ?? 0,
          is_active: item.is_active ?? true,
          rating_avg: item.rating_avg,
          rating_count: item.rating_count,
          calories_kcal: item.calories_kcal,
          protein_g: item.protein_g,
          added_at: Date.now(),
        };

        set({
          items: {
            ...currentItems,
            [item.id]: favoriteItem,
          },
        });
      },

      removeFavorite: (itemId: string) => {
        const currentItems = get().items;
        if (!currentItems[itemId]) return;

        const next = { ...currentItems };
        delete next[itemId];
        set({ items: next });
      },

      isFavorite: (itemId: string) => {
        return Boolean(get().items[itemId]);
      },

      getFavoritesCount: () => {
        return Object.keys(get().items).length;
      },

      getFavoritesList: () => {
        return Object.values(get().items).sort((a, b) => b.added_at - a.added_at);
      },

      clearFavorites: () => {
        set({ items: {} });
      },
    }),
    {
      name: FAVORITES_STORAGE_KEY,
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage;
        }
        return fallbackMemoryStorage;
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        items: state.items,
      }),
    }
  )
);
