import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" aria-label="Loading admin dashboard">
      {/* Header & Date Range selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48 rounded-lg bg-muted/80" />
          <Skeleton className="h-4 w-64 rounded-md bg-muted/60" />
        </div>
        <Skeleton className="h-10 w-44 rounded-xl bg-muted/80" />
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl border bg-card p-5 space-y-2 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24 rounded-md bg-muted/70" />
              <Skeleton className="h-8 w-8 rounded-lg bg-muted/80" />
            </div>
            <Skeleton className="h-8 w-28 rounded-lg bg-muted/90" />
            <Skeleton className="h-3.5 w-32 rounded-md bg-muted/50" />
          </div>
        ))}
      </div>

      {/* Main Content Panels (Charts & Recent Activity) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border bg-card p-5 space-y-4 shadow-xs min-h-[360px]">
          <div className="flex items-center justify-between pb-2 border-b">
            <Skeleton className="h-5 w-36 rounded-md bg-muted/80" />
            <Skeleton className="h-7 w-24 rounded-lg bg-muted/70" />
          </div>
          <Skeleton className="h-64 w-full rounded-xl bg-muted/40" />
        </div>
        <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-xs min-h-[360px]">
          <div className="flex items-center justify-between pb-2 border-b">
            <Skeleton className="h-5 w-32 rounded-md bg-muted/80" />
            <Skeleton className="h-6 w-12 rounded-full bg-muted/70" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((k) => (
              <div key={k} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24 rounded-md bg-muted/70" />
                  <Skeleton className="h-3 w-16 rounded-md bg-muted/50" />
                </div>
                <Skeleton className="h-5 w-16 rounded-md bg-muted/70" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

