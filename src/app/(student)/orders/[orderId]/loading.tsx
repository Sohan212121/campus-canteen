import { Skeleton } from "@/components/ui/skeleton";

export default function OrderDetailLoading() {
  return (
    <div className="space-y-5 pb-16 max-w-lg mx-auto animate-in fade-in duration-150">
      {/* Top Breadcrumb Skeleton */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-6 w-32 rounded-lg" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      {/* Main Order Card Skeleton */}
      <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="flex flex-col items-end space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
      </div>

      {/* Progress Stepper Skeleton */}
      <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-3">
        <Skeleton className="h-3.5 w-36" />
        <div className="flex justify-between pt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>

      {/* Canteen Details Skeleton */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      </div>

      {/* Items Skeleton */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        <div className="space-y-3 pt-1">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
