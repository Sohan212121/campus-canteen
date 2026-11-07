import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

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

vi.mock("@/lib/timeout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/timeout")>();
  return {
    ...actual,
    withTimeout: vi.fn(async (promiseOrFactory: unknown) => {
      if ((globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__) {
        throw new actual.TimeoutError("auth service unreachable");
      }
      return typeof promiseOrFactory === "function"
        ? (promiseOrFactory as (s: AbortSignal) => unknown)(new AbortController().signal)
        : promiseOrFactory;
    }),
  };
});

import { requireRole } from "@/server/auth";

describe("Sub-Step 3C: requireRole timeout safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = false;
  });

  it("throws friendly error on timeout and NEVER redirects to /login", async () => {
    (globalThis as unknown as { __SIMULATE_TIMEOUT__?: boolean }).__SIMULATE_TIMEOUT__ = true;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(requireRole(["student"])).rejects.toThrow(
      "We can't reach the service right now. Please try again."
    );

    // CRITICAL REQUIREMENT: Must NOT redirect to /login
    expect(mockRedirect).not.toHaveBeenCalledWith("/login");
    expect(consoleErrorSpy).toHaveBeenCalledWith("auth service unreachable");

    consoleErrorSpy.mockRestore();
  });

  it("redirects unauthenticated visitor to /login when not a timeout", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(requireRole(["student"])).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("permits authorized user on fast normal response", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "student-1", email: "stu@campus.edu" } } });
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValueOnce({
            data: {
              id: "student-1",
              full_name: "Aman",
              college_id: "AM-1",
              role: "student",
              canteen_id: null,
              is_active: true,
            },
          }),
        }),
      }),
    });

    const profile = await requireRole(["student"]);
    expect(profile.id).toBe("student-1");
    expect(profile.role).toBe("student");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
