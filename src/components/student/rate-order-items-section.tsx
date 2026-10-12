"use client";

import { useState, useEffect, useMemo } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { StarRatingDisplay, StarRatingInput } from "@/components/student/star-rating";
import { Textarea } from "@/components/ui/textarea";
import {
  getReviewEligibilityAction,
  submitReviewAction,
  type ReviewEligibilityItem,
} from "@/server/actions/reviews";
import { toast } from "sonner";

interface RateOrderItem {
  id: string;
  menu_item_id: string;
  name_snapshot: string;
  image_url?: string | null;
}

interface RateOrderItemsSectionProps {
  orderItems: RateOrderItem[];
}

export function RateOrderItemsSection({ orderItems }: RateOrderItemsSectionProps) {
  // Only valid items with menu_item_id
  const validItems = useMemo(
    () => orderItems.filter((i) => Boolean(i.menu_item_id)),
    [orderItems]
  );
  const validItemIds = useMemo(
    () => Array.from(new Set(validItems.map((i) => i.menu_item_id))),
    [validItems]
  );

  const [eligibilityMap, setEligibilityMap] = useState<Record<string, ReviewEligibilityItem>>({});
  const [activeItem, setActiveItem] = useState<RateOrderItem | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (validItemIds.length === 0) return;

    getReviewEligibilityAction(validItemIds)
      .then((res) => {
        if (res.success && res.data) {
          const map: Record<string, ReviewEligibilityItem> = {};
          for (const item of res.data) {
            map[item.menu_item_id] = item;
          }
          setEligibilityMap(map);
        }
      })
      .catch((err) => console.error("Failed to load review eligibility for order items:", err));
  }, [validItemIds]);

  if (validItems.length === 0) return null;

  const handleOpenReview = (item: RateOrderItem) => {
    const existing = eligibilityMap[item.menu_item_id];
    setActiveItem(item);
    setRating(existing?.my_rating || 5);
    setComment(existing?.my_comment || "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem || isSubmitting) return;

    if (!rating || rating < 1 || rating > 5) {
      toast.error("Please select a rating between 1 and 5 stars");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitReviewAction({
        menuItemId: activeItem.menu_item_id,
        rating,
        comment: comment.trim() || null,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to submit review");
        return;
      }

      toast.success("Thank you for your review!");

      // Update local state
      setEligibilityMap((prev) => ({
        ...prev,
        [activeItem.menu_item_id]: {
          menu_item_id: activeItem.menu_item_id,
          can_review: true,
          has_reviewed: true,
          my_rating: rating,
          my_comment: comment.trim() || null,
          my_is_hidden: false,
          my_updated_at: new Date().toISOString(),
        },
      }));

      setActiveItem(null);
    } catch (err) {
      console.error("Failed to submit review:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-3 shadow-2xs">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
          <span>Rate Your Items</span>
        </h2>
        <span className="text-[11px] text-muted-foreground">Verified Purchase</span>
      </div>

      <div className="divide-y divide-border/60">
        {validItems.map((item) => {
          const reviewInfo = eligibilityMap[item.menu_item_id];
          const hasReviewed = reviewInfo?.has_reviewed;

          return (
            <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted border border-border/60">
                  <MenuItemImage
                    src={item.image_url}
                    alt={item.name_snapshot}
                    aspect="square"
                    sizes="40px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{item.name_snapshot}</p>
                  {hasReviewed && reviewInfo.my_rating ? (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <StarRatingDisplay
                        rating={reviewInfo.my_rating}
                        count={null}
                        size="sm"
                        showCount={false}
                      />
                      <span>&bull; Reviewed</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">How was the food?</p>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant={hasReviewed ? "outline" : "default"}
                size="sm"
                onClick={() => handleOpenReview(item)}
                className="min-h-[44px] px-3.5 text-xs font-semibold rounded-xl shrink-0"
              >
                {hasReviewed ? "Edit" : "Rate"}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Review Dialog/Sheet Modal */}
      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in"
          onClick={() => setActiveItem(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/80 shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-foreground">
                  Rate {activeItem.name_snapshot}
                </h3>
                <p className="text-xs text-muted-foreground">Verified purchase from your order</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveItem(null)}
                className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-end"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <StarRatingInput
                value={rating}
                onChange={setRating}
                itemName={activeItem.name_snapshot}
                disabled={isSubmitting}
              />

              <div className="space-y-1">
                <label htmlFor="order-review-comment" className="text-xs font-semibold text-foreground">
                  Feedback (optional)
                </label>
                <Textarea
                  id="order-review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 500))}
                  placeholder="Tell us about the taste, temperature, and quantity..."
                  rows={3}
                  maxLength={500}
                  disabled={isSubmitting}
                  className="text-xs rounded-xl"
                />
                <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                  <span>Max 500 characters</span>
                  <span>{comment.length} / 500</span>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[44px] text-xs font-bold rounded-xl"
              >
                {isSubmitting ? "Submitting..." : "Submit Review"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
