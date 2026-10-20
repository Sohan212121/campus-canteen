import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockGetActiveCanteenId = vi.fn();
vi.mock("@/server/canteen", () => ({
  getActiveCanteenId: () => mockGetActiveCanteenId(),
}));

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { getBestSellersAction } from "@/server/actions/best-sellers";
import { formatBestSellerBadge, formatUnitsSoldBadge } from "@/lib/best-sellers";

describe("Best Sellers Pure Helpers", () => {
  it("formats accessible rank badges properly", () => {
    expect(formatBestSellerBadge(1)).toBe("Best seller #1");
    expect(formatBestSellerBadge(2)).toBe("Best seller #2");
    expect(formatBestSellerBadge(10)).toBe("Best seller #10");
    expect(formatBestSellerBadge(0)).toBe("Best seller");
  });

  it("formats units sold badges properly", () => {
    expect(formatUnitsSoldBadge("10+")).toBe("10+ ordered");
    expect(formatUnitsSoldBadge("50+")).toBe("50+ ordered");
    expect(formatUnitsSoldBadge("500+")).toBe("500+ ordered");
    expect(formatUnitsSoldBadge("Popular")).toBe("Popular pick");
    expect(formatUnitsSoldBadge("")).toBe("Popular pick");
  });
});

describe("getBestSellersAction Server Action", () => {
  const dummyCanteenId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-uuid",
      role: "student",
      is_active: true,
    });
    mockGetActiveCanteenId.mockResolvedValue(dummyCanteenId);
  });

  it("enforces student role check", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await getBestSellersAction();

    expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
  });

  it("returns empty array if no active canteen is found", async () => {
    mockGetActiveCanteenId.mockResolvedValue(null);

    const result = await getBestSellersAction();

    expect(result).toEqual({ success: true, data: [] });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("degrades silently when RPC returns error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Database connection failed" },
    });

    const result = await getBestSellersAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns empty array when RPC returns fewer than 3 items", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { menu_item_id: "item-1", rank: 1, units_sold: "50+" },
        { menu_item_id: "item-2", rank: 2, units_sold: "25+" },
      ],
      error: null,
    });

    const result = await getBestSellersAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("assembles items when 3 or more qualifying items are returned", async () => {
    const rawRpc = [
      { menu_item_id: "item-1", rank: 1, units_sold: "100+" },
      { menu_item_id: "item-2", rank: 2, units_sold: "50+" },
      { menu_item_id: "item-3", rank: 3, units_sold: "10+" },
    ];
    mockRpc.mockResolvedValue({ data: rawRpc, error: null });

    const menuRows = [
      {
        id: "item-1",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Crispy Dosa",
        description: "Delicious",
        price_paise: 5000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 50,
        prep_minutes: 5,
        is_active: true,
      },
      {
        id: "item-2",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Filter Coffee",
        description: "Hot",
        price_paise: 2000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 100,
        prep_minutes: 3,
        is_active: true,
      },
      {
        id: "item-3",
        canteen_id: dummyCanteenId,
        category_id: "cat-2",
        name: "Idli Sambar",
        description: "Steamed",
        price_paise: 4000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 20,
        prep_minutes: 4,
        is_active: true,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: menuRows, error: null }),
    });

    const result = await getBestSellersAction();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data[0].rank).toBe(1);
    expect(result.data[0].item.name).toBe("Crispy Dosa");
    expect(result.data[1].rank).toBe(2);
    expect(result.data[2].rank).toBe(3);
  });

  it("drops unavailable items and returns empty array if remaining count drops below 3", async () => {
    const rawRpc = [
      { menu_item_id: "item-1", rank: 1, units_sold: "100+" },
      { menu_item_id: "item-2", rank: 2, units_sold: "50+" },
      { menu_item_id: "item-3", rank: 3, units_sold: "10+" },
    ];
    mockRpc.mockResolvedValue({ data: rawRpc, error: null });

    // Item 3 is missing or unavailable in database
    const menuRows = [
      {
        id: "item-1",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Crispy Dosa",
        description: null,
        price_paise: 5000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 50,
        prep_minutes: 5,
        is_active: true,
      },
      {
        id: "item-2",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Filter Coffee",
        description: null,
        price_paise: 2000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 100,
        prep_minutes: 3,
        is_active: true,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: menuRows, error: null }),
    });

    const result = await getBestSellersAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("handles missing column error (42703) with clear warning and falls back to basic columns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rawRpc = [
      { menu_item_id: "item-1", rank: 1, units_sold: "100+" },
      { menu_item_id: "item-2", rank: 2, units_sold: "50+" },
      { menu_item_id: "item-3", rank: 3, units_sold: "10+" },
    ];
    mockRpc.mockResolvedValue({ data: rawRpc, error: null });

    const menuRowsWithoutNutrition = [
      {
        id: "item-1",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Crispy Dosa",
        description: "Delicious",
        price_paise: 5000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 50,
        prep_minutes: 5,
        is_active: true,
      },
      {
        id: "item-2",
        canteen_id: dummyCanteenId,
        category_id: "cat-1",
        name: "Filter Coffee",
        description: "Hot",
        price_paise: 2000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 100,
        prep_minutes: 3,
        is_active: true,
      },
      {
        id: "item-3",
        canteen_id: dummyCanteenId,
        category_id: "cat-2",
        name: "Idli Sambar",
        description: "Steamed",
        price_paise: 4000,
        image_url: null,
        is_veg: true,
        is_available: true,
        stock: 20,
        prep_minutes: 4,
        is_active: true,
      },
    ];

    let queryCount = 0;
    mockFrom.mockImplementation(() => {
      queryCount++;
      if (queryCount === 1) {
        // First query fails with 42703 (undefined column)
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({
              data: null,
              error: {
                code: "42703",
                message: 'column menu_items.calories_kcal does not exist',
                details: "migration 0018 not yet applied",
                hint: "Run migration 0018",
              },
            }),
        };
      } else {
        // Fallback query succeeds with basic columns
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: menuRowsWithoutNutrition, error: null }),
        };
      }
    });

    const result = await getBestSellersAction();

    // Must succeed and assemble all 3 items rather than returning an empty list
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data[0].item.name).toBe("Crispy Dosa");
    expect(result.data[0].item.calories_kcal).toBeNull();
    expect(result.data[0].item.ingredients).toEqual([]);

    // Must log a clear one-line warning mentioning "migration 0018 not applied"
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("migration 0018 not applied")
    );

    // Must log the Supabase error via logSupabaseError (with code and message stringified)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('code: "42703"')
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
