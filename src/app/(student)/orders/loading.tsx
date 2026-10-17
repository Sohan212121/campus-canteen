import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return (
    <div className="space-y-5 pb-16 max-w-lg mx-auto animate-in fade-in duration-150">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3.5 w-48" />
      </div>

      {/* Tabs Skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>

      {/* Order Cards Skeleton */}
      <div className="space-y-3 pt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-border/80 bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-48" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
