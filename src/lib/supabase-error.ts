export interface SupabaseErrorFields {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

/**
 * Formats a Supabase (PostgREST or Auth) error into a human-readable string.
 * Strictly logs message, code, details, and hint as plain strings.
 * Never logs secrets, query payloads, tokens, or user data.
 */
export function formatSupabaseError(scope: string, error: unknown): string {
  if (!error) {
    return `[${scope}] Supabase error: (empty/null)`;
  }

  if (typeof error === "string") {
    return `[${scope}] Supabase error: ${error}`;
  }

  if (typeof error === "object") {
    const candidate = error as SupabaseErrorFields;
    const code = candidate.code != null ? String(candidate.code) : "";
    const message = candidate.message != null ? String(candidate.message) : "";
    const details = candidate.details != null ? String(candidate.details) : "";
    const hint = candidate.hint != null ? String(candidate.hint) : "";

    const parts: string[] = [];
    if (code) parts.push(`code: "${code}"`);
    if (message) parts.push(`message: "${message}"`);
    if (details) parts.push(`details: "${details}"`);
    if (hint) parts.push(`hint: "${hint}"`);

    if (parts.length > 0) {
      return `[${scope}] Supabase error: ${parts.join(" | ")}`;
    }

    if (error instanceof Error && error.message) {
      return `[${scope}] Supabase error: message: "${error.message}"`;
    }
  }

  return `[${scope}] Supabase error: unknown error structure`;
}

/**
 * Logs a Supabase error to console.error with formatted plain strings.
 * Prevents Next.js Server Components from printing empty objects ({})
 * when non-enumerable properties are present.
 */
export function logSupabaseError(scope: string, error: unknown): void {
  console.error(formatSupabaseError(scope, error));
}

/**
 * Determines whether an error corresponds to PostgreSQL undefined_column (code 42703).
 * Used for graceful fallback during migration rollouts.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as SupabaseErrorFields;
  if (candidate.code === "42703" || candidate.code === 42703) return true;
  if (typeof candidate.message === "string") {
    const msg = candidate.message.toLowerCase();
    return (
      msg.includes("does not exist") &&
      (msg.includes("column") || msg.includes("calories_kcal") || msg.includes("ingredients"))
    );
  }
  return false;
}
