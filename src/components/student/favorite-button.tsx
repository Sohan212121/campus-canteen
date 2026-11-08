"use client";

import { Heart } from "lucide-react";
import { useFavoritesStore } from "@/lib/favorites-store";
import type { MenuItemData } from "@/components/student/item-detail-sheet";
import { cn } from "@/lib/utils";

export interface FavoriteButtonProps {
  item: MenuItemData;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "floating" | "ghost" | "inline";
  showLabel?: boolean;
  onToggled?: (isFavorite: boolean) => void;
}

export function FavoriteButton({
  item,
  className,
  size = "sm",
  variant = "floating",
  showLabel = false,
  onToggled,
}: FavoriteButtonProps) {
  const isFav = useFavoritesStore((s) => Boolean(s.items[item.id]));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const nextState = toggleFavorite(item);
    onToggled?.(nextState);
  };

  const sizeClasses = {
    sm: "w-7 h-7 sm:w-8 sm:h-8",
    md: "w-9 h-9 sm:w-10 sm:h-10",
    lg: "w-11 h-11",
  }[size];

  const iconSizes = {
    sm: "h-3.5 w-3.5 sm:h-4 sm:w-4",
    md: "h-4.5 w-4.5 sm:h-5 sm:w-5",
    lg: "h-5 w-5 sm:h-6 sm:w-6",
  }[size];

  const variantClasses = {
    floating:
      "rounded-full bg-white/95 dark:bg-[#121319]/95 backdrop-blur-md shadow-xs hover:bg-white dark:hover:bg-[#1a1c24] border border-black/10 dark:border-white/15 flex items-center justify-center transition-all active:scale-80 cursor-pointer",
    ghost:
      "rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-all active:scale-80 cursor-pointer",
    inline:
      "rounded-xl px-3 py-1.5 bg-white dark:bg-[#16171E] border border-border flex items-center gap-1.5 text-xs font-bold transition-all active:scale-95 cursor-pointer",
  }[variant];

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isFav ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
      title={isFav ? "Saved to Favorites" : "Add to Favorites"}
      className={cn(
        variant !== "inline" && sizeClasses,
        variantClasses,
        isFav ? "text-rose-500" : "text-stone-600 dark:text-stone-300 hover:text-rose-500",
        className
      )}
    >
      <Heart
        className={cn(
          iconSizes,
          "transition-all duration-200 stroke-[2.2]",
          isFav
            ? "fill-rose-500 text-rose-500 animate-in zoom-in-75 duration-200"
            : "hover:scale-110"
        )}
      />
      {showLabel && (
        <span className="font-headline text-xs">
          {isFav ? "Favorited" : "Favorite"}
        </span>
      )}
    </button>
  );
}
