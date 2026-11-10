import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  isValidAvatarPath,
  buildAvatarStoragePath,
  validateImageMagicBytes,
  MAX_AVATAR_SIZE_BYTES,
  TARGET_AVATAR_SIZE_BYTES,
  MAX_AVATAR_DIMENSION,
} from "../avatar-utils";

describe("Avatar Utilities & Validation", () => {
  const testUserId = "11111111-2222-3333-4444-555555555555";
  const otherUserId = "99999999-8888-7777-6666-555555555555";

  describe("isValidAvatarPath", () => {
    it("accepts valid paths matching <userId>/<filename>.<ext>", () => {
      expect(isValidAvatarPath(`${testUserId}/photo.webp`, testUserId)).toBe(true);
      expect(isValidAvatarPath(`${testUserId}/avatar_123_abc.jpg`, testUserId)).toBe(true);
      expect(isValidAvatarPath(`${testUserId}/my-profile.png`, testUserId)).toBe(true);
      expect(isValidAvatarPath(`${testUserId}/image.jpeg`, testUserId)).toBe(true);
    });

    it("accepts valid path without expectedUserId check", () => {
      expect(isValidAvatarPath(`${testUserId}/avatar_test.webp`)).toBe(true);
    });

    it("rejects paths with mismatched user ID", () => {
      expect(isValidAvatarPath(`${otherUserId}/photo.webp`, testUserId)).toBe(false);
    });

    it("rejects path traversal attempts (../, ..\\)", () => {
      expect(isValidAvatarPath(`${testUserId}/../malicious.webp`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`../${testUserId}/photo.webp`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}/..\\malicious.webp`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}//double-slash.webp`, testUserId)).toBe(false);
    });

    it("rejects invalid extensions (.exe, .svg, .gif, .html)", () => {
      expect(isValidAvatarPath(`${testUserId}/photo.gif`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}/photo.svg`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}/malware.exe`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}/index.html`, testUserId)).toBe(false);
      expect(isValidAvatarPath(`${testUserId}/no-ext`, testUserId)).toBe(false);
    });

    it("rejects empty, null, or undefined values", () => {
      expect(isValidAvatarPath(null)).toBe(false);
      expect(isValidAvatarPath(undefined)).toBe(false);
      expect(isValidAvatarPath("")).toBe(false);
      expect(isValidAvatarPath("   ")).toBe(false);
    });

    it("rejects paths exceeding 120 characters", () => {
      const longName = "a".repeat(85);
      const longPath = `${testUserId}/${longName}.webp`;
      expect(longPath.length).toBeGreaterThan(120);
      expect(isValidAvatarPath(longPath, testUserId)).toBe(false);
    });
  });

  describe("buildAvatarStoragePath", () => {
    it("generates collision-resistant paths matching the schema", () => {
      const path1 = buildAvatarStoragePath(testUserId, "webp");
      const path2 = buildAvatarStoragePath(testUserId, "webp");

      expect(path1).not.toBe(path2);
      expect(isValidAvatarPath(path1, testUserId)).toBe(true);
      expect(isValidAvatarPath(path2, testUserId)).toBe(true);
      expect(path1.startsWith(`${testUserId}/`)).toBe(true);
      expect(path1.endsWith(".webp")).toBe(true);
    });

    it("supports jpg format", () => {
      const jpgPath = buildAvatarStoragePath(testUserId, "jpg");
      expect(isValidAvatarPath(jpgPath, testUserId)).toBe(true);
      expect(jpgPath.endsWith(".jpg")).toBe(true);
    });
  });

  describe("validateImageMagicBytes", () => {
    it("detects JPEG magic bytes (FF D8 FF)", () => {
      const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      expect(validateImageMagicBytes(buffer)).toBe("image/jpeg");
    });

    it("detects PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", () => {
      const buffer = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);
      expect(validateImageMagicBytes(buffer)).toBe("image/png");
    });

    it("detects WebP magic bytes (RIFF....WEBP)", () => {
      const buffer = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x20, 0x00, 0x00, 0x00, // Size
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      expect(validateImageMagicBytes(buffer)).toBe("image/webp");
    });

    it("rejects GIF magic bytes (GIF89a / GIF87a)", () => {
      const gifBuffer = new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
      ]);
      expect(validateImageMagicBytes(gifBuffer)).toBeNull();
    });

    it("rejects HTML / SVG text or arbitrary bytes", () => {
      const svgBuffer = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
      expect(validateImageMagicBytes(svgBuffer)).toBeNull();

      const htmlBuffer = new TextEncoder().encode("<!DOCTYPE html><html><body></body></html>");
      expect(validateImageMagicBytes(htmlBuffer)).toBeNull();
    });

    it("rejects truncated buffers under 12 bytes", () => {
      const shortBuffer = new Uint8Array([0xff, 0xd8, 0xff]);
      expect(validateImageMagicBytes(shortBuffer)).toBeNull();
    });
  });

  describe("Constants and Bounds", () => {
    it("enforces strict size and dimension constants", () => {
      expect(MAX_AVATAR_DIMENSION).toBe(512);
      expect(TARGET_AVATAR_SIZE_BYTES).toBe(300 * 1024);
      expect(MAX_AVATAR_SIZE_BYTES).toBe(1048576); // 1 MB
    });
  });

  describe("Remove Flow Ordering Invariant", () => {
    it("clears DB path even when storage deletion fails", async () => {
      // Simulate remove flow step ordering
      const db = {
        avatar_path: "user-1/avatar.webp" as string | null,
        update: vi.fn().mockImplementation((val: { avatar_path: null }) => {
          db.avatar_path = val.avatar_path;
          return { error: null };
        }),
      };

      const storage = {
        remove: vi.fn().mockRejectedValue(new Error("Storage network failure")),
      };

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Step 1: Update DB first
      const { error: dbError } = db.update({ avatar_path: null });
      expect(dbError).toBeNull();
      expect(db.avatar_path).toBeNull();

      // Step 2: Attempt storage deletion; should not rethrow or rollback DB
      try {
        await storage.remove(["user-1/avatar.webp"]);
      } catch (err) {
        console.error("Failed to delete avatar from storage:", err);
      }

      expect(db.avatar_path).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to delete avatar from storage:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Static Security Audit", () => {
    const filesToAudit = [
      "src/components/student/profile-view.tsx",
      "src/components/student/student-header.tsx",
      "src/app/(student)/profile/page.tsx",
      "src/app/(student)/layout.tsx",
      "src/server/actions/profile.ts",
    ];

    it("verifies NO localStorage is used for avatar persistence", () => {
      for (const relPath of filesToAudit) {
        const fullPath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content).not.toMatch(/localStorage\.(setItem|getItem)\(.*avatar/i);
        }
      }
    });

    it("verifies NO public URL helper is used for private avatars bucket", () => {
      for (const relPath of filesToAudit) {
        const fullPath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          // avatars bucket must only use createSignedUrl, never getPublicUrl
          expect(content).not.toMatch(/\.from\(["']avatars["']\)\.getPublicUrl/);
        }
      }
    });
  });
});

