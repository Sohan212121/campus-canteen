"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Star,
  UtensilsCrossed,
  Calendar,
  X,
  MessageSquare,
  CheckCircle2,
  ShoppingBag,
  ChevronRight,
} from "lucide-react";
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { StarRatingInput } from "@/components/student/star-rating";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatPaise } from "@/lib/money";
import {
  getReviewEligibilityAction,
  submitReviewAction,
  type ReviewEligibilityItem,
} from "@/server/actions/reviews";
import { toast } from "sonner";

export interface PreorderedFoodItem {
  id: string; // unique order item id
  order_id: string;
  order_code: number;
  order_status: string;
  placed_at: string;
  menu_item_id: string;
  name_snapshot: string;
  quantity: number;
  unit_price_paise: number;
  image_url?: string | null;
}

export interface PreorderedItemsReviewSectionProps {
  items: PreorderedFoodItem[];
  title?: string;
  subtitle?: string;
  className?: string;
  isModal?: boolean;
  onClose?: () => void;
}

function formatOrderDate(dateString: string) {
  try {
    const date = new Date(dateString);
    const datePart = date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const timePart = date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart} • ${timePart}`;
  } catch {
    return dateString;
  }
}

export function PreorderedItemsReviewSection({
  items,
  title = "Pre-Ordered Meals & Feedback",
  subtitle = "Rate your food quality and share verified dining feedback",
  className = "",
  isModal = false,
  onClose,
}: PreorderedItemsReviewSectionProps) {
  const [eligibilityMap, setEligibilityMap] = useState<Record<string, ReviewEligibilityItem>>({});
  const [filter, setFilter] = useState<"all" | "unreviewed" | "reviewed">("all");
  const [activeItem, setActiveItem] = useState<PreorderedFoodItem | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFullReview, setSelectedFullReview] = useState<{
    item: PreorderedFoodItem;
    rating: number;
    comment: string | null;
    date: string;
  } | null>(null);

  // Extract distinct valid menu item IDs for review eligibility check
  const distinctMenuItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.menu_item_id) {
        ids.add(item.menu_item_id);
      }
    }
    return Array.from(ids);
  }, [items]);

  // Load review eligibility
  useEffect(() => {
    if (distinctMenuItemIds.length === 0) return;

    let active = true;
    getReviewEligibilityAction(distinctMenuItemIds)
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) {
          const map: Record<string, ReviewEligibilityItem> = {};
          for (const item of res.data) {
            map[item.menu_item_id] = item;
          }
          setEligibilityMap(map);
        }
      })
      .catch((err) => {
        console.error("Failed to load review eligibility for pre-ordered items:", err);
      });

    return () => {
      active = false;
    };
  }, [distinctMenuItemIds]);

  const handleOpenReview = useCallback(
    (item: PreorderedFoodItem) => {
      const existing = eligibilityMap[item.menu_item_id];
      setActiveItem(item);
      setRating(existing?.my_rating || 5);
      setComment(existing?.my_comment || "");
    },
    [eligibilityMap]
  );

  const handleSubmitReview = async (e: React.FormEvent) => {
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

      toast.success(`Thank you for rating ${activeItem.name_snapshot}!`);

      // Update local eligibility state so UI updates immediately
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
      toast.error("An unexpected error occurred while submitting your review");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    if (filter === "reviewed") {
      return items.filter((i) => eligibilityMap[i.menu_item_id]?.has_reviewed);
    }
    if (filter === "unreviewed") {
      return items.filter((i) => !eligibilityMap[i.menu_item_id]?.has_reviewed);
    }
    return items;
  }, [items, eligibilityMap, filter]);

  const reviewedCount = useMemo(() => {
    return items.filter((i) => eligibilityMap[i.menu_item_id]?.has_reviewed).length;
  }, [items, eligibilityMap]);

  const unreviewedCount = items.length - reviewedCount;

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* Header bar */}
      <div className="flex items-start justify-between gap-3 pb-2 border-b border-[#e6e2da]/70 dark:border-[#222533]">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-[#9e4300] dark:text-[#FBBF24]" />
            <h3 className="font-bold text-[#1c1c17] dark:text-white text-sm sm:text-base leading-tight">
              {title}
            </h3>
          </div>
          <p className="text-[11px] text-[#564240] dark:text-stone-400 leading-tight">
            {subtitle}
          </p>
        </div>

        {isModal && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#e6e2da]/80 dark:bg-[#1f2230] hover:bg-[#dcc0bd] dark:hover:bg-[#2d3142] text-[#564240] dark:text-stone-300 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#564240] dark:text-stone-400 font-mono bg-[#e6e2da] dark:bg-[#1f2230] px-2.5 py-1 rounded-full border border-[#dcc0bd] dark:border-[#2d3142] shrink-0">
            {items.length} {items.length === 1 ? "Item" : "Items"}
          </span>
        )}
      </div>

      {/* Filter Tabs if there are items */}
      {items.length > 0 && (
        <div className="flex items-center gap-1.5 p-1 bg-[#e6e2da]/60 dark:bg-[#16171e] rounded-xl text-xs font-semibold font-mono">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              filter === "all"
                ? "bg-white dark:bg-[#222533] text-[#6c1d18] dark:text-[#FBBF24] shadow-xs font-bold"
                : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
            }`}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("unreviewed")}
            className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              filter === "unreviewed"
                ? "bg-white dark:bg-[#222533] text-[#6c1d18] dark:text-[#FBBF24] shadow-xs font-bold"
                : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
            }`}
          >
            To Rate ({unreviewedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("reviewed")}
            className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
              filter === "reviewed"
                ? "bg-white dark:bg-[#222533] text-[#6c1d18] dark:text-[#FBBF24] shadow-xs font-bold"
                : "text-[#564240] dark:text-stone-400 hover:text-[#1c1c17] dark:hover:text-white"
            }`}
          >
            Rated ({reviewedCount})
          </button>
        </div>
      )}

      {/* Items List */}
      <div className="flex flex-col gap-2.5">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => {
            const reviewInfo = eligibilityMap[item.menu_item_id];
            const hasReviewed = reviewInfo?.has_reviewed;
            const isCollected = item.order_status === "COLLECTED";
            const canReview = reviewInfo?.can_review || isCollected;

            return (
              <div
                key={item.id}
                className="bg-[#ffffff] dark:bg-[#181a24] rounded-2xl p-3 sm:p-3.5 border border-[#e6e2da] dark:border-[#262836] shadow-2xs hover:border-[#dcc0bd] dark:hover:border-[#383d52] transition-colors flex flex-col gap-2.5"
              >
                <div className="flex items-start gap-3">
                  {/* Food Image */}
                  <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-xl bg-[#f5f1eb] dark:bg-[#1a1c26] border border-[#e6e2da] dark:border-[#262836] relative">
                    <MenuItemImage
                      src={item.image_url}
                      alt={item.name_snapshot}
                      aspect="square"
                      sizes="64px"
                      className="h-full w-full object-cover"
                    />
                  </div>

                  {/* Food & Order Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1.5">
                      <h4 className="text-xs sm:text-sm font-bold text-[#1c1c17] dark:text-white truncate">
                        {item.name_snapshot}
                      </h4>
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md font-mono shrink-0 border ${
                          isCollected
                            ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800"
                            : item.order_status === "READY"
                            ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800"
                            : "bg-[#f1ede6] dark:bg-[#202330] text-[#564240] dark:text-stone-300 border-[#dcc0bd] dark:border-[#2d3142]"
                        }`}
                      >
                        {item.order_status}
                      </span>
                    </div>

                    <div className="text-[11px] text-[#564240] dark:text-stone-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono">
                      <span className="font-semibold text-[#1c1c17] dark:text-stone-200">
                        {formatPaise(item.unit_price_paise)}
                      </span>
                      <span>•</span>
                      <span>Qty: {item.quantity}</span>
                      <span>•</span>
                      <span className="text-[#6c1d18] dark:text-[#ffb4ab] font-bold">
                        Order #{item.order_code}
                      </span>
                    </div>

                    {/* Ordered Date */}
                    <div className="text-[10px] text-[#89726f] dark:text-stone-400 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#9e4300] dark:text-[#FBBF24]" />
                      <span>Ordered: {formatOrderDate(item.placed_at)}</span>
                    </div>
                  </div>
                </div>

                {/* User's Existing Review Comment */}
                {hasReviewed && reviewInfo.my_comment && (
                  <div
                    onClick={() =>
                      setSelectedFullReview({
                        item,
                        rating: reviewInfo.my_rating || 5,
                        comment: reviewInfo.my_comment,
                        date: reviewInfo.my_updated_at || item.placed_at,
                      })
                    }
                    className="rounded-xl bg-[#f8f5ee] dark:bg-[#121319] p-2.5 border border-[#e6e2da] dark:border-[#222533] cursor-pointer hover:border-[#dcc0bd] dark:hover:border-[#383d52] transition-all group/rev"
                    title="Click to view full review"
                    role="button"
                    tabIndex={0}
                  >
                    <p className="text-xs text-[#564240] dark:text-stone-300 leading-relaxed italic line-clamp-2">
                      &ldquo;{reviewInfo.my_comment}&rdquo;
                    </p>
                    <div className="flex items-center justify-end text-[10px] font-semibold text-[#6c1d18] dark:text-[#ffb4ab] mt-1 gap-0.5 group-hover/rev:underline">
                      <span>View full review</span>
                      <ChevronRight className="w-3 h-3 group-hover/rev:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                )}

                {/* Footer with Rating Status and Action Button */}
                <div className="pt-2 border-t border-[#e6e2da]/70 dark:border-[#262836] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    {hasReviewed && reviewInfo.my_rating ? (
                      <div className="flex items-center gap-1.5 text-xs text-amber-500 font-bold">
                        <div className="flex items-center">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-3.5 h-3.5 ${
                                star <= reviewInfo.my_rating!
                                  ? "fill-amber-400 text-amber-500"
                                  : "text-stone-300 dark:text-stone-600"
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono font-bold flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" />
                          Rated
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#89726f] dark:text-stone-400 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-[#9e4300] dark:text-[#FBBF24]" />
                        How was the taste &amp; pickup?
                      </span>
                    )}
                  </div>

                  {/* Review Button */}
                  <Button
                    type="button"
                    variant={hasReviewed ? "outline" : "default"}
                    size="sm"
                    disabled={!canReview && !hasReviewed}
                    onClick={() => handleOpenReview(item)}
                    className={`min-h-[38px] px-3.5 text-xs font-bold rounded-xl shrink-0 transition-transform active:scale-95 cursor-pointer ${
                      hasReviewed
                        ? "border-[#dcc0bd] dark:border-[#383d52] hover:bg-[#f1ede6] dark:hover:bg-[#202330] text-[#6c1d18] dark:text-[#FBBF24]"
                        : canReview
                        ? "bg-[#6c1d18] hover:bg-[#591612] dark:bg-[#9e4300] dark:hover:bg-[#b84e00] text-white shadow-xs"
                        : "opacity-60 cursor-not-allowed"
                    }`}
                  >
                    {hasReviewed
                      ? "Edit Review"
                      : canReview
                      ? "Rate Food"
                      : "Rate After Pickup"}
                  </Button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-[#ffffff] dark:bg-[#181a24] rounded-2xl p-6 border border-dashed border-[#e6e2da] dark:border-[#262836] text-center space-y-2.5">
            <div className="w-11 h-11 rounded-2xl bg-[#ffdad6]/60 dark:bg-[#2a1412] text-[#6c1d18] dark:text-[#ffb4ab] flex items-center justify-center mx-auto">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs sm:text-sm font-bold text-[#1c1c17] dark:text-white">
                {filter === "reviewed"
                  ? "No reviews submitted yet"
                  : filter === "unreviewed"
                  ? "All caught up! No pending food items to rate"
                  : "No pre-ordered food items found"}
              </p>
              <p className="text-[11px] text-[#89726f] dark:text-stone-400 max-w-sm mx-auto">
                {filter === "reviewed"
                  ? "Rate your pre-ordered items to help fellow students discover great food."
                  : "Pre-order meals from the campus canteen menu to rate your dining experience here."}
              </p>
            </div>
            {filter === "all" && (
              <Link
                href="/menu"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6c1d18] hover:bg-[#591612] text-white text-xs font-bold transition-all shadow-xs active:scale-95"
              >
                <span>Browse Campus Menu</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Review Dialog/Modal for rating specific item */}
      {activeItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200"
          onClick={() => !isSubmitting && setActiveItem(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-[#ffffff] dark:bg-[#181a24] border border-[#e6e2da] dark:border-[#262836] shadow-2xl p-5 sm:p-6 space-y-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#f5f1eb] dark:bg-[#1a1c26] border border-[#e6e2da] dark:border-[#262836]">
                  <MenuItemImage
                    src={activeItem.image_url}
                    alt={activeItem.name_snapshot}
                    aspect="square"
                    sizes="48px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-[#1c1c17] dark:text-white leading-tight">
                    Rate {activeItem.name_snapshot}
                  </h3>
                  <p className="text-[11px] text-[#89726f] dark:text-stone-400 mt-0.5">
                    Order #{activeItem.order_code} • {formatOrderDate(activeItem.placed_at)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setActiveItem(null)}
                className="w-8 h-8 rounded-full bg-[#f1ede6] dark:bg-[#202330] hover:bg-[#e6e2da] dark:hover:bg-[#2d3142] text-[#564240] dark:text-stone-300 flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close review dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitReview} className="space-y-4">
              <div className="bg-[#f8f5ee] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] space-y-2">
                <div className="text-xs font-bold text-[#1c1c17] dark:text-white flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                  <span>How would you rate this item?</span>
                </div>
                <StarRatingInput
                  value={rating}
                  onChange={setRating}
                  itemName={activeItem.name_snapshot}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="preorder-review-comment"
                  className="text-xs font-bold text-[#1c1c17] dark:text-white flex items-center justify-between"
                >
                  <span>Feedback &amp; Dining Experience (Optional)</span>
                  <span className="text-[10px] font-normal text-[#89726f] dark:text-stone-400">
                    {comment.length} / 500
                  </span>
                </label>
                <Textarea
                  id="preorder-review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 500))}
                  placeholder="Share details on food taste, temperature, portion size, and pickup experience..."
                  rows={3}
                  maxLength={500}
                  disabled={isSubmitting}
                  className="text-xs rounded-xl border-[#e6e2da] dark:border-[#262836] bg-[#f8f5ee] dark:bg-[#121319]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setActiveItem(null)}
                  className="flex-1 min-h-[44px] text-xs font-semibold rounded-xl border-[#e6e2da] dark:border-[#262836]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[44px] text-xs font-bold rounded-xl bg-[#6c1d18] hover:bg-[#591612] dark:bg-[#9e4300] dark:hover:bg-[#b84e00] text-white"
                >
                  {isSubmitting ? "Submitting..." : "Submit Review"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Review Detail Modal with Smooth Transition */}
      {selectedFullReview && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedFullReview(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-2xl bg-[#ffffff] dark:bg-[#181a24] border border-[#e6e2da] dark:border-[#262836] shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#e6e2da]/70 dark:border-[#262836]">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#f5f1eb] dark:bg-[#1a1c26] border border-[#e6e2da] dark:border-[#262836]">
                  <MenuItemImage
                    src={selectedFullReview.item.image_url}
                    alt={selectedFullReview.item.name_snapshot}
                    aspect="square"
                    sizes="48px"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-[#1c1c17] dark:text-white leading-tight">
                    {selectedFullReview.item.name_snapshot}
                  </h3>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Your Verified Review</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedFullReview(null)}
                className="w-8 h-8 rounded-full bg-[#f1ede6] dark:bg-[#202330] hover:bg-[#e6e2da] dark:hover:bg-[#2d3142] text-[#564240] dark:text-stone-300 flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Close review details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Context Item & Date */}
            <div className="flex items-center justify-between text-xs text-[#89726f] dark:text-stone-400 font-mono">
              <span>Order #{selectedFullReview.item.order_code}</span>
              <span>{formatOrderDate(selectedFullReview.date)}</span>
            </div>

            {/* Rating Stars Showcase */}
            <div className="rounded-xl bg-[#f8f5ee] dark:bg-[#121319] p-3 border border-[#e6e2da] dark:border-[#222533] flex items-center justify-between">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-5 h-5 ${
                      star <= selectedFullReview.rating
                        ? "fill-amber-400 text-amber-500"
                        : "text-stone-300 dark:text-stone-600"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm font-bold text-[#1c1c17] dark:text-white">
                {selectedFullReview.rating}.0 / 5.0
              </span>
            </div>

            {/* Complete Review Content */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[#89726f] dark:text-stone-400 uppercase tracking-wider font-mono">
                Your Feedback
              </div>
              <div className="rounded-xl bg-[#f8f5ee] dark:bg-[#121319] p-4 border border-[#e6e2da] dark:border-[#222533] text-xs sm:text-sm text-[#1c1c17] dark:text-white leading-relaxed whitespace-pre-wrap break-words min-h-[80px]">
                {selectedFullReview.comment ? (
                  selectedFullReview.comment
                ) : (
                  <span className="text-[#89726f] dark:text-stone-400 italic">
                    Rated without additional written comments.
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const item = selectedFullReview.item;
                  setSelectedFullReview(null);
                  handleOpenReview(item);
                }}
                className="flex-1 min-h-[44px] text-xs font-semibold rounded-xl border-[#e6e2da] dark:border-[#262836]"
              >
                Edit Review
              </Button>
              <Button
                type="button"
                onClick={() => setSelectedFullReview(null)}
                className="flex-1 min-h-[44px] text-xs font-bold rounded-xl bg-[#6c1d18] hover:bg-[#591612] dark:bg-[#9e4300] text-white"
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
