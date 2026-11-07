import { cache } from "react";
import { createReadOnlyClient } from "@/lib/supabase/server";

export type PublicCategory = {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
};

/**
 * Retrieves public categories for an active canteen.
 *
 * Wrapped with React cache() for per-request deduplication across Server Components.
 * Avoids unstable_cache because Supabase RLS requires session cookies, which
 * Next.js dynamic data source rules disallow inside cross-request cache scopes.
 */
export const getPublicCategories = cache(
  async (canteenId: string): Promise<PublicCategory[]> => {
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
);
