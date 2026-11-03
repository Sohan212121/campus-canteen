import { Skeleton } from "@/components/ui/skeleton";

export default function HealthyLoading() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200" aria-label="Loading healthy mode">
      {/* Top Banner Card Skeleton */}
      <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-[#121319] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32 rounded-full bg-emerald-500/15 dark:bg-emerald-500/10" />
          <Skeleton className="h-5 w-20 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        </div>
        <Skeleton className="h-7 w-3/4 rounded-xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-4 w-4/5 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
      </div>

      {/* Metric Tabs Skeleton (Protein / Calories / Fibre) */}
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        <Skeleton className="h-10 flex-1 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        <Skeleton className="h-10 flex-1 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* Top Protein Row Carousel Skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-36 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="flex gap-3 overflow-x-hidden">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-48 shrink-0 rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3 space-y-2 shadow-xs"
            >
              <Skeleton className="h-28 w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
              <Skeleton className="h-4 w-4/5 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              <div className="flex justify-between items-center pt-1">
                <Skeleton className="h-4 w-12 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-6 w-16 rounded-full bg-emerald-500/15" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Healthy Items List Skeleton */}
      <div className="space-y-3 pt-1">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 flex gap-3 shadow-xs"
          >
            <Skeleton className="h-24 w-24 shrink-0 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <div className="flex-1 flex flex-col justify-between py-0.5">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-3/5 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16 rounded-md bg-emerald-500/15" />
                  <Skeleton className="h-5 w-16 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
                </div>
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
