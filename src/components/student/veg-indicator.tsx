import { cn } from "@/lib/utils";

interface VegIndicatorProps {
  isVeg: boolean;
  className?: string;
  showLabel?: boolean;
}

export function VegIndicator({
  isVeg,
  className,
  showLabel = false,
}: VegIndicatorProps) {
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border p-0.5",
          isVeg
            ? "border-emerald-600 bg-white dark:bg-zinc-900"
            : "border-red-600 bg-white dark:bg-zinc-900"
        )}
        title={isVeg ? "Vegetarian" : "Non-Vegetarian"}
        aria-label={isVeg ? "Vegetarian" : "Non-Vegetarian"}
      >
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            isVeg ? "bg-emerald-600" : "bg-red-600"
          )}
        />
      </div>
      {showLabel && (
        <span
          className={cn(
            "text-xs font-medium",
            isVeg ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
          )}
        >
          {isVeg ? "Veg" : "Non-Veg"}
        </span>
      )}
    </div>
  );
}
