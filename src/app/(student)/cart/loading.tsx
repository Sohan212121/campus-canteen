import { Skeleton } from "@/components/ui/skeleton";

export default function CartLoading() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200" aria-label="Loading cart">
      {/* Header title */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-7 w-28 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-6 w-16 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* Cart Items List */}
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 flex gap-3 shadow-xs"
          >
            <Skeleton className="h-16 w-16 shrink-0 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <div className="flex-1 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-4 w-14 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Skeleton className="h-7 w-20 rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
                <Skeleton className="h-6 w-6 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bill Summary Card */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <Skeleton className="h-5 w-28 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="space-y-2 border-t border-[#decdb0]/40 dark:border-[#222533] pt-2.5">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-20 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            <Skeleton className="h-4 w-12 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-4 w-24 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            <Skeleton className="h-4 w-10 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
          <div className="flex justify-between pt-2 border-t border-[#decdb0]/40 dark:border-[#222533]">
            <Skeleton className="h-5 w-20 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
            <Skeleton className="h-5 w-16 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
          </div>
        </div>
      </div>

      {/* Checkout Action Button */}
      <Skeleton className="h-12 w-full rounded-2xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
    </div>
  );
}
