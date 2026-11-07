type UnstableCacheFn = typeof import("next/cache").unstable_cache;

function getUnstableCache(): UnstableCacheFn | undefined {
  try {
    // Use dynamic require so Vitest module mock without unstable_cache returns undefined instead of throwing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextCache = require("next/cache");
    if (nextCache && typeof nextCache.unstable_cache === "function") {
      return nextCache.unstable_cache;
    }
  } catch {
    // Graceful fallback
  }
  return undefined;
}

function getRevalidateTag(): ((tag: string) => void) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextCache = require("next/cache");
    if (nextCache && typeof nextCache.revalidateTag === "function") {
      return nextCache.revalidateTag;
    }
  } catch {
    // Graceful fallback
  }
  return undefined;
}

/**
 * Safe wrapper around Next.js unstable_cache that gracefully degrades to the
 * underlying fetcher function in environments where Next.js incrementalCache
 * is not initialized or where next/cache is mocked (e.g. Vitest unit tests, CLI scripts).
 *
 * In production server runtime, utilizes Next.js Data Cache with tag revalidation.
 */
export function safeUnstableCache<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  keyParts: string[],
  options?: { tags?: string[]; revalidate?: number | false }
): (...args: Args) => Promise<T> {
  const unstableCache = getUnstableCache();
  if (!unstableCache) {
    return fn;
  }

  let cached: ((...args: Args) => Promise<T>) | undefined;
  try {
    cached = unstableCache(fn, keyParts, options);
  } catch {
    return fn;
  }

  return async (...args: Args): Promise<T> => {
    try {
      if (cached) {
        return await cached(...args);
      }
      return await fn(...args);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.includes("incrementalCache missing") ||
          err.message.includes("Invariant: incrementalCache"))
      ) {
        return await fn(...args);
      }
      throw err;
    }
  };
}

/**
 * Safely triggers revalidateTag without throwing in test environments where
 * next/cache has been mocked without revalidateTag.
 */
export function safeRevalidateTag(tag: string): void {
  try {
    const revalidateTagFn = getRevalidateTag();
    if (revalidateTagFn) {
      // Pass 'max' to satisfy Next.js 16 signature
      (revalidateTagFn as (t: string, profile?: string) => void)(tag, "max");
    }
  } catch {
    // Non-blocking in test or restricted environments
  }
}
