import { Skeleton } from "@/components/ui/skeleton";

export default function StaffLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" aria-label="Loading staff board">
      {/* Title & Stats Bar */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-56 rounded-lg bg-muted/80" />
        <Skeleton className="h-4 w-72 rounded-md bg-muted/60" />
      </div>

      {/* 3 Kitchen Board Status Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        {[
          { title: "New Orders", color: "border-blue-500/20" },
          { title: "Preparing", color: "border-amber-500/20" },
          { title: "Ready for Pickup", color: "border-emerald-500/20" },
        ].map((col, idx) => (
          <div
            key={idx}
            className="rounded-2xl border bg-card p-4 space-y-3 min-h-[480px]"
          >
            <div className="flex items-center justify-between pb-2 border-b">
              <Skeleton className="h-5 w-28 rounded-md bg-muted/80" />
              <Skeleton className="h-6 w-8 rounded-full bg-muted/80" />
            </div>
            {/* Ticket Cards */}
            {[1, 2].map((ticket) => (
              <div
                key={ticket}
                className="rounded-xl border bg-muted/30 p-3.5 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-20 rounded-md bg-muted/80" />
                  <Skeleton className="h-5 w-16 rounded-full bg-muted/80" />
                </div>
                <Skeleton className="h-4 w-3/4 rounded-md bg-muted/60" />
                <div className="space-y-1.5 pt-1 border-t">
                  <Skeleton className="h-3 w-1/2 rounded-md bg-muted/50" />
                  <Skeleton className="h-3 w-2/3 rounded-md bg-muted/50" />
                </div>
                <Skeleton className="h-9 w-full rounded-lg bg-muted/80 pt-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

