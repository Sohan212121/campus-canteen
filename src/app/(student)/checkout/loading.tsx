import { Skeleton } from "@/components/ui/skeleton";

export default function CheckoutLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" aria-label="Loading checkout">
      {/* Header */}
      <div className="flex items-center gap-3 pt-1">
        <Skeleton className="h-8 w-8 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        <Skeleton className="h-6 w-28 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
      </div>

      {/* Pickup Slot Selection Card */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-sm bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
          <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <Skeleton className="h-14 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <Skeleton className="h-14 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        </div>
      </div>

      {/* Items Preview */}
      <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-4 space-y-2.5 shadow-xs">
        <Skeleton className="h-4 w-28 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-36 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            <Skeleton className="h-4 w-12 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-28 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            <Skeleton className="h-4 w-10 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
        </div>
      </div>

      {/* Payment Method Card */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <Skeleton className="h-4 w-32 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <Skeleton className="h-12 w-full rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
        </div>
      </div>

      {/* Pay Button */}
      <Skeleton className="h-12 w-full rounded-2xl bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
    </div>
  );
}
