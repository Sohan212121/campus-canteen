import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { placeOrderAction, getPickupEstimateAction } from "@/server/actions/order";

describe("placeOrderAction", () => {
  const validCanteenId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validItemId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-1",
      role: "student",
      is_active: true,
    });
  });

  it("enforces requireRole before processing", async () => {
    mockRpc.mockResolvedValue({ data: { order_id: "order-1" }, error: null });

    await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 2 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
      requestedAt: null,
    });

    expect(mockRequireRole).toHaveBeenCalledWith(["student", "staff", "admin"]);
  });

  it("fails validation when items array is empty", async () => {
    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails validation when quantity exceeds 10", async () => {
    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 11 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("fails validation when requestedAt does not have timezone offset", async () => {
    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 1 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
      requestedAt: "2026-10-08T12:00:00", // missing offset
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("maps SCHEDULE_TOO_EARLY error and formats earliest hint with +05:30", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "SCHEDULE_TOO_EARLY: Requested pickup time is earlier than earliest achievable time",
        hint: "2026-10-08T16:45:00",
      },
    });

    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 1 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
      requestedAt: "2026-10-08T16:30:00+05:30",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("SCHEDULE_TOO_EARLY");
    expect(result.suggestedEarliestAt).toBe("2026-10-08T16:45:00+05:30");
  });

  it("maps INSUFFICIENT_STOCK to STOCK_CHANGED error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'INSUFFICIENT_STOCK: Item "Samosa" only has 2 available',
      },
    });

    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 5 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("STOCK_CHANGED");
    expect(result.error).toContain('Item "Samosa" only has 2 available');
  });

  it("maps TOO_MANY_ACTIVE_ORDERS error code", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: "TOO_MANY_ACTIVE_ORDERS: You have reached the maximum limit of 3 active orders",
      },
    });

    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 1 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("TOO_MANY_ACTIVE_ORDERS");
  });

  it("returns order data successfully on place_order success", async () => {
    const mockOrderData = {
      order_id: "order-123",
      order_code: "CN10001",
      status: "PLACED",
      total_paise: 5000,
      estimated_ready_at: "2026-10-08T16:45:00+05:30",
      pickup_window_end: "2026-10-08T17:00:00+05:30",
      requested_pickup_at: null,
      was_duplicate: false,
    };

    mockRpc.mockResolvedValue({
      data: mockOrderData,
      error: null,
    });

    const result = await placeOrderAction({
      canteenId: validCanteenId,
      items: [{ menu_item_id: validItemId, quantity: 1 }],
      paymentMethod: "PAY_AT_PICKUP",
      idempotencyKey: "key-123",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockOrderData);
  });
});

describe("getPickupEstimateAction", () => {
  const validCanteenId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validItemId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-1",
      role: "student",
      is_active: true,
    });
  });

  it("returns estimate when valid", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          estimated_ready_at: "2026-10-08T16:50:00+05:30",
          pickup_window_end: "2026-10-08T17:05:00+05:30",
          prep_minutes_total: 10,
        },
      ],
      error: null,
    });

    const res = await getPickupEstimateAction(validCanteenId, [
      { menu_item_id: validItemId, quantity: 2 },
    ]);

    expect(res.success).toBe(true);
    expect(res.data?.prep_minutes_total).toBe(10);
  });
});
