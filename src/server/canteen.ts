import { createReadOnlyClient } from "@/lib/supabase/server";

/**
 * Retrieves the ID of the primary active canteen.
 *
 * Used to filter categories, menu items, and preview lists by canteen_id
 * without hardcoding canteen IDs.
 */
export async function getActiveCanteenId(): Promise<string | null> {
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
