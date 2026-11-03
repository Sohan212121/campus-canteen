import { Skeleton } from "@/components/ui/skeleton";

export default function MenuLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" aria-label="Loading menu">
      {/* Search Bar Skeleton */}
      <Skeleton className="h-11 w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />

      {/* Filter Row: Veg segmented control + Available toggle */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-40 rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        <Skeleton className="h-7 w-28 rounded-lg bg-[#e6dac5]/60 dark:bg-[#1a1c26]/70" />
      </div>

      {/* Category Horizontal Pills */}
      <div className="flex gap-2 overflow-x-hidden py-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton
            key={i}
            className="h-8 w-20 shrink-0 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]"
          />
        ))}
      </div>

      {/* Menu Item Cards */}
      <div className="space-y-3 pt-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 flex gap-3 shadow-xs"
          >
            <Skeleton className="h-24 w-24 shrink-0 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <div className="flex-1 flex flex-col justify-between py-0.5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Skeleton className="h-3.5 w-3.5 rounded-sm bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                  <Skeleton className="h-4 w-3/5 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                </div>
                <Skeleton className="h-3 w-4/5 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Skeleton className="h-4 w-14 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-8 w-16 rounded-xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
