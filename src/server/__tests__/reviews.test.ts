import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const mockRequireRole = vi.fn();
vi.mock("@/server/auth", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import {
  submitReviewAction,
  deleteMyReviewAction,
  getItemReviewsAction,
  getReviewEligibilityAction,
} from "@/server/actions/reviews";

describe("Reviews Server Actions Validation & Error Mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      id: "student-uuid-1",
      role: "student",
      is_active: true,
    });
  });

  it("enforces student role on submitReviewAction", async () => {
    mockRpc.mockResolvedValue({ data: { id: "rev-1" }, error: null });

    await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 5,
      comment: "Great taste",
    });

    expect(mockRequireRole).toHaveBeenCalledWith(["student"]);
  });

  it("validates rating boundaries (rejects 0 and 6)", async () => {
    const resZero = await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 0,
    });
    expect(resZero.success).toBe(false);
    expect(resZero.code).toBe("INVALID_INPUT");

    const resSix = await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 6,
    });
    expect(resSix.success).toBe(false);
    expect(resSix.code).toBe("INVALID_INPUT");
  });

  it("rejects comments exceeding 500 characters", async () => {
    const longComment = "a".repeat(501);
    const res = await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 5,
      comment: longComment,
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_INPUT");
    expect(res.error).toContain("500");
  });

  it("maps NOT_ELIGIBLE error code cleanly to friendly user message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "NOT_ELIGIBLE: Verified purchase required" },
    });

    const res = await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 5,
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe("NOT_ELIGIBLE");
    expect(res.error).toBe("Only customers who collected this item can review it.");
  });

  it("maps RATE_LIMITED error code cleanly", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RATE_LIMITED: Maximum 10 reviews" },
    });

    const res = await submitReviewAction({
      menuItemId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      rating: 5,
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe("RATE_LIMITED");
    expect(res.error).toContain("10 reviews per 24 hours");
  });

  it("rejects non-uuid item id on deleteMyReviewAction", async () => {
    const res = await deleteMyReviewAction("invalid-id");
    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("rejects more than 50 items on eligibility query", async () => {
    const ids = Array.from({ length: 51 }, () => "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    const res = await getReviewEligibilityAction(ids);
    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_INPUT");
  });

  it("returns empty array for empty eligibility query without calling RPC", async () => {
    const res = await getReviewEligibilityAction([]);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects non-uuid item id on getItemReviewsAction", async () => {
    const res = await getItemReviewsAction("invalid-id");
    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_INPUT");
  });
});

describe("Static Privacy Invariant Verification", () => {
  it("ensures student-facing reviews action never selects user_id or email", () => {
    const studentActionPath = path.resolve(
      __dirname,
      "../../server/actions/reviews.ts"
    );
    const content = fs.readFileSync(studentActionPath, "utf-8");

    // Student reviews type must not expose user_id or email
    expect(content).not.toContain("user_id:");
    expect(content).not.toContain("email:");
    expect(content).not.toContain("college_id:");
  });

  it("ensures student item reviews section component never references email or user_id", () => {
    const componentPath = path.resolve(
      __dirname,
      "../../components/student/item-reviews-section.tsx"
    );
    const content = fs.readFileSync(componentPath, "utf-8");

    expect(content).not.toContain("rev.email");
    expect(content).not.toContain("rev.user_id");
    expect(content).not.toContain("rev.college_id");
  });
});
