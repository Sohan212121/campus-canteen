import { cache } from "react";
import { createReadOnlyClient } from "@/lib/supabase/server";

export type CanteenBasicInfo = {
  id: string;
  name: string;
  location: string | null;
  hold_minutes: number;
  is_active: boolean;
};

/**
 * Retrieves the ID of the primary active canteen.
 *
 * Wrapped with React cache() for per-request memoisation across Server Components.
 * Avoids unstable_cache because Supabase RLS requires session cookies, which
 * Next.js dynamic data source rules disallow inside cross-request cache scopes.
 */
export const getActiveCanteenId = cache(async (): Promise<string | null> => {
  const supabase = await createReadOnlyClient();
  const { data, error } = await supabase
    .from("canteens")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.id;
});

/**
 * Retrieves basic information for a canteen by ID.
 *
 * Wrapped with React cache() to deduplicate lookups between staff/admin layouts
 * and pages within the same request.
 */
export const getCanteenById = cache(
  async (canteenId: string): Promise<CanteenBasicInfo | null> => {
    if (!canteenId) return null;

    const supabase = await createReadOnlyClient();
    const { data, error } = await supabase
      .from("canteens")
      .select("id, name, location, hold_minutes, is_active")
      .eq("id", canteenId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as CanteenBasicInfo;
  }
);
