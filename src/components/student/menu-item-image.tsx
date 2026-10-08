"use client";

import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

interface MenuItemImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}

export function MenuItemImage({
  src,
  alt,
  className,
  placeholderClassName,
}: MenuItemImageProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/60 text-muted-foreground/50",
          placeholderClassName || className
        )}
        aria-label={`${alt} placeholder`}
      >
        <UtensilsCrossed className="h-6 w-6 stroke-[1.5]" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setHasError(true)}
      className={cn("object-cover", className)}
    />
  );
}
