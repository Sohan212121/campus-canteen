import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase Server Client
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { getActiveCanteenId, getCanteenById } from "@/server/canteen";
import { getPublicCategories } from "@/server/categories";

describe("Sub-Step 3D: Safe caching of public, rarely-changing data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getActiveCanteenId retrieves active canteen ID with public caching", async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValueOnce({
                data: { id: "canteen-public-1" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const id = await getActiveCanteenId();
    expect(id).toBe("canteen-public-1");
  });

  it("getCanteenById retrieves public canteen metadata", async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValueOnce({
            data: {
              id: "canteen-public-1",
              name: "North Canteen",
              location: "Floor 1",
              hold_minutes: 15,
              is_active: true,
            },
            error: null,
          }),
        }),
      }),
    });

    const canteen = await getCanteenById("canteen-public-1");
    expect(canteen?.name).toBe("North Canteen");
    expect(canteen?.hold_minutes).toBe(15);
  });

  it("getPublicCategories retrieves categories filtered by canteen and is_active", async () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValueOnce({
              data: [
                { id: "cat-1", name: "Snacks", display_order: 1, is_active: true },
                { id: "cat-2", name: "Beverages", display_order: 2, is_active: true },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const categories = await getPublicCategories("canteen-public-1");
    expect(categories).toHaveLength(2);
    expect(categories[0].name).toBe("Snacks");
    expect(categories[1].name).toBe("Beverages");
  });

  it("returns empty array for invalid/empty canteen ID without hitting database", async () => {
    const categories = await getPublicCategories("");
    expect(categories).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

