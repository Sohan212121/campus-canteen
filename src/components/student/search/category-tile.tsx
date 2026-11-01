"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { FoodCategory } from "@/lib/search/categories";
import { cn } from "@/lib/utils";

interface CategoryTileProps {
  category: FoodCategory;
  photoUrl: string | null;
  matchingCount: number;
  onSelect: (category: FoodCategory) => void;
  isShaking?: boolean;
}

export function CategoryTile({
  category,
  photoUrl,
  matchingCount,
  onSelect,
  isShaking = false,
}: CategoryTileProps) {
  const [imageError, setImageError] = useState(false);
  const IconComponent = category.icon;
  const hasPhoto = Boolean(photoUrl && !imageError);

  return (
    <button
      type="button"
      onClick={() => onSelect(category)}
      aria-label={`${category.label}${matchingCount > 0 ? `, ${matchingCount} dishes available` : ""}`}
      className={cn(
        "group flex flex-col items-center justify-start text-center p-2 rounded-2xl transition-all select-none cursor-pointer active:scale-95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary min-w-[96px] min-h-[110px]",
        isShaking && "animate-shake motion-reduce:animate-none opacity-80"
      )}
    >
      {/* Round Photo / Icon Container */}
      <div className="relative mb-2 flex items-center justify-center">
        <div
          className={cn(
            "relative w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden shadow-sm transition-transform duration-200 group-hover:scale-105 border-2",
            hasPhoto
              ? "border-[#ded5c4] dark:border-[#262836] bg-[#eae2d2] dark:bg-[#121319]"
              : cn("border-transparent", category.accentColor)
          )}
        >
          {hasPhoto ? (
            <img
              src={photoUrl!}
              alt=""
              loading="lazy"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <IconComponent className="w-8 h-8 stroke-[2]" />
            </div>
          )}
        </div>

        {/* Small badge indicating exact canteen photo match */}
        {hasPhoto && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs border-2 border-white dark:border-[#121319]"
            title="Real canteen photo"
            aria-hidden="true"
          >
            <Check className="h-2.5 w-2.5 stroke-[3]" />
          </span>
        )}
      </div>

      {/* Label Underneath */}
      <span className="text-xs sm:text-[13px] font-bold text-[#181513] dark:text-[#f8fafc] group-hover:text-primary transition-colors line-clamp-1 leading-snug">
        {category.label}
      </span>
    </button>
  );
}
