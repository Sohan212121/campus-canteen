import { Skeleton } from "@/components/ui/skeleton";

export default function MenuLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3.5 w-64" />
      </div>

      {/* Search Skeleton */}
      <Skeleton className="h-11 w-full rounded-xl" />

      {/* Filter Row Skeleton */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-9 w-44 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Category Pills Skeleton */}
      <div className="flex gap-2 overflow-hidden py-1">
        <Skeleton className="h-9 w-20 rounded-full shrink-0" />
        <Skeleton className="h-9 w-24 rounded-full shrink-0" />
        <Skeleton className="h-9 w-28 rounded-full shrink-0" />
        <Skeleton className="h-9 w-20 rounded-full shrink-0" />
      </div>

      {/* Item Cards Skeleton */}
      <div className="space-y-3 pt-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex gap-3 rounded-xl border border-border/60 bg-card p-3.5"
          >
            <div className="flex flex-1 flex-col justify-between space-y-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4.5 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
            <div className="flex flex-col items-center justify-between space-y-2">
              <Skeleton className="h-20 w-24 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
