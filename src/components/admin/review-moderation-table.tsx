"use client";

import { useState, useEffect, useTransition } from "react";
import { Search, Eye, EyeOff, Star, AlertTriangle, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  adminListReviewsAction,
  adminSetReviewHiddenAction,
  type AdminReviewRow,
} from "@/server/actions/admin-reviews";

const PAGE_SIZE = 15;

export function ReviewModerationTable() {
  const [status, setStatus] = useState<"all" | "visible" | "hidden">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const [reviews, setReviews] = useState<AdminReviewRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isFetching, startFetchTransition] = useTransition();

  // Moderation confirm state
  const [pendingAction, setPendingAction] = useState<{ review: AdminReviewRow; hide: boolean } | null>(null);
  const [isProcessing, startTransition] = useTransition();

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0); // Reset to first page on search change
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load reviews whenever status, debouncedSearch, or offset changes
  useEffect(() => {
    let active = true;

    startFetchTransition(async () => {
      try {
        const res = await adminListReviewsAction({
          status,
          search: debouncedSearch || null,
          limit: PAGE_SIZE,
          offset,
        });
        if (!active) return;
        if (res.success && res.data) {
          setReviews(res.data.reviews);
          setTotalCount(res.data.total_count);
        } else {
          toast.error(res.error || "Failed to load reviews");
        }
      } catch (err) {
        console.error("Error loading moderation reviews:", err);
        if (active) toast.error("Error fetching reviews");
      } finally {
        if (active) setHasLoadedOnce(true);
      }
    });

    return () => {
      active = false;
    };
  }, [status, debouncedSearch, offset]);

  const loading = isFetching || !hasLoadedOnce;

  const handleToggleHide = (review: AdminReviewRow) => {
    setPendingAction({ review, hide: !review.is_hidden });
  };

  const confirmToggleHide = () => {
    if (!pendingAction) return;
    const { review, hide } = pendingAction;

    startTransition(async () => {
      try {
        const res = await adminSetReviewHiddenAction(review.id, hide);
        if (!res.success) {
          toast.error(res.error || "Failed to update review visibility");
          return;
        }

        toast.success(hide ? "Review hidden from student view" : "Review restored to public view");
        // Update local state
        setReviews((prev) =>
          prev.map((r) => (r.id === review.id ? { ...r, is_hidden: hide } : r))
        );
        setPendingAction(null);
      } catch (err) {
        console.error("Failed to toggle review visibility:", err);
        toast.error("An error occurred");
      }
    });
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      {/* Controls: Filter chips + Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status segmented control */}
        <div className="flex items-center rounded-xl border border-border bg-muted/40 p-1 text-xs">
          {(["all", "visible", "hidden"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setStatus(tab);
                setOffset(0);
              }}
              className={`min-h-[38px] rounded-lg px-3.5 font-semibold capitalize transition-all ${
                status === tab
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search items, comments, reviewers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 text-xs bg-card rounded-xl border-border/80"
          />
        </div>
      </div>

      {/* Reviews Table Container (self-contained horizontal scroll) */}
      <div className="rounded-2xl border border-border/80 bg-card shadow-2xs overflow-hidden">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b border-border/80 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Menu Item & Canteen</th>
                <th className="py-3 px-4">Reviewer</th>
                <th className="py-3 px-4">Rating</th>
                <th className="py-3 px-4">Comment</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span>Loading reviews...</span>
                    </div>
                  </td>
                </tr>
              ) : reviews.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="font-semibold">No reviews found</p>
                    <p className="text-[11px]">Try adjusting your search or filters.</p>
                  </td>
                </tr>
              ) : (
                reviews.map((rev) => (
                  <tr
                    key={rev.id}
                    className={`hover:bg-muted/30 transition-colors ${
                      rev.is_hidden ? "bg-muted/15 opacity-75" : ""
                    }`}
                  >
                    <td className="py-3 px-4 font-semibold text-foreground max-w-[180px]">
                      <div className="truncate">{rev.item_name}</div>
                      <div className="text-[10px] text-muted-foreground font-normal truncate">
                        {rev.canteen_name}
                      </div>
                    </td>

                    <td className="py-3 px-4 max-w-[160px]">
                      <div className="font-medium text-foreground truncate">
                        {rev.reviewer_name || "Student"}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {rev.reviewer_email || "—"}
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 font-bold text-foreground">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                        <span>{rev.rating}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 max-w-[260px]">
                      {rev.comment ? (
                        <p className="line-clamp-2 text-muted-foreground whitespace-pre-wrap break-words">
                          {rev.comment}
                        </p>
                      ) : (
                        <span className="text-muted-foreground/50 italic">No comment</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {rev.is_hidden ? (
                        <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-semibold">
                          Hidden
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-semibold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5">
                          Visible
                        </Badge>
                      )}
                    </td>

                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap text-[11px]">
                      {new Date(rev.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant={rev.is_hidden ? "outline" : "ghost"}
                        size="sm"
                        onClick={() => handleToggleHide(rev)}
                        className={`min-h-[38px] px-3 text-xs font-semibold rounded-lg ${
                          rev.is_hidden
                            ? "text-emerald-600 hover:text-emerald-700"
                            : "text-destructive hover:bg-destructive/10"
                        }`}
                      >
                        {rev.is_hidden ? (
                          <>
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            <span>Unhide</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5 mr-1" />
                            <span>Hide</span>
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between border-t border-border/80 px-4 py-3 text-xs text-muted-foreground">
          <span>
            Showing {totalCount === 0 ? 0 : offset + 1} to{" "}
            {Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount} reviews
          </span>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="min-h-[36px] px-2.5 rounded-lg text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-0.5" />
              <span>Prev</span>
            </Button>
            <span className="px-2 font-medium">
              Page {currentPage} of {Math.max(1, totalPages)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= totalCount || loading}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="min-h-[36px] px-2.5 rounded-lg text-xs"
            >
              <span>Next</span>
              <ChevronRight className="h-4 w-4 ml-0.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
          onClick={() => setPendingAction(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-5 space-y-4 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  pendingAction.hide
                    ? "bg-destructive/15 text-destructive"
                    : "bg-emerald-500/15 text-emerald-600"
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-foreground">
                  {pendingAction.hide ? "Hide Review?" : "Unhide Review?"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {pendingAction.hide
                    ? "This review will be hidden from students and removed from ratings."
                    : "This review will become publicly visible and included in rating aggregates."}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground">
                {pendingAction.review.item_name} ({pendingAction.review.rating} ★)
              </p>
              <p className="text-muted-foreground italic line-clamp-2">
                &ldquo;{pendingAction.review.comment || "No comment"}&rdquo;
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPendingAction(null)}
                disabled={isProcessing}
                className="min-h-[44px] px-4 text-xs rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={pendingAction.hide ? "destructive" : "default"}
                size="sm"
                onClick={confirmToggleHide}
                disabled={isProcessing}
                className="min-h-[44px] px-4 text-xs font-bold rounded-xl"
              >
                {isProcessing
                  ? "Processing..."
                  : pendingAction.hide
                  ? "Confirm Hide"
                  : "Confirm Unhide"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
