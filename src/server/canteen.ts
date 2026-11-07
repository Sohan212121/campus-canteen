import { cache } from "react";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { safeUnstableCache } from "@/lib/safe-cache";

export type CanteenBasicInfo = {
  id: string;
  name: string;
  location: string | null;
  hold_minutes: number;
  is_active: boolean;
};

/**
 * Underlying query to find the primary active canteen ID.
 */
async function fetchActiveCanteenId(): Promise<string | null> {
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
}

const getCachedActiveCanteenId = safeUnstableCache(
  fetchActiveCanteenId,
  ["active-canteen-id"],
  {
    tags: ["canteen-active"],
    revalidate: 60,
  }
);

/**
 * Retrieves the ID of the primary active canteen.
 *
 * Wrapped with React cache() for per-request memoisation across Server Components,
 * delegating to safeUnstableCache() for 60-second cross-request caching of public canteen status.
 */
export const getActiveCanteenId = cache(async (): Promise<string | null> => {
  return await getCachedActiveCanteenId();
});

/**
 * Underlying query to retrieve canteen basic metadata by ID.
 */
async function fetchCanteenById(canteenId: string): Promise<CanteenBasicInfo | null> {
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

const getCachedCanteenById = safeUnstableCache(
  fetchCanteenById,
  ["canteen-by-id"],
  {
    tags: ["canteen-details"],
    revalidate: 60,
  }
);

/**
 * Retrieves basic information for a canteen by ID.
 *
 * Wrapped with React cache() to deduplicate lookups within the same request,
 * delegating to safeUnstableCache() for 60-second caching of public canteen settings.
 */
export const getCanteenById = cache(
  async (canteenId: string): Promise<CanteenBasicInfo | null> => {
    if (!canteenId) return null;
    return await getCachedCanteenById(canteenId);
  }
);
