"use server";

import * as z from "zod";

import { requireRole } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";

const placeOrderItemSchema = z.object({
  menu_item_id: z.string().uuid("Invalid item ID"),
  quantity: z.number().int().min(1).max(10),
});

const placeOrderSchema = z.object({
  canteenId: z.string().uuid("Invalid canteen ID"),
  items: z.array(placeOrderItemSchema).min(1, "Cart cannot be empty").max(20, "Maximum 20 items per order"),
  paymentMethod: z.literal("PAY_AT_PICKUP"),
  idempotencyKey: z.string().min(1).max(64),
  requestedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export type PlaceOrderResult = {
  success: boolean;
  code?: string;
  error?: string;
  suggestedEarliestAt?: string;
  data?: {
    order_id: string;
    order_code: string;
    status: string;
    total_paise: number;
    estimated_ready_at: string;
    pickup_window_end: string;
    requested_pickup_at: string | null;
    was_duplicate: boolean;
  };
};

export type EstimatePickupResult = {
  success: boolean;
  code?: string;
  error?: string;
  suggestedEarliestAt?: string;
  data?: {
    estimated_ready_at: string;
    pickup_window_end: string;
    prep_minutes_total: number;
  };
};

/**
 * Normalizes an IST timestamp hint string (YYYY-MM-DDTHH:MI:SS) into an ISO string with +05:30 offset.
 */
function normalizeIstHint(hint: string | null | undefined): string | undefined {
  if (!hint) return undefined;
  const trimmed = hint.trim();
  if (trimmed.includes("+") || trimmed.endsWith("Z")) {
    return trimmed;
  }
  return `${trimmed}+05:30`;
}

/**
 * Places an order atomically through public.place_order using the user's session.
 */
export async function placeOrderAction(rawInput: unknown): Promise<PlaceOrderResult> {
  // 1. Enforce authenticated role
  await requireRole(["student", "staff", "admin"]);

  // 2. Validate input with Zod
  const parsed = placeOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: parsed.error.issues[0]?.message || "Invalid order parameters.",
    };
  }

  const { canteenId, items, paymentMethod, idempotencyKey, requestedAt } = parsed.data;

  // 3. Invoke public.place_order with user's session client
  const supabase = await createClient();

  const rpcParams: Record<string, unknown> = {
    p_canteen_id: canteenId,
    p_items: items,
    p_payment_method: paymentMethod,
    p_idempotency_key: idempotencyKey,
  };

  // Only pass p_requested_at if non-empty to let Postgres use DEFAULT NULL cleanly
  if (requestedAt) {
    rpcParams.p_requested_at = requestedAt;
  }

  const { data, error } = await supabase.rpc("place_order", rpcParams);

  if (error) {
    const rawMsg = error.message || "";
    const rawHint = (error as { hint?: string | null }).hint || undefined;

    // Detect missing database migration or stale PostgREST schema cache
    if (rawMsg.includes("Could not find the function") || rawMsg.includes("schema cache")) {
      return {
        success: false,
        code: "DATABASE_MIGRATION_REQUIRED",
        error: "Database function place_order is missing or schema cache needs reloading. Please run 0003_place_order.sql in Supabase SQL Editor and execute: NOTIFY pgrst, 'reload schema';",
      };
    }

    // Map known database error codes
    if (rawMsg.includes("SCHEDULE_TOO_EARLY")) {
      return {
        success: false,
        code: "SCHEDULE_TOO_EARLY",
        error: "Requested pickup time is earlier than the earliest achievable kitchen preparation time.",
        suggestedEarliestAt: normalizeIstHint(rawHint),
      };
    }

    if (rawMsg.includes("INSUFFICIENT_STOCK") || rawMsg.includes("ITEM_UNAVAILABLE")) {
      return {
        success: false,
        code: "STOCK_CHANGED",
        error: rawMsg.replace(/^[A-Z_]+:\s*/, ""),
      };
    }

    if (rawMsg.includes("TOO_MANY_ACTIVE_ORDERS")) {
      return {
        success: false,
        code: "TOO_MANY_ACTIVE_ORDERS",
        error: "You already have 3 active orders waiting or in preparation. Please collect them first.",
      };
    }

    if (rawMsg.includes("ORDERS_CLOSED")) {
      return {
        success: false,
        code: "ORDERS_CLOSED",
        error: "Pre-orders are closed for today.",
      };
    }

    if (rawMsg.includes("CANTEEN_CLOSED") || rawMsg.includes("CANTEEN_NOT_FOUND")) {
      return {
        success: false,
        code: "CANTEEN_CLOSED",
        error: "The canteen is currently closed or unavailable.",
      };
    }

    if (rawMsg.includes("INVALID_SCHEDULE")) {
      return {
        success: false,
        code: "INVALID_SCHEDULE",
        error: rawMsg.replace(/^[A-Z_]+:\s*/, ""),
      };
    }

    return {
      success: false,
      code: "UNKNOWN_ERROR",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to place order.",
    };
  }

  return {
    success: true,
    data: data as PlaceOrderResult["data"],
  };
}

/**
 * Preview estimate of kitchen preparation readiness using public.estimate_ready_time.
 */
export async function getPickupEstimateAction(
  canteenId: string,
  items: Array<{ menu_item_id: string; quantity: number }>,
  requestedAt?: string | null
): Promise<EstimatePickupResult> {
  await requireRole(["student", "staff", "admin"]);

  const parsed = placeOrderSchema.pick({ canteenId: true, items: true, requestedAt: true }).safeParse({
    canteenId,
    items,
    requestedAt,
  });

  if (!parsed.success) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Invalid estimation parameters.",
    };
  }

  const supabase = await createClient();

  const rpcParams: Record<string, unknown> = {
    p_canteen_id: parsed.data.canteenId,
    p_items: parsed.data.items,
  };

  if (parsed.data.requestedAt) {
    rpcParams.p_requested_at = parsed.data.requestedAt;
  }

  const { data, error } = await supabase.rpc("estimate_ready_time", rpcParams);

  if (error) {
    const rawMsg = error.message || "";
    const rawHint = (error as { hint?: string | null }).hint || undefined;

    if (rawMsg.includes("SCHEDULE_TOO_EARLY")) {
      return {
        success: false,
        code: "SCHEDULE_TOO_EARLY",
        error: "Requested time is earlier than earliest kitchen availability.",
        suggestedEarliestAt: normalizeIstHint(rawHint),
      };
    }

    if (rawMsg.includes("ORDERS_CLOSED")) {
      return {
        success: false,
        code: "ORDERS_CLOSED",
        error: "Orders are closed for today.",
      };
    }

    return {
      success: false,
      code: "ESTIMATE_FAILED",
      error: rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Could not calculate readiness estimate.",
    };
  }

  // estimate_ready_time returns a table with 1 row
  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return {
      success: false,
      code: "ESTIMATE_FAILED",
      error: "No estimate returned from kitchen.",
    };
  }

  return {
    success: true,
    data: {
      estimated_ready_at: row.estimated_ready_at,
      pickup_window_end: row.pickup_window_end,
      prep_minutes_total: row.prep_minutes_total,
    },
  };
}
