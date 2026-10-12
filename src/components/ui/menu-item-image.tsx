"use client";

import { useState } from "react";
import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldRenderMenuImage } from "@/lib/image-utils";

export interface MenuItemImageProps {
  src: string | null | undefined;
  alt: string;
  aspect?: "4/3" | "square" | "auto";
  sizes?: string;
  className?: string;
  placeholderClassName?: string;
  containerClassName?: string;
}

/**
 * Shared Menu Item Image Component
 *
 * Requirements:
 * - Uses next/image with unoptimized (no quality prop).
 * - Fixed aspect ratios (4:3 on cards, square on thumbnails).
 * - Lazy loading by default (loading="lazy").
 * - Explicit sizes attribute with sensible defaults to prevent layout shift.
 * - Loading skeleton shimmer until decoded.
 * - Pure storage pattern validation: if src is missing, invalid, or errored,
 *   renders the static placeholder and NEVER renders next/image.
 * - Alt text strictly equal to the item name.
 */
export function MenuItemImage({
  src,
  alt,
  aspect = "square",
  sizes,
  className,
  placeholderClassName,
  containerClassName,
}: MenuItemImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const canRenderImage = shouldRenderMenuImage(src, hasError);

  const aspectClass =
    aspect === "4/3"
      ? "aspect-[4/3]"
      : aspect === "square"
      ? "aspect-square"
      : "";

  const defaultSizes =
    sizes ??
    (aspect === "4/3"
      ? "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      : "64px");

  // Fallback placeholder (no next/image rendered)
  if (!canRenderImage || !src) {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center bg-muted/60 text-muted-foreground/50 overflow-hidden",
          aspectClass,
          containerClassName,
          placeholderClassName || className
        )}
        aria-label={`${alt} placeholder`}
      >
        <UtensilsCrossed className="h-5 w-5 stroke-[1.5]" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-muted/40",
        aspectClass,
        containerClassName
      )}
    >
      {/* Loading Skeleton Shimmer */}
      {isLoading && (
        <div
          className="absolute inset-0 z-10 bg-muted animate-pulse"
          aria-hidden="true"
        />
      )}

      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        loading="lazy"
        sizes={defaultSizes}
        onLoad={() => setIsLoading(false)}
        onError={() => setHasError(true)}
        className={cn(
          "object-cover transition-opacity duration-200",
          isLoading ? "opacity-0" : "opacity-100",
          className
        )}
      />
    </div>
  );
}
