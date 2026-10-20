"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";
import { logSupabaseError } from "@/lib/supabase-error";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitReviewSchema = z.object({
  menuItemId: z.string().uuid("Invalid menu item ID"),
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
  comment: z
    .string()
    .max(500, "Comment cannot exceed 500 characters")
    .optional()
    .nullable(),
});

const listReviewsSchema = z.object({
  menuItemId: z.string().uuid("Invalid menu item ID"),
  limit: z.number().int().min(1).max(50).optional().default(10),
  offset: z.number().int().min(0).optional().default(0),
});

const eligibilitySchema = z.array(z.string().uuid()).max(50, "Maximum 50 items can be checked at once");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

export type ItemReviewData = {
  rating: number;
  comment: string | null;
  created_at: string;
  is_mine: boolean;
  is_hidden: boolean;
  display_name: string;
};

export type ItemReviewsResult = {
  menu_item_id: string;
  rating_avg: number | null;
  rating_count: number;
  histogram: {
    "1": number;
    "2": number;
    "3": number;
    "4": number;
    "5": number;
  };
  reviews: ItemReviewData[];
};

export type ReviewEligibilityItem = {
  menu_item_id: string;
  can_review: boolean;
  has_reviewed: boolean;
  my_rating: number | null;
  my_comment: string | null;
  my_is_hidden: boolean | null;
  my_updated_at: string | null;
};

export type ActionResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Submits or updates a verified-purchase review for a menu item.
 */
export async function submitReviewAction(
  input: SubmitReviewInput
): Promise<ActionResult<{ id: string; rating: number; comment: string | null }>> {
  try {
    await requireRole(["student"]);

    const parsed = submitReviewSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid review data",
        code: "INVALID_INPUT",
      };
    }

    const { menuItemId, rating, comment } = parsed.data;
    const cleanComment = comment ? comment.trim() : null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_review", {
      p_menu_item_id: menuItemId,
      p_rating: rating,
      p_comment: cleanComment,
    });

    if (error) {
      logSupabaseError("submitReviewAction:rpc", error);
      const msg = error.message || "";
      if (msg.includes("NOT_ELIGIBLE")) {
        return {
          success: false,
          error: "Only customers who collected this item can review it.",
          code: "NOT_ELIGIBLE",
        };
      }
      if (msg.includes("RATE_LIMITED")) {
        return {
          success: false,
          error: "You have reached the limit of 10 reviews per 24 hours. Please try again later.",
          code: "RATE_LIMITED",
        };
      }
      if (msg.includes("INVALID_INPUT")) {
        return {
          success: false,
          error: "Invalid rating or comment provided.",
          code: "INVALID_INPUT",
        };
      }
      if (msg.includes("FORBIDDEN")) {
        return {
          success: false,
          error: "Your account is not authorized to submit reviews.",
          code: "FORBIDDEN",
        };
      }
      return { success: false, error: "Failed to submit review.", code: "RPC_ERROR" };
    }

    revalidatePath("/menu");
    revalidatePath("/orders/[orderId]", "page");

    return {
      success: true,
      data: data as { id: string; rating: number; comment: string | null },
    };
  } catch (err) {
    console.error("[submitReviewAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while submitting your review.",
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Deletes the calling student's own review for a menu item.
 */
export async function deleteMyReviewAction(
  menuItemId: string
): Promise<ActionResult<{ deleted: boolean }>> {
  try {
    await requireRole(["student"]);

    const parsedId = z.string().uuid().safeParse(menuItemId);
    if (!parsedId.success) {
      return { success: false, error: "Invalid menu item ID", code: "INVALID_INPUT" };
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_my_review", {
      p_menu_item_id: parsedId.data,
    });

    if (error) {
      logSupabaseError("deleteMyReviewAction:rpc", error);
      return { success: false, error: "Failed to delete review.", code: "RPC_ERROR" };
    }

    revalidatePath("/menu");
    revalidatePath("/orders/[orderId]", "page");

    return { success: true, data: { deleted: true } };
  } catch (err) {
    console.error("[deleteMyReviewAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while deleting your review.",
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Lists reviews, rating summary, and histogram for a menu item.
 * Privacy invariant: Display name is formatted in SQL, zero email/user_id returned.
 */
export async function getItemReviewsAction(
  menuItemId: string,
  limit = 10,
  offset = 0
): Promise<ActionResult<ItemReviewsResult>> {
  try {
    await requireRole(["student"]);

    const parsed = listReviewsSchema.safeParse({ menuItemId, limit, offset });
    if (!parsed.success) {
      return { success: false, error: "Invalid review query parameters", code: "INVALID_INPUT" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_item_reviews", {
      p_menu_item_id: parsed.data.menuItemId,
      p_limit: parsed.data.limit,
      p_offset: parsed.data.offset,
    });

    if (error) {
      logSupabaseError("getItemReviewsAction:rpc", error);
      if (error.message?.includes("NOT_FOUND")) {
        return { success: false, error: "Item not found", code: "NOT_FOUND" };
      }
      return { success: false, error: "Failed to load reviews", code: "RPC_ERROR" };
    }

    return {
      success: true,
      data: data as ItemReviewsResult,
    };
  } catch (err) {
    console.error("[getItemReviewsAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while loading reviews.",
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Checks review eligibility and existing reviews for up to 50 menu items.
 */
export async function getReviewEligibilityAction(
  menuItemIds: string[]
): Promise<ActionResult<ReviewEligibilityItem[]>> {
  try {
    await requireRole(["student"]);

    const parsed = eligibilitySchema.safeParse(menuItemIds);
    if (!parsed.success) {
      return { success: false, error: "Invalid item IDs requested", code: "INVALID_INPUT" };
    }

    if (parsed.data.length === 0) {
      return { success: true, data: [] };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_review_eligibility", {
      p_menu_item_ids: parsed.data,
    });

    if (error) {
      logSupabaseError("getReviewEligibilityAction:rpc", error);
      return { success: false, error: "Failed to check eligibility", code: "RPC_ERROR" };
    }

    return {
      success: true,
      data: (data as ReviewEligibilityItem[]) || [],
    };
  } catch (err) {
    console.error("[getReviewEligibilityAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while checking review eligibility.",
      code: "INTERNAL_ERROR",
    };
  }
}
