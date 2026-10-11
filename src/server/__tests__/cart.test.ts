import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { getCartItemDetailsAction } from "@/server/actions/cart";
import { getActiveCanteenId } from "@/server/canteen";

describe("getCartItemDetailsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "user-1",
      role: "student",
      is_active: true,
    });
  });

  it("calls requireRole to ensure user is authenticated", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await getCartItemDetailsAction([]);
    expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
  });

  it("returns error if input array contains non-UUID strings", async () => {
    const result = await getCartItemDetailsAction(["invalid-uuid", "another-invalid"]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid item IDs requested.");
  });

  it("returns error if requested IDs exceed 50 items", async () => {
    const tooManyUuids = Array.from({ length: 51 }, () =>
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    );
    const result = await getCartItemDetailsAction(tooManyUuids);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid item IDs requested.");
  });

  it("returns empty data array without querying DB when itemIds is empty", async () => {
    const result = await getCartItemDetailsAction([]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fetches fresh menu items by valid UUIDs", async () => {
    const validId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const mockItems = [
      {
        id: validId,
        name: "Masala Dosa",
        price_paise: 5000,
        is_available: true,
        is_active: true,
        stock: null,
        prep_minutes: 8,
        image_url: null,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    });

    const result = await getCartItemDetailsAction([validId]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockItems);
  });
});

describe("getActiveCanteenId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the first active canteen ID", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "canteen-123" },
        error: null,
      }),
    });

    const id = await getActiveCanteenId();
    expect(id).toBe("canteen-123");
  });

  it("returns null if no active canteen exists", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const id = await getActiveCanteenId();
    expect(id).toBeNull();
  });
});
