import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const { mockRequireRole, mockRpc, mockFrom, mockStorage } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockStorage: {
    from: vi.fn(),
  },
}));

vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    storage: mockStorage,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { parseRupeesToPaise } from "@/lib/money";
import {
  validateImageBytes,
  isAllowedMenuImageUrl,
  extractStorageFilename,
  MAX_IMAGE_SIZE_BYTES,
} from "@/lib/image-upload";
import {
  adminSetUserRoleAction,
  adminSetUserActiveAction,
  adminUpdateCanteenSettingsAction,
} from "@/server/actions/admin";

describe("Phase 8 Admin Operations", () => {
  const validAdminId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validTargetId = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22";
  const validCanteenId = "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c33";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: validAdminId,
      role: "admin",
      is_active: true,
    });
  });

  describe("Requirement 10: Strict Price Parsing (parseRupeesToPaise)", () => {
    it("converts standard rupee strings to integer paise without float math", () => {
      expect(parseRupeesToPaise("50")).toEqual({ success: true, paise: 5000 });
      expect(parseRupeesToPaise("50.00")).toEqual({ success: true, paise: 5000 });
      expect(parseRupeesToPaise("50.5")).toEqual({ success: true, paise: 5050 });
      expect(parseRupeesToPaise("50.50")).toEqual({ success: true, paise: 5050 });
      expect(parseRupeesToPaise("1.25")).toEqual({ success: true, paise: 125 });
    });

    it("correctly handles 0.1 and 0.2 style inputs avoiding IEEE-754 precision issues", () => {
      // Float 0.1 + 0.2 produces 0.30000000000000004 in JavaScript.
      // String parsing must handle "0.10" and "0.20" and "0.30" cleanly.
      expect(parseRupeesToPaise("0.10")).toEqual({ success: true, paise: 10 });
      expect(parseRupeesToPaise("0.20")).toEqual({ success: true, paise: 20 });
      expect(parseRupeesToPaise("0.30")).toEqual({ success: true, paise: 30 });
    });

    it("parses maximum allowed price correctly", () => {
      // 99999.99 rupees -> 9999999 paise
      expect(parseRupeesToPaise("99999.99")).toEqual({ success: true, paise: 9999999 });
      expect(parseRupeesToPaise("99999")).toEqual({ success: true, paise: 9999900 });
    });

    it("rejects prices with more than 2 decimal places (e.g. 1.005)", () => {
      const res = parseRupeesToPaise("1.005");
      expect(res.success).toBe(false);
      expect(res.error).toContain("valid price");
    });

    it("rejects zero, negative, empty, or non-numeric values", () => {
      expect(parseRupeesToPaise("0").success).toBe(false);
      expect(parseRupeesToPaise("0.00").success).toBe(false);
      expect(parseRupeesToPaise("-10").success).toBe(false);
      expect(parseRupeesToPaise("abc").success).toBe(false);
      expect(parseRupeesToPaise("").success).toBe(false);
      expect(parseRupeesToPaise("100000").success).toBe(false); // > 5 digits
    });
  });

  describe("Requirements 8 & 9: Image Validation & Magic Bytes", () => {
    it("detects valid JPEG images via magic bytes", () => {
      // JPEG header: FF D8 FF E0 ...
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = validateImageBytes(jpegBytes);
      expect(res.valid).toBe(true);
      expect(res.mimeType).toBe("image/jpeg");
      expect(res.extension).toBe("jpg");
    });

    it("detects valid PNG images via magic bytes", () => {
      // PNG header: 89 50 4E 47 0D 0A 1A 0A
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const res = validateImageBytes(pngBytes);
      expect(res.valid).toBe(true);
      expect(res.mimeType).toBe("image/png");
      expect(res.extension).toBe("png");
    });

    it("detects valid WebP images via magic bytes", () => {
      // WebP header: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
      const webpBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // length
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      const res = validateImageBytes(webpBytes);
      expect(res.valid).toBe(true);
      expect(res.mimeType).toBe("image/webp");
      expect(res.extension).toBe("webp");
    });

    it("rejects files exceeding 2 MB limit", () => {
      const oversizedBytes = new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1);
      const res = validateImageBytes(oversizedBytes);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("exceeds maximum 2 MB");
    });

    it("rejects disguised non-image files with fake headers", () => {
      const textBytes = new TextEncoder().encode("<html><script>alert(1)</script></html>");
      const res = validateImageBytes(textBytes);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Invalid image format");
    });

    it("validates allowed menu-images URLs and extracts storage path", () => {
      const validUrl =
        "https://example.supabase.co/storage/v1/object/public/menu-images/dosa-123.jpg";
      expect(isAllowedMenuImageUrl(validUrl)).toBe(true);
      expect(extractStorageFilename(validUrl)).toBe("dosa-123.jpg");

      const externalUrl = "https://evil.com/fake-image.jpg";
      expect(isAllowedMenuImageUrl(externalUrl)).toBe(false);
      expect(extractStorageFilename(externalUrl)).toBeNull();

      expect(isAllowedMenuImageUrl(null)).toBe(true);
      expect(extractStorageFilename(null)).toBeNull();
    });
  });

  describe("Admin Role Management & Protections", () => {
    it("maps CANNOT_MODIFY_SELF error when admin attempts to alter own role", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "CANNOT_MODIFY_SELF: Administrators cannot change their own role" },
      });

      const res = await adminSetUserRoleAction(validAdminId, "student");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CANNOT_MODIFY_SELF");
        expect(res.error).toContain("cannot change your own");
      }
    });

    it("maps LAST_ADMIN error when demoting the last active administrator", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "LAST_ADMIN: Cannot demote the last remaining active administrator" },
      });

      const res = await adminSetUserRoleAction(validTargetId, "student");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("LAST_ADMIN");
        expect(res.error).toContain("last remaining active administrator");
      }
    });

    it("rejects staff role assignment without a valid canteen ID", async () => {
      const res = await adminSetUserRoleAction(validTargetId, "staff", null);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("INVALID_INPUT");
        expect(res.error).toContain("must be assigned to an active canteen");
      }
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("maps CANNOT_MODIFY_SELF error on self-deactivation", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: "CANNOT_MODIFY_SELF: Administrators cannot deactivate their own account",
        },
      });

      const res = await adminSetUserActiveAction(validAdminId, false);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CANNOT_MODIFY_SELF");
      }
    });
  });

  describe("Canteen Settings Validation", () => {
    it("maps database range and order validations cleanly", async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: "INVALID_INPUT: Closing time must be strictly after opening time",
        },
      });

      const res = await adminUpdateCanteenSettingsAction(validCanteenId, {
        opens_at: "17:00:00",
        closes_at: "08:00:00",
        last_order_time: "16:00:00",
        kitchen_capacity: 5,
        min_lead_minutes: 5,
        hold_minutes: 15,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("SETTINGS_FAILED");
        expect(res.error).toContain("strictly after opening time");
      }
    });
  });

  describe("Security Invariant: Pickup Token Non-Selection", () => {
    it("asserts that admin server actions and UI code NEVER select pickup_token", () => {
      const adminActionsPath = path.resolve(__dirname, "../actions/admin.ts");
      const adminActionsContent = fs.readFileSync(adminActionsPath, "utf-8");

      // Verify that admin.ts select calls never include pickup_token
      const selectMatches = adminActionsContent.match(
        /\.select\(\s*[`'"][^`'"]*[`'"]\s*\)/g
      );
      if (selectMatches) {
        for (const match of selectMatches) {
          expect(match).not.toContain("pickup_token");
        }
      }

      // Check migration 0006 as well
      const migrationPath = path.resolve(
        __dirname,
        "../../../supabase/migrations/0006_admin_operations.sql"
      );
      const migrationContent = fs.readFileSync(migrationPath, "utf-8");

      // admin_list_orders must not select pickup_token
      const listOrdersSection = migrationContent.slice(
        migrationContent.indexOf("admin_list_orders"),
        migrationContent.indexOf("admin_list_users")
      );
      expect(listOrdersSection).not.toContain("pickup_token");
    });
  });
});
