import { Skeleton } from "@/components/ui/skeleton";

export default function HealthyScoreLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" aria-label="Loading healthy score explainer">
      {/* Back button */}
      <Skeleton className="h-6 w-36 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />

      {/* Hero Header Card */}
      <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-[#121319] p-6 space-y-3">
        <Skeleton className="h-6 w-44 rounded-full bg-emerald-500/15" />
        <Skeleton className="h-8 w-3/4 rounded-xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-4 w-full rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
        <Skeleton className="h-4 w-2/3 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
      </div>

      {/* Criteria Cards */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-4 flex items-center justify-between shadow-xs"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-3 w-48 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
              </div>
            </div>
            <Skeleton className="h-6 w-12 rounded-full bg-emerald-500/15" />
          </div>
        ))}
      </div>
    </div>
  );
}
