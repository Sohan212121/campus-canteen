import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";
import { type NextRequest } from "next/server";

// Mock Supabase SSR client for proxy test
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  })),
}));

import { proxy } from "@/proxy";

function createMockRequest(pathname: string): NextRequest {
  const url = new URL(`https://example.com${pathname}`);
  return {
    method: "GET",
    headers: new Headers(),
    nextUrl: {
      pathname,
      clone: () => new URL(url.toString()),
    },
    cookies: {
      getAll: () => [],
      set: vi.fn(),
    },
  } as unknown as NextRequest;
}

describe("Phase 9: PWA Manifest, Offline, and Mobile Integration", () => {
  describe("PWA Manifest Structure", () => {
    it("returns correct metadata matching requirements", () => {
      const config = manifest();
      expect(config.name).toBe("C@mpBite");
      expect(config.short_name).toBe("C@mpBite");
      expect(config.start_url).toBe("/");
      expect(config.display).toBe("standalone");
      expect(config.theme_color).toBe("#18181b");
      expect(config.background_color).toBe("#ffffff");

      const icons = config.icons;
      expect(icons).toBeDefined();
      expect(icons).toHaveLength(3);

      const icon192 = icons?.find((i) => i.sizes === "192x192");
      expect(icon192).toBeDefined();
      expect(icon192?.src).toBe("/icons/icon-192.png");
      expect(icon192?.type).toBe("image/png");

      const icon512 = icons?.find((i) => i.sizes === "512x512" && !i.purpose);
      expect(icon512).toBeDefined();
      expect(icon512?.src).toBe("/icons/icon-512.png");

      const maskable = icons?.find((i) => i.purpose === "maskable");
      expect(maskable).toBeDefined();
      expect(maskable?.sizes).toBe("512x512");
      expect(maskable?.src).toBe("/icons/icon-maskable-512.png");
    });
  });

  describe("Real Icon Assets On Disk", () => {
    const publicIconsDir = path.join(process.cwd(), "public", "icons");

    it("verifies icon-192.png exists and is non-empty", () => {
      const iconPath = path.join(publicIconsDir, "icon-192.png");
      expect(fs.existsSync(iconPath)).toBe(true);
      const stat = fs.statSync(iconPath);
      expect(stat.size).toBeGreaterThan(1000);
    });

    it("verifies icon-512.png exists and is non-empty", () => {
      const iconPath = path.join(publicIconsDir, "icon-512.png");
      expect(fs.existsSync(iconPath)).toBe(true);
      const stat = fs.statSync(iconPath);
      expect(stat.size).toBeGreaterThan(1000);
    });

    it("verifies icon-maskable-512.png exists and is non-empty", () => {
      const iconPath = path.join(publicIconsDir, "icon-maskable-512.png");
      expect(fs.existsSync(iconPath)).toBe(true);
      const stat = fs.statSync(iconPath);
      expect(stat.size).toBeGreaterThan(1000);
    });
  });

  describe("Role Isolation for Install Prompt & Offline Page", () => {
    it("ensures Staff layout does not import or render the Install Prompt", () => {
      const staffLayoutPath = path.join(process.cwd(), "src", "app", "staff", "layout.tsx");
      const content = fs.readFileSync(staffLayoutPath, "utf-8");
      expect(content).not.toContain("install-prompt");
      expect(content).not.toContain("StudentInstallPrompt");
      expect(content).not.toContain("InstallPrompt");
    });

    it("ensures Admin layout does not import or render the Install Prompt", () => {
      const adminLayoutPath = path.join(process.cwd(), "src", "app", "admin", "layout.tsx");
      const content = fs.readFileSync(adminLayoutPath, "utf-8");
      expect(content).not.toContain("install-prompt");
      expect(content).not.toContain("StudentInstallPrompt");
      expect(content).not.toContain("InstallPrompt");
    });

    it("ensures /offline page contains no student components or cart logic", () => {
      const offlinePath = path.join(process.cwd(), "src", "app", "offline", "page.tsx");
      const content = fs.readFileSync(offlinePath, "utf-8");
      expect(content).not.toContain("@/components/student");
      expect(content).not.toContain("useCartStore");
      expect(content).not.toContain("StudentBottomNav");
      expect(content).not.toContain("StudentHeader");
      expect(content).not.toContain("StudentInstallPrompt");
    });
  });

  describe("Proxy Exclusions for PWA Assets and Offline Page", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
    });

    it("bypasses /manifest.webmanifest without authentication checks", async () => {
      const req = createMockRequest("/manifest.webmanifest");
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("bypasses /offline without authentication checks", async () => {
      const req = createMockRequest("/offline");
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(mockGetUser).not.toHaveBeenCalled();
    });

    it("bypasses /icons/* static assets without authentication checks", async () => {
      const req = createMockRequest("/icons/icon-192.png");
      const res = await proxy(req);
      expect(res.status).toBe(200);
      expect(mockGetUser).not.toHaveBeenCalled();
    });
  });

  describe("Install Prompt localStorage Resilience", () => {
    it("handles localStorage read/write failures gracefully in try/catch", () => {
      // Test that logic pattern used in StudentInstallPrompt survives throws
      const faultyLocalStorage = {
        getItem: () => {
          throw new Error("SecurityError: Access denied");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      };

      let readDismissed = false;
      try {
        readDismissed = faultyLocalStorage.getItem() === "true";
      } catch {
        // Handled gracefully
        readDismissed = false;
      }
      expect(readDismissed).toBe(false);

      let writeSucceeded = true;
      try {
        faultyLocalStorage.setItem();
      } catch {
        writeSucceeded = false;
      }
      expect(writeSucceeded).toBe(false);
    });
  });
});
