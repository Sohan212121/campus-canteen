/**
 * Image upload and validation utility for canteen menu images.
 */

export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface ImageValidationResult {
  valid: boolean;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  extension?: "jpg" | "png" | "webp";
  error?: string;
}

/**
 * Validates image bytes using magic byte signatures (header analysis).
 * Prevents disguised files (e.g. executable/html renamed to .jpg).
 */
export function validateImageBytes(bytes: Uint8Array): ImageValidationResult {
  if (!bytes || bytes.length === 0) {
    return { valid: false, error: "No image file provided." };
  }

  if (bytes.length > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: "Image file exceeds maximum 2 MB limit." };
  }

  // Check JPEG: starts with FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, mimeType: "image/jpeg", extension: "jpg" };
  }

  // Check PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { valid: true, mimeType: "image/png", extension: "png" };
  }

  // Check WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return { valid: true, mimeType: "image/webp", extension: "webp" };
  }

  return {
    valid: false,
    error: "Invalid image format. Allowed formats are JPEG, PNG, and WebP.",
  };
}

/**
 * Validates that an image URL belongs to the project's 'menu-images' storage bucket.
 * Prevents SSRF or embedding arbitrary external/untrusted image URLs.
 */
export function isAllowedMenuImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return true; // Optional URL is valid
  const trimmed = url.trim();
  if (trimmed === "") return true;

  try {
    const parsed = new URL(trimmed);
    return parsed.pathname.includes("/storage/v1/object/public/menu-images/");
  } catch {
    // Relative path check
    return trimmed.startsWith("/storage/v1/object/public/menu-images/");
  }
}

/**
 * Extracts storage filename from a menu-images public URL for safe deletion.
 */
export function extractStorageFilename(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/menu-images\/(.+)$/);
  if (match && match[1]) {
    // Clean query parameters or hash if any
    return match[1].split("?")[0].split("#")[0];
  }
  return null;
}
