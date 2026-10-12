/**
 * Pure image validation, fallback decision, and relation normalisation utilities.
 */

export type MenuItemJoinRelation =
  | { image_url?: string | null }
  | Array<{ image_url?: string | null }>
  | null
  | undefined;

/**
 * Validates that an image URL belongs to the allowed Supabase storage pattern
 * for 'menu-images'. Returns false for missing, invalid, data:, javascript:,
 * or foreign untrusted URLs.
 */
export function isValidMenuImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Block dangerous schemes
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return false;
  }

  // Must contain the canonical menu-images public storage path
  const storagePath = "/storage/v1/object/public/menu-images/";

  try {
    const parsed = new URL(trimmed);
    // Absolute URL: ensure pathname contains storage path
    if (!parsed.pathname.includes(storagePath)) {
      return false;
    }

    // Protocol must be http or https
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    return true;
  } catch {
    // Relative URL path check
    return trimmed.startsWith(storagePath);
  }
}

/**
 * Pure function determining whether an image component should attempt to render
 * via next/image or fallback to the static placeholder.
 *
 * Requirements:
 * - If hasError is true -> false (render placeholder)
 * - If src is missing, null, undefined, or empty -> false (render placeholder)
 * - If src fails storage pattern validation -> false (render placeholder)
 * - Otherwise -> true (render next/image)
 */
export function shouldRenderMenuImage(
  src: string | null | undefined,
  hasError: boolean
): boolean {
  if (hasError) return false;
  return isValidMenuImageUrl(src);
}

/**
 * Normalises the PostgREST relation shape for menu_items across all order queries.
 * Handles:
 * - null or undefined -> null
 * - Single relation object { image_url: string | null } -> image_url
 * - Relation array [{ image_url: string | null }] -> first item's image_url
 */
export function extractMenuItemImageUrl(relation: MenuItemJoinRelation): string | null {
  if (!relation) return null;

  if (Array.isArray(relation)) {
    if (relation.length === 0) return null;
    const first = relation[0];
    return first?.image_url ?? null;
  }

  if (typeof relation === "object" && "image_url" in relation) {
    return relation.image_url ?? null;
  }

  return null;
}
