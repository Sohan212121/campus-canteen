import { cache } from "react";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { safeUnstableCache } from "@/lib/safe-cache";

export type PublicCategory = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

async function fetchPublicCategories(canteenId: string): Promise<PublicCategory[]> {
  if (!canteenId) return [];

  const supabase = await createReadOnlyClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, display_order, is_active")
    .eq("canteen_id", canteenId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data as PublicCategory[];
}

const getCachedCategories = safeUnstableCache(
  fetchPublicCategories,
  ["public-categories"],
  {
    tags: ["categories"],
    revalidate: 60,
  }
);

/**
 * Retrieves public categories for an active canteen.
 *
 * Wrapped with React cache() for per-request deduplication, delegating to
 * safeUnstableCache() for 60-second cross-request caching.
 */
export const getPublicCategories = cache(
  async (canteenId: string): Promise<PublicCategory[]> => {
    if (!canteenId) return [];
    return await getCachedCategories(canteenId);
  }
);

