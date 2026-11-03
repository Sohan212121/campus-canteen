import { Skeleton } from "@/components/ui/skeleton";

export default function StudentHomeLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" aria-label="Loading home page">
      {/* 1. Greeting Header Skeleton */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-32 rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <Skeleton className="h-3.5 w-24 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
          </div>
        </div>
        <Skeleton className="h-7 w-20 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* 2. Hero Banner Skeleton */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
          <Skeleton className="h-5 w-16 rounded-full bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
        <Skeleton className="h-6 w-3/4 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-4 w-1/2 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/70" />
      </div>

      {/* 3. Search & Filter Bar Skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        {/* Category Pills Strip */}
        <div className="flex gap-2 overflow-x-hidden pt-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton
              key={i}
              className="h-9 w-20 shrink-0 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]"
            />
          ))}
        </div>
      </div>

      {/* 4. Menu Items Grid Skeleton */}
      <div className="grid grid-cols-2 gap-3.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3 space-y-2.5 shadow-xs"
          >
            <Skeleton className="aspect-square w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <div className="space-y-1.5 pt-1">
              <Skeleton className="h-4 w-4/5 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              <div className="flex items-center justify-between pt-1">
                <Skeleton className="h-4 w-12 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-7 w-14 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
