import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireRole, mockFrom, mockStorage } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockFrom: vi.fn(),
  mockStorage: {
    from: vi.fn().mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    storage: mockStorage,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  adminCreateMenuItemAction,
  adminUpdateMenuItemAction,
  MenuItemInput,
} from "@/server/actions/admin";

describe("Admin Menu Actions - Nutrition & Existing Checks Validation", () => {
  const validAdminId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validCanteenId = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c33";
  const validCategoryId = "d3eebc99-9c0b-4ef8-bb6d-6bb9bd380d44";
  const validItemId = "e4eebc99-9c0b-4ef8-bb6d-6bb9bd380e55";

  let capturedInsertPayload: Record<string, unknown> | null = null;
  let capturedUpdatePayload: Record<string, unknown> | null = null;
  let capturedUpdateEqId: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: validAdminId,
      role: "admin",
      is_active: true,
    });

    capturedInsertPayload = null;
    capturedUpdatePayload = null;
    capturedUpdateEqId = null;

    mockFrom.mockImplementation((table: string) => {
      if (table === "menu_items") {
        return {
          insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            capturedInsertPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: validItemId, ...payload },
                  error: null,
                }),
              }),
            };
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            capturedUpdatePayload = payload;
            return {
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === "id") capturedUpdateEqId = val;
                return Promise.resolve({ data: null, error: null });
              }),
            };
          }),
        };
      }
      return {};
    });
  });

  const baseValidInput: MenuItemInput = {
    canteen_id: validCanteenId,
    category_id: validCategoryId,
    name: "Masala Dosa",
    description: "Crispy crepe with potato filling",
    price_rupees: "60.00",
    image_url: "https://example.supabase.co/storage/v1/object/public/menu-images/dosa.jpg",
    is_veg: true,
    is_available: true,
    stock: 25,
    prep_minutes: 10,
    calories_kcal: 320,
    ingredients: ["Rice batter", "Potato", "Ghee"],
  };

  describe("Amendment 2: Leave existing price, prep-minutes and image checks untouched", () => {
    it("rejects invalid price via existing check (e.g. invalid string or >2 decimal places)", async () => {
      const res = await adminCreateMenuItemAction({
        ...baseValidInput,
        price_rupees: "60.999",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("valid price");
      }
      expect(capturedInsertPayload).toBeNull();
    });

    it("rejects non-whitelisted image URLs via existing check", async () => {
      const res = await adminCreateMenuItemAction({
        ...baseValidInput,
        image_url: "https://unauthorized-domain.com/evil.jpg",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("menu-images storage bucket");
      }
      expect(capturedInsertPayload).toBeNull();
    });

    it("clamps prep_minutes between 1 and 180 via existing logic", async () => {
      await adminCreateMenuItemAction({
        ...baseValidInput,
        prep_minutes: 500, // should clamp to 180
      });
      expect(capturedInsertPayload).not.toBeNull();
      expect(capturedInsertPayload?.prep_minutes).toBe(180);

      await adminCreateMenuItemAction({
        ...baseValidInput,
        prep_minutes: -10, // should clamp to 1
      });
      expect(capturedInsertPayload?.prep_minutes).toBe(1);
    });

    it("validates calories and rejects out-of-range calories without altering other checks", async () => {
      const resTooHigh = await adminCreateMenuItemAction({
        ...baseValidInput,
        calories_kcal: 5001,
      });
      expect(resTooHigh.success).toBe(false);
      if (!resTooHigh.success) {
        expect(resTooHigh.error).toContain("5,000");
      }

      const resNegative = await adminCreateMenuItemAction({
        ...baseValidInput,
        calories_kcal: -5,
      });
      expect(resNegative.success).toBe(false);
      if (!resNegative.success) {
        expect(resNegative.error).toContain("0 and 5,000");
      }
    });

    it("validates ingredients and rejects more than 30 ingredients", async () => {
      const items31 = Array.from({ length: 31 }, (_, i) => `Ingredient ${i + 1}`);
      const res = await adminCreateMenuItemAction({
        ...baseValidInput,
        ingredients: items31,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error).toContain("30 ingredients");
      }
    });
  });

  describe("Amendment 3: Update semantics for calories and ingredients", () => {
    it("leaves stored values unchanged when calories and ingredients are omitted (undefined)", async () => {
      const updateData: MenuItemInput = {
        canteen_id: validCanteenId,
        category_id: validCategoryId,
        name: "Masala Dosa Updated",
        price_rupees: "65.00",
        is_veg: true,
        is_available: true,
        prep_minutes: 12,
        // calories_kcal and ingredients omitted
      };

      const res = await adminUpdateMenuItemAction(validItemId, updateData);
      expect(res.success).toBe(true);
      expect(capturedUpdatePayload).not.toBeNull();
      // Must NOT contain calories_kcal or ingredients keys
      expect(capturedUpdatePayload).not.toHaveProperty("calories_kcal");
      expect(capturedUpdatePayload).not.toHaveProperty("ingredients");
      expect(capturedUpdatePayload?.name).toBe("Masala Dosa Updated");
      expect(capturedUpdatePayload?.price_paise).toBe(6500);
      expect(capturedUpdateEqId).toBe(validItemId);
    });

    it("clears calories when sending null", async () => {
      const updateData: MenuItemInput = {
        ...baseValidInput,
        calories_kcal: null,
        ingredients: undefined, // leave ingredients alone
      };

      const res = await adminUpdateMenuItemAction(validItemId, updateData);
      expect(res.success).toBe(true);
      expect(capturedUpdatePayload).not.toBeNull();
      expect(capturedUpdatePayload?.calories_kcal).toBeNull();
      expect(capturedUpdatePayload).not.toHaveProperty("ingredients");
    });

    it("clears ingredients when sending an empty list", async () => {
      const updateData: MenuItemInput = {
        ...baseValidInput,
        calories_kcal: undefined, // leave calories alone
        ingredients: [],
      };

      const res = await adminUpdateMenuItemAction(validItemId, updateData);
      expect(res.success).toBe(true);
      expect(capturedUpdatePayload).not.toBeNull();
      expect(capturedUpdatePayload).not.toHaveProperty("calories_kcal");
      expect(capturedUpdatePayload?.ingredients).toEqual([]);
    });

    it("clears ingredients when sending null", async () => {
      const updateData: MenuItemInput = {
        ...baseValidInput,
        ingredients: null,
      };

      const res = await adminUpdateMenuItemAction(validItemId, updateData);
      expect(res.success).toBe(true);
      expect(capturedUpdatePayload?.ingredients).toEqual([]);
    });

    it("preserves values without wiping when opening existing dish and saving without edits", async () => {
      // Existing dish in DB: calories = 320, ingredients = ["Rice batter", "Potato", "Ghee"]
      // Form submits with existing values:
      const formPayload: MenuItemInput = {
        canteen_id: validCanteenId,
        category_id: validCategoryId,
        name: "Masala Dosa",
        description: "Crispy crepe with potato filling",
        price_rupees: "60.00",
        image_url: "https://example.supabase.co/storage/v1/object/public/menu-images/dosa.jpg",
        is_veg: true,
        is_available: true,
        stock: 25,
        prep_minutes: 10,
        calories_kcal: 320,
        ingredients: ["Rice batter", "Potato", "Ghee"],
      };

      const res = await adminUpdateMenuItemAction(validItemId, formPayload);
      expect(res.success).toBe(true);
      expect(capturedUpdatePayload).not.toBeNull();
      expect(capturedUpdatePayload?.calories_kcal).toBe(320);
      expect(capturedUpdatePayload?.ingredients).toEqual(["Rice batter", "Potato", "Ghee"]);
    });
  });
});
