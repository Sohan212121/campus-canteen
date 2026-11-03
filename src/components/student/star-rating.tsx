"use client";

import { Star } from "lucide-react";

interface StarRatingDisplayProps {
  rating: number | null | undefined;
  count?: number | null | undefined;
  size?: "sm" | "md" | "lg";
  showCount?: boolean;
  className?: string;
}

export function StarRatingDisplay({
  rating,
  count,
  size = "sm",
  showCount = true,
  className = "",
}: StarRatingDisplayProps) {
  const numRating = rating ? Number(rating) : null;
  const hasCount = count !== undefined && count !== null;
  const numCount = hasCount ? Number(count) : 0;

  const starSizes = {
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base font-semibold",
  };

  if (!numRating || numRating <= 0 || (showCount && hasCount && numCount === 0)) {
    return (
      <span className={`inline-flex items-center text-muted-foreground ${textSizes[size]} ${className}`}>
        No reviews yet
      </span>
    );
  }

  const rounded = Math.round(numRating * 10) / 10;
  const textAlternative = `${rounded} out of 5 stars${showCount && hasCount ? `, ${numCount} reviews` : ""}`;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      {/* Visual Stars (Aria Hidden) */}
      <div className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = numRating >= star;
          const half = !filled && numRating >= star - 0.5;

          return (
            <Star
              key={star}
              className={`${starSizes[size]} ${
                filled
                  ? "fill-amber-400 text-amber-500"
                  : half
                  ? "fill-amber-200 text-amber-500"
                  : "fill-muted text-muted-foreground/30"
              }`}
            />
          );
        })}
      </div>

      {/* Screen reader & numeric label */}
      <span className={`font-semibold text-foreground ${textSizes[size]}`}>
        <span className="sr-only">{textAlternative}</span>
        <span aria-hidden="true">{rounded.toFixed(1)}</span>
      </span>

      {showCount && hasCount && numCount > 0 && (
        <span className={`text-muted-foreground ${textSizes[size]}`} aria-hidden="true">
          ({numCount})
        </span>
      )}
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (rating: number) => void;
  itemName: string;
  disabled?: boolean;
}

export function StarRatingInput({
  value,
  onChange,
  itemName,
  disabled = false,
}: StarRatingInputProps) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-xs font-semibold text-foreground">
        Rate {itemName}
      </legend>

      {/* Accessible native radio group with 44px tap targets */}
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label={`Rating for ${itemName}`}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const isSelected = value === star;
          const isFilled = value >= star;

          return (
            <label
              key={star}
              className={`relative flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl transition-all ${
                disabled ? "cursor-not-allowed opacity-50" : "hover:scale-105 active:scale-95"
              }`}
            >
              <input
                type="radio"
                name={`rating-${itemName}`}
                value={star}
                checked={isSelected}
                onChange={() => onChange(star)}
                disabled={disabled}
                className="sr-only"
                aria-label={`${star} star${star !== 1 ? "s" : ""}`}
              />
              <Star
                className={`h-7 w-7 transition-colors ${
                  isFilled
                    ? "fill-amber-400 text-amber-500"
                    : "fill-muted text-muted-foreground/40 hover:text-amber-400"
                }`}
                aria-hidden="true"
              />
            </label>
          );
        })}

        {/* Live textual representation of selected rating */}
        <span className="ml-2 text-xs font-semibold text-muted-foreground" aria-live="polite">
          {value > 0 ? `${value} out of 5` : "Select a rating"}
        </span>
      </div>
    </fieldset>
  );
}
