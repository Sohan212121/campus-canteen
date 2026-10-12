import { describe, it, expect } from "vitest";
import {
  isValidMenuImageUrl,
  shouldRenderMenuImage,
  extractMenuItemImageUrl,
  type MenuItemJoinRelation,
} from "@/lib/image-utils";

describe("image-utils (Pure Function Tests without DOM)", () => {
  describe("isValidMenuImageUrl", () => {
    it("accepts valid canonical Supabase menu-images storage URLs", () => {
      expect(
        isValidMenuImageUrl(
          "https://xyz.supabase.co/storage/v1/object/public/menu-images/dosa-123.webp"
        )
      ).toBe(true);
      expect(
        isValidMenuImageUrl(
          "http://127.0.0.1:54321/storage/v1/object/public/menu-images/tea.jpg"
        )
      ).toBe(true);
    });

    it("accepts relative menu-images storage paths", () => {
      expect(
        isValidMenuImageUrl(
          "/storage/v1/object/public/menu-images/samosa.png"
        )
      ).toBe(true);
    });

    it("rejects null, undefined, and empty string", () => {
      expect(isValidMenuImageUrl(null)).toBe(false);
      expect(isValidMenuImageUrl(undefined)).toBe(false);
      expect(isValidMenuImageUrl("")).toBe(false);
      expect(isValidMenuImageUrl("   ")).toBe(false);
    });

    it("rejects malicious or dangerous protocols", () => {
      expect(isValidMenuImageUrl("javascript:alert('xss')")).toBe(false);
      expect(isValidMenuImageUrl("data:image/png;base64,AAAA")).toBe(false);
      expect(isValidMenuImageUrl("vbscript:msgbox(1)")).toBe(false);
    });

    it("rejects foreign untrusted domains not containing storage path", () => {
      expect(isValidMenuImageUrl("https://attacker.com/malicious.jpg")).toBe(false);
      expect(isValidMenuImageUrl("https://random-cdn.com/photos/food.webp")).toBe(false);
    });

    it("rejects URLs pointing to buckets other than menu-images", () => {
      expect(
        isValidMenuImageUrl(
          "https://xyz.supabase.co/storage/v1/object/public/user-avatars/user.jpg"
        )
      ).toBe(false);
      expect(
        isValidMenuImageUrl(
          "https://xyz.supabase.co/storage/v1/object/public/canteen-docs/contract.pdf"
        )
      ).toBe(false);
    });
  });

  describe("shouldRenderMenuImage fallback decision", () => {
    const validUrl = "https://xyz.supabase.co/storage/v1/object/public/menu-images/idli.jpg";

    it("returns true when URL is valid and hasError is false", () => {
      expect(shouldRenderMenuImage(validUrl, false)).toBe(true);
    });

    it("returns false when hasError is true, even with a valid URL", () => {
      expect(shouldRenderMenuImage(validUrl, true)).toBe(false);
    });

    it("returns false when src is null or undefined", () => {
      expect(shouldRenderMenuImage(null, false)).toBe(false);
      expect(shouldRenderMenuImage(undefined, false)).toBe(false);
    });

    it("returns false when src is invalid", () => {
      expect(shouldRenderMenuImage("https://evil.com/img.png", false)).toBe(false);
      expect(shouldRenderMenuImage("", false)).toBe(false);
    });
  });

  describe("extractMenuItemImageUrl (PostgREST Join Normalisation)", () => {
    const testUrl = "https://xyz.supabase.co/storage/v1/object/public/menu-images/dosa.webp";

    it("handles null and undefined gracefully", () => {
      expect(extractMenuItemImageUrl(null)).toBeNull();
      expect(extractMenuItemImageUrl(undefined)).toBeNull();
    });

    it("normalises single object relation shape", () => {
      const relation: MenuItemJoinRelation = { image_url: testUrl };
      expect(extractMenuItemImageUrl(relation)).toBe(testUrl);

      const nullImageRelation: MenuItemJoinRelation = { image_url: null };
      expect(extractMenuItemImageUrl(nullImageRelation)).toBeNull();
    });

    it("normalises array relation shape (Supabase multi-join)", () => {
      const relationArray: MenuItemJoinRelation = [{ image_url: testUrl }];
      expect(extractMenuItemImageUrl(relationArray)).toBe(testUrl);

      const emptyArray: MenuItemJoinRelation = [];
      expect(extractMenuItemImageUrl(emptyArray)).toBeNull();

      const arrayWithNullImage: MenuItemJoinRelation = [{ image_url: null }];
      expect(extractMenuItemImageUrl(arrayWithNullImage)).toBeNull();
    });
  });
});
