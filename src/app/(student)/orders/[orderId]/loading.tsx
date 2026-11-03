import { Skeleton } from "@/components/ui/skeleton";

export default function OrderDetailLoading() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200" aria-label="Loading order details">
      {/* Back button */}
      <Skeleton className="h-6 w-32 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />

      {/* Large Token Header Card */}
      <div className="rounded-3xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-6 text-center space-y-3 shadow-xs">
        <Skeleton className="h-4 w-28 mx-auto rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
        <Skeleton className="h-12 w-48 mx-auto rounded-xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-6 w-24 mx-auto rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* Progress Steps Timeline Bar */}
      <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="flex justify-between items-center px-2 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-8 w-8 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
              <Skeleton className="h-3 w-12 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
            </div>
          ))}
        </div>
      </div>

      {/* Items Breakdown Card */}
      <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <Skeleton className="h-4 w-24 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="space-y-2 border-t border-[#decdb0]/30 dark:border-[#222533] pt-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex justify-between items-center py-1">
              <div className="space-y-1">
                <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
                <Skeleton className="h-3 w-16 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
              </div>
              <Skeleton className="h-4 w-14 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
