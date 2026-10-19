import { describe, it, expect, vi, beforeEach } from "vitest";
import { type NextRequest } from "next/server";

const { mockGetUser, mockFrom, mockRpc } = vi.hoisted(() => {
  return {
    mockGetUser: vi.fn(),
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

import { GET } from "@/app/api/orders/[orderId]/pickup-code/route";

function createMockRequest(): NextRequest {
  return {
    method: "GET",
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("GET /api/orders/[orderId]/pickup-code", () => {
  const validOrderId = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { role: "student", is_active: true },
        error: null,
      }),
    });
  });

  it("returns 400 for invalid UUID", async () => {
    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: "not-a-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      error: "Invalid order ID",
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 401 when user is unauthenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 when user is not a student", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { role: "staff", is_active: true },
        error: null,
      }),
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
  });

  it("returns 403 when user profile is inactive", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { role: "student", is_active: false },
        error: null,
      }),
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
  });

  it("maps FORBIDDEN RPC error to status 403", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "FORBIDDEN: You can only view pickup codes for your own orders" },
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
    expect(json.error).toBe("You can only view pickup codes for your own orders");
  });

  it("maps NOT_FOUND RPC error to status 404", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "NOT_FOUND: Order not found" },
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("NOT_FOUND");
    expect(json.error).toBe("Order not found");
  });

  it("returns 200 with { ok: false, ... } when order is not ready (ORDER_NOT_READY)", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, error: "ORDER_NOT_READY" },
      error: null,
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      code: "ORDER_NOT_READY",
      error: "Order is not ready for pickup yet",
    });
  });

  it("returns 200 with friendly message when order is ALREADY_COLLECTED", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, error: "ALREADY_COLLECTED" },
      error: null,
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      code: "ALREADY_COLLECTED",
      error: "This order has already been collected",
    });
  });

  it("returns 200 with friendly message when order is PICKUP_EXPIRED", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, error: "PICKUP_EXPIRED" },
      error: null,
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      code: "PICKUP_EXPIRED",
      error: "Pickup window expired. This order was marked as uncollected.",
    });
  });

  it("returns 200 with rotating TOTP code, seconds remaining, and PIN on success", async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        order_id: validOrderId,
        order_code: "CN10001",
        code: "654321",
        seconds_remaining: 58,
        pin: "4321",
        pickup_for_name: "John Doe",
      },
      error: null,
    });

    const req = createMockRequest();
    const res = await GET(req, {
      params: Promise.resolve({ orderId: validOrderId }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Vary")).toBe("Cookie");

    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      data: {
        order_id: validOrderId,
        order_code: "CN10001",
        code: "654321",
        seconds_remaining: 58,
        pin: "4321",
        pickup_for_name: "John Doe",
      },
    });
  });
});
