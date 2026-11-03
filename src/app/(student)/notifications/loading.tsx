import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" aria-label="Loading notifications">
      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-7 w-32 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        <Skeleton className="h-8 w-28 rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>

      {/* Notification items */}
      <div className="space-y-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 flex gap-3 shadow-xs"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            <div className="flex-1 space-y-1.5 py-0.5">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-36 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
                <Skeleton className="h-3 w-14 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
              </div>
              <Skeleton className="h-3.5 w-4/5 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

