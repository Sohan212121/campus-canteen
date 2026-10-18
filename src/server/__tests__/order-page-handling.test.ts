import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequireRole, mockNotFound, mockMaybeSingle } = vi.hoisted(() => {
  return {
    mockRequireRole: vi.fn(),
    mockNotFound: vi.fn(),
    mockMaybeSingle: vi.fn(),
  };
});

vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    mockNotFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createReadOnlyClient: vi.fn().mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  }),
}));

// Mock child components that use browser/client features
vi.mock("@/components/student/order-confirmation-cleanup", () => ({
  OrderConfirmationCleanup: () => null,
}));
vi.mock("@/components/student/order-tracker-view", () => ({
  OrderTrackerView: () => null,
}));

import OrderDetailPage from "@/app/(student)/orders/[orderId]/page";

describe("OrderDetailPage Error & Not Found Handling", () => {
  const validOrderId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-1",
      role: "student",
      is_active: true,
    });
  });

  it("throws an error when Supabase query returns an error, logging only code and message", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST204",
        message: "Could not find the column in schema cache",
        details: "Sensitive internal database detail",
        hint: null,
      },
    });

    await expect(
      OrderDetailPage({ params: Promise.resolve({ orderId: validOrderId }) })
    ).rejects.toThrow("We couldn't load this order. Try again.");

    expect(consoleSpy).toHaveBeenCalledWith("[OrderDetailPage] Failed to fetch order:", {
      code: "PGRST204",
      message: "Could not find the column in schema cache",
    });

    // Ensure sensitive keys like details/hint are NOT logged
    const loggedArg = consoleSpy.mock.calls[0]?.[1];
    expect(loggedArg).not.toHaveProperty("details");
    expect(loggedArg).not.toHaveProperty("hint");

    // notFound() must NOT be called for a database/query error
    expect(mockNotFound).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("calls notFound() when query succeeds with no error but order is not found", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    await expect(
      OrderDetailPage({ params: Promise.resolve({ orderId: validOrderId }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() when query returns PGRST116 (0 rows / genuinely missing order)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST116",
        message: "The result contains 0 rows",
      },
    });

    await expect(
      OrderDetailPage({ params: Promise.resolve({ orderId: validOrderId }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() when orderId is not a valid UUID", async () => {
    await expect(
      OrderDetailPage({ params: Promise.resolve({ orderId: "invalid-uuid-123" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
