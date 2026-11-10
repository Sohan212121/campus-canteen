import { calculateResizeDimensions, isAnimatedGif } from "@/lib/client-image";

export const MAX_AVATAR_DIMENSION = 512;
export const MAX_AVATAR_SIZE_BYTES = 1048576; // 1 MB hard limit
export const TARGET_AVATAR_SIZE_BYTES = 300 * 1024; // 300 KB target

const AVATAR_PATH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/;

/**
 * Validates that an avatar storage path strictly conforms to the expected shape:
 * `<user-uuid>/<safe-filename>.<webp|jpg|jpeg|png>` and length <= 120.
 * Optionally verifies that the path belongs to the expected user ID.
 */
export function isValidAvatarPath(
  path: string | null | undefined,
  expectedUserId?: string
): boolean {
  if (!path || typeof path !== "string") return false;
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;

  // Block directory traversal and backslashes
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) {
    return false;
  }

  if (!AVATAR_PATH_REGEX.test(trimmed)) {
    return false;
  }

  if (expectedUserId) {
    const [userIdSegment] = trimmed.split("/");
    if (userIdSegment !== expectedUserId) {
      return false;
    }
  }

  return true;
}

/**
 * Generates a collision-resistant, valid avatar storage path for a user:
 * `<userId>/avatar_<timestamp>_<random>.<ext>`
 */
export function buildAvatarStoragePath(
  userId: string,
  extension: "webp" | "jpg" | "png" = "webp"
): string {
  const ext = extension.toLowerCase();
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now();
  const filename = `avatar_${timestamp}_${randomSuffix}.${ext}`;
  return `${userId}/${filename}`;
}

/**
 * Validates image magic bytes to verify that the byte stream represents
 * a genuine JPEG, PNG, or WebP image.
 * Returns the detected MIME type, or null if invalid/unsupported (e.g. GIF, SVG, HTML).
 */
export function validateImageMagicBytes(
  input: ArrayBuffer | Uint8Array
): "image/jpeg" | "image/png" | "image/webp" | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) return null;

  // 1. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // 3. WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  // 'R' = 0x52, 'I' = 0x49, 'F' = 0x46, 'F' = 0x46
  // 'W' = 0x57, 'E' = 0x45, 'B' = 0x42, 'P' = 0x50
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Compresses and resizes a profile photo in the browser before upload:
 * - Rejects animated GIFs and non-images.
 * - Caps max dimension at 512px (aspect ratio preserved).
 * - Converts to WebP (with fallback to JPEG).
 * - Targets < 300 KB, hard caps at < 1 MB.
 * - Friendly error on decode failure (e.g. HEIC): "Please choose a JPEG, PNG or WebP photo."
 */
export async function compressAvatarForUpload(file: File): Promise<File> {
  if (!file) {
    throw new Error("No image file provided.");
  }

  // 1. Reject animated GIFs
  if (isAnimatedGif(file)) {
    throw new Error("Please choose a JPEG, PNG or WebP photo.");
  }

  // 2. Reject empty or oversized raw files
  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = URL.createObjectURL(file);
    const img = new Image();

    // Load and decode image
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => {
        reject(new Error("Please choose a JPEG, PNG or WebP photo."));
      };
      img.src = objectUrl!;
    });

    if ("decode" in img) {
      try {
        await img.decode();
      } catch {
        // Continue if decode throws but onload succeeded
      }
    }

    const origWidth = img.naturalWidth || img.width;
    const origHeight = img.naturalHeight || img.height;

    if (!origWidth || !origHeight) {
      throw new Error("Please choose a JPEG, PNG or WebP photo.");
    }

    // 3. Compute target dimensions (max 512px longest side)
    const { width: targetWidth, height: targetHeight } = calculateResizeDimensions({
      width: origWidth,
      height: origHeight,
      maxDimension: MAX_AVATAR_DIMENSION,
    });

    // 4. Render to Canvas
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Canvas context could not be initialized.");
    }

    // Fill white background for transparent PNG converted to JPEG/WebP
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // 5. Convert to Blob with quality optimization
    let targetMime = "image/webp";
    let targetExt: "webp" | "jpg" = "webp";

    const getBlob = (mime: string, quality: number): Promise<Blob | null> => {
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), mime, quality);
      });
    };

    let blob = await getBlob(targetMime, 0.85);

    // If browser cannot export WebP, fallback to JPEG
    if (!blob || blob.type !== "image/webp") {
      targetMime = "image/jpeg";
      targetExt = "jpg";
      blob = await getBlob(targetMime, 0.85);
    }

    if (!blob) {
      throw new Error("Failed to encode compressed image.");
    }

    // If size > target (300 KB), try lower quality
    if (blob.size > TARGET_AVATAR_SIZE_BYTES) {
      const lowerQualityBlob = await getBlob(targetMime, 0.72);
      if (lowerQualityBlob && lowerQualityBlob.size < blob.size) {
        blob = lowerQualityBlob;
      }
    }

    // Final guard: never upload if still over 1 MB limit
    if (blob.size > MAX_AVATAR_SIZE_BYTES) {
      throw new Error("The photo is too large after compression. Please choose a smaller photo under 1 MB.");
    }

    const randomSuffix = Math.random().toString(36).slice(2, 10);
    const newFilename = `avatar_${Date.now()}_${randomSuffix}.${targetExt}`;

    return new File([blob], newFilename, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

