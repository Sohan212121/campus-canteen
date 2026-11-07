import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

// Mock Supabase Server Client
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { getCurrentUser } from "@/server/auth";
import { getActiveCanteenId, getCanteenById } from "@/server/canteen";

describe("Sub-Step 3A: Per-request memoisation with React cache()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Static verification of cache() usage", () => {
    it("verifies getCurrentUser in src/server/auth.ts is wrapped in React cache()", () => {
      const authFile = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/auth.ts"),
        "utf-8"
      );
      expect(authFile).toMatch(/export\s+const\s+getCurrentUser\s*=\s*cache\(/);
    });

    it("verifies getActiveCanteenId in src/server/canteen.ts is wrapped in React cache()", () => {
      const canteenFile = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/canteen.ts"),
        "utf-8"
      );
      expect(canteenFile).toMatch(/export\s+const\s+getActiveCanteenId\s*=\s*cache\(/);
    });

    it("verifies getCanteenById in src/server/canteen.ts is wrapped in React cache()", () => {
      const canteenFile = fs.readFileSync(
        path.resolve(process.cwd(), "src/server/canteen.ts"),
        "utf-8"
      );
      expect(canteenFile).toMatch(/export\s+const\s+getCanteenById\s*=\s*cache\(/);
    });
  });

  describe("Per-request isolation simulation (same result in request, no sharing across users)", () => {
    it("memoizes identical lookups within a single request context", async () => {
      const requestStorage = new AsyncLocalStorage<Map<string, unknown>>();

      function requestMemo<T, Args extends unknown[]>(fn: (...args: Args) => Promise<T>) {
        return async (...args: Args): Promise<T> => {
          const store = requestStorage.getStore();
          if (!store) return fn(...args);
          const key = JSON.stringify(args);
          if (store.has(key)) return store.get(key) as T;
          const val = await fn(...args);
          store.set(key, val);
          return val;
        };
      }

      let queryCounter = 0;
      const fetchProfile = requestMemo(async (userId: string) => {
        queryCounter++;
        return { userId, fetchedAt: Date.now() };
      });

      // Request 1
      await requestStorage.run(new Map(), async () => {
        const p1 = await fetchProfile("user-100");
        const p2 = await fetchProfile("user-100");
        expect(p1).toBe(p2);
        expect(queryCounter).toBe(1);
      });

      // Request 2 (different request context: must not use Request 1's cache)
      await requestStorage.run(new Map(), async () => {
        const p3 = await fetchProfile("user-100");
        expect(queryCounter).toBe(2);
      });
    });

    it("never shares data across different users", async () => {
      const requestStorage = new AsyncLocalStorage<Map<string, unknown>>();

      function requestMemo<T>(fn: (userId: string) => Promise<T>) {
        return async (userId: string): Promise<T> => {
          const store = requestStorage.getStore();
          if (!store) return fn(userId);
          if (store.has(userId)) return store.get(userId) as T;
          const val = await fn(userId);
          store.set(userId, val);
          return val;
        };
      }

      const getProfile = requestMemo(async (userId: string) => {
        return { userId, role: userId === "admin-user" ? "admin" : "student" };
      });

      await requestStorage.run(new Map(), async () => {
        const studentProfile = await getProfile("student-user");
        const adminProfile = await getProfile("admin-user");

        expect(studentProfile.role).toBe("student");
        expect(adminProfile.role).toBe("admin");
        expect(studentProfile).not.toEqual(adminProfile);
      });
    });
  });

  describe("getCurrentUser functional contract", () => {
    it("returns null when no authenticated session exists", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const profile = await getCurrentUser();
      expect(profile).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("returns profile row when authenticated session exists", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "student-42" } },
      });

      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValueOnce({
              data: {
                id: "student-42",
                full_name: "Rahul Verma",
                college_id: "RV-2024",
                role: "student",
                canteen_id: null,
                is_active: true,
              },
            }),
          }),
        }),
      });

      const profile = await getCurrentUser();
      expect(profile).not.toBeNull();
      expect(profile?.full_name).toBe("Rahul Verma");
      expect(profile?.role).toBe("student");
    });
  });

  describe("Canteen helpers functional contract", () => {
    it("getActiveCanteenId returns active canteen ID", async () => {
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValueOnce({
                  data: { id: "active-canteen-id" },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const id = await getActiveCanteenId();
      expect(id).toBe("active-canteen-id");
    });

    it("getCanteenById returns metadata for valid canteenId", async () => {
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValueOnce({
              data: {
                id: "canteen-99",
                name: "South Wing Canteen",
                location: "Block B",
                hold_minutes: 20,
                is_active: true,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await getCanteenById("canteen-99");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("South Wing Canteen");
      expect(result?.hold_minutes).toBe(20);
    });

    it("getCanteenById returns null for empty string without querying database", async () => {
      const result = await getCanteenById("");
      expect(result).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
