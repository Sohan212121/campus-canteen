"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";
import { logSupabaseError } from "@/lib/supabase-error";

const listAdminReviewsSchema = z.object({
  status: z.enum(["all", "visible", "hidden"]).optional().default("all"),
  search: z.string().max(100).optional().nullable(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const setHiddenSchema = z.object({
  reviewId: z.string().uuid("Invalid review ID"),
  hidden: z.boolean(),
});

export type AdminReviewRow = {
  id: string;
  menu_item_id: string;
  item_name: string;
  canteen_name: string;
  user_id: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
};

export type AdminListReviewsResult = {
  reviews: AdminReviewRow[];
  total_count: number;
  limit: number;
  offset: number;
};

export type ActionResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
};

/**
 * Lists reviews with reviewer email and canteen metadata for admin moderation.
 */
export async function adminListReviewsAction(input?: {
  status?: "all" | "visible" | "hidden";
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<ActionResult<AdminListReviewsResult>> {
  try {
    await requireRole(["admin"]);

    const parsed = listAdminReviewsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      return { success: false, error: "Invalid moderation query parameters", code: "INVALID_INPUT" };
    }

    const { status, search, limit, offset } = parsed.data;
    const cleanSearch = search ? search.trim() : null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_reviews", {
      p_status: status,
      p_search: cleanSearch,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      logSupabaseError("adminListReviewsAction:rpc", error);
      return { success: false, error: "Failed to load moderation reviews", code: "RPC_ERROR" };
    }

    return {
      success: true,
      data: data as AdminListReviewsResult,
    };
  } catch (err) {
    console.error("[adminListReviewsAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while loading moderation reviews.",
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Hides or unhides a review with audit logging in admin_audit_log.
 */
export async function adminSetReviewHiddenAction(
  reviewId: string,
  hidden: boolean
): Promise<ActionResult<{ review_id: string; is_hidden: boolean; changed: boolean }>> {
  try {
    await requireRole(["admin"]);

    const parsed = setHiddenSchema.safeParse({ reviewId, hidden });
    if (!parsed.success) {
      return { success: false, error: "Invalid review ID or status", code: "INVALID_INPUT" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_set_review_hidden", {
      p_review_id: parsed.data.reviewId,
      p_hidden: parsed.data.hidden,
    });

    if (error) {
      logSupabaseError("adminSetReviewHiddenAction:rpc", error);
      return { success: false, error: "Failed to update review visibility", code: "RPC_ERROR" };
    }

    revalidatePath("/admin/reviews");
    revalidatePath("/menu");

    return {
      success: true,
      data: data as { review_id: string; is_hidden: boolean; changed: boolean },
    };
  } catch (err) {
    console.error("[adminSetReviewHiddenAction] Unexpected error:", err);
    return {
      success: false,
      error: "An unexpected error occurred while moderating review.",
      code: "INTERNAL_ERROR",
    };
  }
}
