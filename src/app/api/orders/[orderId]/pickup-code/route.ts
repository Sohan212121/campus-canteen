import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  Vary: "Cookie",
};

const uuidSchema = z.string().uuid("Invalid order ID");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  // 1. Validate UUID format
  const parsed = uuidSchema.safeParse(orderId);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", error: "Invalid order ID" },
      { status: 400, headers: responseHeaders }
    );
  }

  // 2. Cookie-bound Supabase client (never service-role client)
  const supabase = await createClient();

  // 3. User session check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "Authentication required" },
      { status: 401, headers: responseHeaders }
    );
  }

  // 4. Role & active status check
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", error: "Account is inactive or profile not found" },
      { status: 403, headers: responseHeaders }
    );
  }

  if (profile.role !== "student") {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", error: "Only student accounts can retrieve pickup codes" },
      { status: 403, headers: responseHeaders }
    );
  }

  // 5. Call PostgreSQL RPC get_pickup_code
  const { data, error } = await supabase.rpc("get_pickup_code", {
    p_order_id: parsed.data,
  });

  if (error) {
    const rawMsg = error.message || "";
    const code = rawMsg.split(":")[0]?.trim() || "ERROR";
    const cleanMsg = rawMsg.replace(/^[A-Z_]+:\s*/, "") || "Failed to retrieve pickup code";

    let status = 500;
    if (code === "UNAUTHENTICATED") status = 401;
    else if (code === "FORBIDDEN" || code === "USER_INACTIVE") status = 403;
    else if (code === "NOT_FOUND") status = 404;

    return NextResponse.json(
      { ok: false, code, error: cleanMsg },
      { status, headers: responseHeaders }
    );
  }

  const res = data as { ok: boolean; error?: string; [key: string]: unknown };

  if (!res || !res.ok) {
    const errCode = res?.error || "FAILED";
    let friendlyError = "Unable to retrieve pickup code";
    if (errCode === "ORDER_NOT_READY") {
      friendlyError = "Order is not ready for pickup yet";
    } else if (errCode === "ALREADY_COLLECTED") {
      friendlyError = "This order has already been collected";
    } else if (errCode === "PICKUP_EXPIRED") {
      friendlyError = "Pickup window expired. This order was marked as uncollected.";
    } else if (errCode === "PICKUP_UNAVAILABLE") {
      friendlyError = "Pickup verification is temporarily unavailable";
    } else if (errCode === "NO_PICKUP_SECRET") {
      friendlyError = "Pickup secret is not configured";
    }

    return NextResponse.json(
      { ok: false, code: errCode, error: friendlyError },
      { status: 200, headers: responseHeaders }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        order_id: res.order_id as string,
        order_code: res.order_code as string,
        code: res.code as string,
        seconds_remaining: Number(res.seconds_remaining || 0),
        pin: res.pin as string,
        pickup_for_name: (res.pickup_for_name as string) || null,
      },
    },
    { status: 200, headers: responseHeaders }
  );
}
