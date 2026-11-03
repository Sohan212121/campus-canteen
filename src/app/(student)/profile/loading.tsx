import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200" aria-label="Loading profile">
      {/* 1. Digital ID Pass Card Skeleton */}
      <div className="rounded-3xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#2a1111]/30 dark:bg-[#1a0f0f]/40 p-5 space-y-4 shadow-xs">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-2xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
            <Skeleton className="h-4 w-24 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
          </div>
        </div>
        <div className="pt-2 border-t border-black/10 dark:border-white/10 flex justify-between items-center">
          <Skeleton className="h-4 w-28 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
          <Skeleton className="h-5 w-20 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
        </div>
      </div>

      {/* 2. Pre-ordered Food Review Card Skeleton */}
      <div className="rounded-2xl border border-[#decdb0]/60 dark:border-[#222533] bg-[#efe3cb]/50 dark:bg-[#121319] p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-36 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
          <Skeleton className="h-4 w-16 rounded-md bg-[#e6dac5]/60 dark:bg-[#1f2230]/60" />
        </div>
        <div className="flex gap-2.5 overflow-x-hidden pt-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-28 shrink-0 rounded-xl border border-[#decdb0]/40 dark:border-[#222533] p-2 space-y-1.5"
            >
              <Skeleton className="h-14 w-full rounded-lg bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
              <Skeleton className="h-3 w-4/5 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
            </div>
          ))}
        </div>
      </div>

      {/* 3. Stats Bento Row Skeleton */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 space-y-2 shadow-xs">
          <Skeleton className="h-4 w-20 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <Skeleton className="h-6 w-14 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
        <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 space-y-2 shadow-xs">
          <Skeleton className="h-4 w-20 rounded-md bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <Skeleton className="h-6 w-14 rounded-lg bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
        </div>
      </div>

      {/* 4. Theme & Appearance Card Skeleton */}
      <div className="rounded-2xl border border-[#decdb0]/50 dark:border-[#222533] bg-[#efe3cb]/40 dark:bg-[#121319] p-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-28 rounded-md bg-[#e6dac5]/80 dark:bg-[#1f2230]" />
            <Skeleton className="h-3 w-36 rounded-md bg-[#e6dac5]/50 dark:bg-[#1a1c26]/60" />
          </div>
        </div>
        <Skeleton className="h-7 w-12 rounded-full bg-[#e6dac5]/70 dark:bg-[#1a1c26]" />
      </div>
    </div>
  );
}
