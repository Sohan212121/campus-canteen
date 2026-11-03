import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" aria-label="Loading orders">
      {/* Title */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-7 w-32 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-6 w-20 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* Active Order Card Skeleton */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
          <Skeleton className="h-6 w-20 rounded-full bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-5 w-24 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
            <Skeleton className="h-3.5 w-36 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
          <Skeleton className="h-10 w-28 rounded-xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
      </div>

      {/* Past Orders Section */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-28 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 space-y-2.5 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              <Skeleton className="h-5 w-16 rounded-full bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            </div>
            <Skeleton className="h-3.5 w-3/4 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
            <div className="flex items-center justify-between pt-1 border-t border-[#decdb0]/30 dark:border-[#222533]">
              <Skeleton className="h-4 w-16 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              <Skeleton className="h-7 w-20 rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
