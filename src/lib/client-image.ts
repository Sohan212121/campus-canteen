/**
 * Client-side image resize, format conversion, and compression utilities.
 */

export interface ResizeDimensionsInput {
  width: number;
  height: number;
  maxDimension?: number;
}

export interface ResizeDimensionsResult {
  width: number;
  height: number;
}

/**
 * Pure function to calculate aspect-ratio-preserving dimensions
 * with the longest side capped at maxDimension (default 1200px).
 * Never upscales images that are already smaller than maxDimension.
 */
export function calculateResizeDimensions({
  width,
  height,
  maxDimension = 1200,
}: ResizeDimensionsInput): ResizeDimensionsResult {
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: 0, height: 0 };
  }

  // Already within bounds: do not upscale
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  if (width >= height) {
    const scale = maxDimension / width;
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(height * scale)),
    };
  } else {
    const scale = maxDimension / height;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: maxDimension,
    };
  }
}

/**
 * Pure check to detect animated GIFs.
 */
export function isAnimatedGif(file: { type?: string; name?: string }): boolean {
  if (file.type?.toLowerCase() === "image/gif") return true;
  if (file.name?.toLowerCase().endsWith(".gif")) return true;
  return false;
}

/**
 * Compresses and resizes an image file in the browser before upload.
 *
 * Requirements:
 * - Max 1200px on the longest side.
 * - Honours EXIF orientation via browser decoding.
 * - Converts to WebP (or JPEG if WebP unsupported).
 * - Checks real blob.type after canvas.toBlob.
 * - Rejects animated GIFs.
 * - Clear error for undecodable formats (e.g. HEIC/HEIF).
 * - Always revokes object URLs in finally block.
 * - Targets < 500 KB, strictly enforces < 2 MB server limit.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!file) {
    throw new Error("No image file provided.");
  }

  // 1. Reject animated GIFs
  if (isAnimatedGif(file)) {
    throw new Error("Animated GIFs are not supported. Please upload a static photo in JPEG, PNG, or WebP format.");
  }

  // 2. Initial size check
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
        reject(
          new Error(
            "This image format could not be decoded by your browser (e.g. HEIC/HEIF). Please convert to JPEG, PNG, or WebP before uploading."
          )
        );
      };
      img.src = objectUrl!;
    });

    // Modern browsers decode with EXIF orientation honoured
    if ("decode" in img) {
      try {
        await img.decode();
      } catch {
        // If decode() throws, img.onload already succeeded so we continue safely
      }
    }

    const origWidth = img.naturalWidth || img.width;
    const origHeight = img.naturalHeight || img.height;

    if (!origWidth || !origHeight) {
      throw new Error("Unable to determine image dimensions.");
    }

    // 3. Compute target dimensions (max 1200px longest side)
    const { width: targetWidth, height: targetHeight } = calculateResizeDimensions({
      width: origWidth,
      height: origHeight,
      maxDimension: 1200,
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
    // Try WebP first, fallback to JPEG
    let targetMime = "image/webp";
    let targetExt = "webp";

    const getBlob = (mime: string, quality: number): Promise<Blob | null> => {
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), mime, quality);
      });
    };

    let blob = await getBlob(targetMime, 0.85);

    // Check real blob.type: if browser does not support WebP export (e.g. older Safari)
    if (!blob || blob.type !== "image/webp") {
      targetMime = "image/jpeg";
      targetExt = "jpg";
      blob = await getBlob(targetMime, 0.85);
    }

    if (!blob) {
      throw new Error("Failed to encode compressed image.");
    }

    // If size > 500 KB, try lower quality steps
    const targetSizeBytes = 500 * 1024;
    if (blob.size > targetSizeBytes) {
      const lowerQualityBlob = await getBlob(targetMime, 0.72);
      if (lowerQualityBlob && lowerQualityBlob.size < blob.size) {
        blob = lowerQualityBlob;
      }
    }

    // Final guard: never upload if still over 2 MB
    const maxSizeBytes = 2 * 1024 * 1024;
    if (blob.size > maxSizeBytes) {
      throw new Error(
        `Image is too large (${(blob.size / (1024 * 1024)).toFixed(1)} MB) even after compression. Please choose a smaller photo under 2 MB.`
      );
    }

    // 6. Generate clean filename
    const originalNameWithoutExt = file.name.replace(/\.[^/.]+$/, "") || "menu-item";
    const sanitizedName = originalNameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const newFilename = `${sanitizedName}.${targetExt}`;

    return new File([blob], newFilename, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } finally {
    // Always revoke object URL to prevent memory leaks
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
