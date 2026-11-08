/**
 * Preload Deduplication Helper
 * Pure set-based deduplication to ensure assets or routes are never preloaded redundantly.
 */

export class PreloadRegistry {
  private registered = new Set<string>();

  /**
   * Registers a resource href for preload if not already registered.
   * Returns true if registered (first time), false if duplicate.
   */
  register(href: string): boolean {
    const cleanHref = href.trim();
    if (!cleanHref || this.registered.has(cleanHref)) {
      return false;
    }
    this.registered.add(cleanHref);
    return true;
  }

  has(href: string): boolean {
    return this.registered.has(href.trim());
  }

  size(): number {
    return this.registered.size;
  }

  clear(): void {
    this.registered.clear();
  }
}

/**
 * Pure deduplication of a list of resource URLs.
 */
export function deduplicatePreloadUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }

  return deduped;
}
