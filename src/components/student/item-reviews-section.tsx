"use client";

import { useState, useEffect } from "react";
import { Star, MessageSquare, Trash2, Send, AlertCircle, CheckCircle2, X, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StarRatingDisplay, StarRatingInput } from "@/components/student/star-rating";
import {
  getItemReviewsAction,
  getReviewEligibilityAction,
  submitReviewAction,
  deleteMyReviewAction,
  type ItemReviewsResult,
  type ItemReviewData,
  type ReviewEligibilityItem,
} from "@/server/actions/reviews";

interface ItemReviewsSectionProps {
  menuItemId: string;
  itemName: string;
}

export function ItemReviewsSection({ menuItemId, itemName }: ItemReviewsSectionProps) {
  const [reviewsData, setReviewsData] = useState<ItemReviewsResult | null>(null);
  const [eligibility, setEligibility] = useState<ReviewEligibilityItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Form state
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeReviewDetail, setActiveReviewDetail] = useState<ItemReviewData | null>(null);

  // Load reviews and eligibility lazily when section renders
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      try {
        const [reviewsRes, eligRes] = await Promise.all([
          getItemReviewsAction(menuItemId, 5, 0),
          getReviewEligibilityAction([menuItemId]),
        ]);

        if (!isMounted) return;

        if (reviewsRes.success && reviewsRes.data) {
          setReviewsData(reviewsRes.data);
          setHasMore(reviewsRes.data.reviews.length === 5);
        }

        if (eligRes.success && eligRes.data && eligRes.data[0]) {
          const e = eligRes.data[0];
          setEligibility(e);
          if (e.has_reviewed && e.my_rating) {
            setRating(e.my_rating);
            setComment(e.my_comment || "");
          }
        }
      } catch (err) {
        console.error("Failed to load reviews:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [menuItemId]);

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const newOffset = offset + 5;

    try {
      const res = await getItemReviewsAction(menuItemId, 5, newOffset);
      if (res.success && res.data) {
        const fetchedData = res.data;
        setReviewsData((prev) => {
          if (!prev) return fetchedData;
          return {
            ...prev,
            reviews: [...prev.reviews, ...fetchedData.reviews],
          };
        });
        setOffset(newOffset);
        setHasMore(fetchedData.reviews.length === 5);
      }
    } catch (err) {
      console.error("Failed to load more reviews:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!rating || rating < 1 || rating > 5) {
      toast.error("Please select a rating between 1 and 5 stars");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitReviewAction({
        menuItemId,
        rating,
        comment: comment.trim() || null,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to submit review");
        return;
      }

      toast.success(eligibility?.has_reviewed ? "Review updated!" : "Review submitted!");
      setShowForm(false);

      // Refresh reviews and eligibility
      const [refreshedReviews, refreshedElig] = await Promise.all([
        getItemReviewsAction(menuItemId, 5, 0),
        getReviewEligibilityAction([menuItemId]),
      ]);

      if (refreshedReviews.success && refreshedReviews.data) {
        setReviewsData(refreshedReviews.data);
        setOffset(0);
        setHasMore(refreshedReviews.data.reviews.length === 5);
      }
      if (refreshedElig.success && refreshedElig.data && refreshedElig.data[0]) {
        setEligibility(refreshedElig.data[0]);
      }
    } catch (err) {
      console.error("Failed to submit review:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteReview = async () => {
    if (isDeleting || !eligibility?.has_reviewed) return;

    if (!confirm("Are you sure you want to delete your review?")) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await deleteMyReviewAction(menuItemId);
      if (!res.success) {
        toast.error(res.error || "Failed to delete review");
        return;
      }

      toast.success("Review deleted");
      setRating(5);
      setComment("");
      setShowForm(false);

      const [refreshedReviews, refreshedElig] = await Promise.all([
        getItemReviewsAction(menuItemId, 5, 0),
        getReviewEligibilityAction([menuItemId]),
      ]);

      if (refreshedReviews.success && refreshedReviews.data) {
        setReviewsData(refreshedReviews.data);
        setOffset(0);
      }
      if (refreshedElig.success && refreshedElig.data && refreshedElig.data[0]) {
        setEligibility(refreshedElig.data[0]);
      }
    } catch (err) {
      console.error("Failed to delete review:", err);
      toast.error("An error occurred");
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-4 space-y-3 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded-md" />
        <div className="h-16 bg-muted/60 rounded-xl" />
      </div>
    );
  }

  const histogram = reviewsData?.histogram || { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const totalHistogramCount =
    (histogram["1"] || 0) +
    (histogram["2"] || 0) +
    (histogram["3"] || 0) +
    (histogram["4"] || 0) +
    (histogram["5"] || 0);

  const charCount = comment.length;

  return (
    <div className="border-t border-border/80 pt-4 mt-4 space-y-5">
      {/* Header & Rating Breakdown */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span>Customer Reviews</span>
          </h3>

          {reviewsData && reviewsData.rating_count > 0 && (
            <span className="text-xs text-muted-foreground font-medium">
              {reviewsData.rating_count} {reviewsData.rating_count === 1 ? "review" : "reviews"}
            </span>
          )}
        </div>

        {/* Rating Score Card */}
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center sm:items-start space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-foreground">
                {reviewsData?.rating_avg ? Number(reviewsData.rating_avg).toFixed(1) : "—"}
              </span>
              <span className="text-xs text-muted-foreground font-medium">out of 5</span>
            </div>
            <StarRatingDisplay
              rating={reviewsData?.rating_avg}
              count={reviewsData?.rating_count}
              size="md"
              showCount={false}
            />
          </div>

          {/* Histogram bar breakdown */}
          <div className="w-full sm:w-48 space-y-1 text-[11px]">
            {[5, 4, 3, 2, 1].map((starKey) => {
              const count = histogram[starKey.toString() as keyof typeof histogram] || 0;
              const pct = totalHistogramCount > 0 ? (count / totalHistogramCount) * 100 : 0;

              return (
                <div key={starKey} className="flex items-center gap-1.5">
                  <span className="w-3 text-muted-foreground font-medium text-right">{starKey}</span>
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-500" />
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-5 text-right text-muted-foreground font-mono">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Review Eligibility & Actions */}
      <div className="space-y-3">
        {eligibility?.can_review ? (
          <div>
            {!showForm ? (
              <div className="flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5">
                <div className="text-xs">
                  <p className="font-semibold text-foreground">
                    {eligibility.has_reviewed ? "You reviewed this item" : "Verified Purchase"}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {eligibility.has_reviewed
                      ? "You can update your rating or feedback"
                      : "Share your experience with fellow students"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={eligibility.has_reviewed ? "outline" : "default"}
                  onClick={() => setShowForm(true)}
                  className="min-h-[44px] px-4 text-xs font-semibold rounded-xl"
                >
                  {eligibility.has_reviewed ? "Edit Review" : "Write Review"}
                </Button>
              </div>
            ) : (
              /* Review Form */
              <form
                onSubmit={handleSubmitReview}
                className="rounded-2xl border border-border/80 bg-card p-4 space-y-4 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">
                    {eligibility.has_reviewed ? "Edit your review" : "Rate & review"}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="text-xs text-muted-foreground hover:text-foreground font-medium min-h-[44px] min-w-[44px] flex items-center justify-end"
                  >
                    Cancel
                  </button>
                </div>

                {/* Accessible Star Radio Group */}
                <StarRatingInput
                  value={rating}
                  onChange={setRating}
                  itemName={itemName}
                  disabled={isSubmitting || isDeleting}
                />

                {/* Comment Textarea */}
                <div className="space-y-1">
                  <label htmlFor="review-comment" className="text-xs font-semibold text-foreground">
                    Comment (optional)
                  </label>
                  <Textarea
                    id="review-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value.slice(0, 500))}
                    placeholder="Tell us what you liked about the preparation, taste, and freshness..."
                    rows={3}
                    maxLength={500}
                    disabled={isSubmitting || isDeleting}
                    className="text-xs resize-none rounded-xl bg-background"
                  />
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground px-1">
                    <span>Empty comment is allowed</span>
                    <span className={charCount > 450 ? "text-amber-500 font-semibold" : ""}>
                      {charCount} / 500
                    </span>
                  </div>
                </div>

                {/* Form Buttons */}
                <div className="flex items-center justify-between pt-1 gap-2">
                  {eligibility.has_reviewed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteReview}
                      disabled={isSubmitting || isDeleting}
                      className="min-h-[44px] text-xs text-destructive hover:bg-destructive/10 rounded-xl"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      <span>Delete</span>
                    </Button>
                  ) : <div />}

                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmitting || isDeleting}
                    className="min-h-[44px] px-5 text-xs font-bold rounded-xl ml-auto"
                  >
                    {isSubmitting ? (
                      <span>Saving...</span>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        <span>{eligibility.has_reviewed ? "Update" : "Submit"}</span>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-muted bg-muted/20 text-muted-foreground text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <span>Only customers who collected this item can review it.</span>
          </div>
        )}
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {reviewsData && reviewsData.reviews.length > 0 ? (
          <div className="space-y-2.5">
            {reviewsData.reviews.map((rev, idx) => (
              <div
                key={`${rev.display_name}-${rev.created_at}-${idx}`}
                onClick={() => setActiveReviewDetail(rev)}
                className="group rounded-xl border border-border/60 hover:border-primary/50 bg-card p-3.5 space-y-2 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer active:scale-[0.99] select-none"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveReviewDetail(rev);
                  }
                }}
                aria-label={`View full review from ${rev.display_name}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold font-mono">
                      {rev.display_name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold text-foreground">
                      {rev.display_name}
                    </span>
                    {rev.is_mine && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1 font-semibold text-primary border-primary/30">
                        You
                      </Badge>
                    )}
                    {rev.is_hidden && (
                      <Badge variant="destructive" className="text-[9px] py-0 px-1 font-semibold">
                        Hidden by moderator
                      </Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(rev.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>

                <StarRatingDisplay rating={rev.rating} count={null} size="sm" showCount={false} />

                {rev.comment && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground leading-relaxed pt-0.5 whitespace-pre-wrap break-words">
                      {rev.comment}
                    </p>
                    <div className="flex items-center justify-end text-[10px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="flex items-center gap-0.5">
                        <span>Tap to view full review</span>
                        <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full min-h-[44px] text-xs font-semibold rounded-xl"
              >
                {loadingMore ? "Loading more..." : "Load more reviews"}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">
            No reviews yet. Be the first to try and review this item!
          </p>
        )}
      </div>

      {/* Full Review Detail Modal with Smooth Transition */}
      {activeReviewDetail && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200"
          onClick={() => setActiveReviewDetail(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-card border border-border shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary border border-primary/20 flex items-center justify-center font-bold text-sm">
                  {activeReviewDetail.display_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-foreground">
                      {activeReviewDetail.display_name}
                    </h3>
                    {activeReviewDetail.is_mine && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1 font-semibold text-primary border-primary/30">
                        You
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Verified Campus Purchase</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveReviewDetail(null)}
                className="w-8 h-8 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close review details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Context Item & Date */}
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
              <span className="font-semibold text-foreground truncate max-w-[200px]">
                {itemName}
              </span>
              <span className="text-[11px] shrink-0">
                {new Date(activeReviewDetail.created_at).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* Rating Stars Showcase */}
            <div className="rounded-xl bg-muted/30 p-3 border border-border/60 flex items-center justify-between">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-5 h-5 ${
                      star <= activeReviewDetail.rating
                        ? "fill-amber-400 text-amber-500"
                        : "fill-muted text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm font-bold text-foreground">
                {activeReviewDetail.rating}.0 / 5.0
              </span>
            </div>

            {/* Complete Review Content */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider font-mono">
                Review Feedback
              </div>
              <div className="rounded-xl bg-background p-4 border border-border/80 text-xs sm:text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words min-h-[80px]">
                {activeReviewDetail.comment ? (
                  activeReviewDetail.comment
                ) : (
                  <span className="text-muted-foreground italic">
                    The reviewer gave a rating without adding written comments.
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              {activeReviewDetail.is_mine && (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    setActiveReviewDetail(null);
                    setShowForm(true);
                  }}
                  className="flex-1 min-h-[44px] text-xs font-bold rounded-xl"
                >
                  Edit My Review
                </Button>
              )}
              <Button
                type="button"
                variant={activeReviewDetail.is_mine ? "outline" : "default"}
                onClick={() => setActiveReviewDetail(null)}
                className="flex-1 min-h-[44px] text-xs font-semibold rounded-xl"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
