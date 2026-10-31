import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { logSupabaseError, isMissingColumnError } from "@/lib/supabase-error";
import { getBestSellersAction, type BestSellerItem } from "@/server/actions/best-sellers";
import { formatIstTime, getStatusBadgeConfig } from "@/lib/order-status";
import type { MenuItemData } from "@/components/student/item-detail-sheet";
import { StudentHomeView, type CategoryData } from "@/components/student/student-home-view";
import { StudentGreetingHeader } from "@/components/student/student-greeting-header";
import { cn } from "@/lib/utils";

export default async function StudentHomePage() {
  const [profile, canteenId] = await Promise.all([
    requireRole(["student"]),
    getActiveCanteenId(),
  ]);

  const supabase = await createReadOnlyClient();
  let categories: CategoryData[] = [];
  let menuItems: MenuItemData[] = [];
  let bestSellers: BestSellerItem[] = [];
  let latestActiveOrder: {
    id: string;
    order_code: string;
    status: string;
    estimated_ready_at: string;
    pickup_window_end: string;
  } | null = null;

  // Fetch student's latest active order and canteen data in parallel
  const [activeOrderRes, categoriesRes, itemsRes, bestSellersRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_code, status, estimated_ready_at, pickup_window_end")
      .eq("user_id", profile.id)
      .in("status", ["PLACED", "ACCEPTED", "PREPARING", "READY"])
      .order("placed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    canteenId
      ? supabase
          .from("categories")
          .select("id, name, display_order, is_active")
          .eq("canteen_id", canteenId)
          .eq("is_active", true)
          .order("display_order", { ascending: true })
      : Promise.resolve({ data: null, error: null }),

    canteenId
      ? supabase
          .from("menu_items")
          .select(
            "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients"
          )
          .eq("canteen_id", canteenId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: null, error: null }),

    getBestSellersAction().catch((err) => {
      console.error("Failed to load best sellers on home page:", err);
      return { success: true, data: [] };
    }),
  ]);

  if (activeOrderRes.data) {
    latestActiveOrder = activeOrderRes.data;
  }

  if (categoriesRes.data) {
    categories = categoriesRes.data as CategoryData[];
  } else if (categoriesRes.error) {
    logSupabaseError("StudentHomePage:categories", categoriesRes.error);
  }

  if (itemsRes.data) {
    menuItems = itemsRes.data as MenuItemData[];
  } else if (itemsRes.error) {
    logSupabaseError("StudentHomePage:menu_items", itemsRes.error);

    if (isMissingColumnError(itemsRes.error) && canteenId) {
      // Fallback for missing nutrition/ingredients columns
      const fallbackRes = await supabase
        .from("menu_items")
        .select(
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count"
        )
        .eq("canteen_id", canteenId)
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (fallbackRes.data) {
        menuItems = fallbackRes.data.map((row: Record<string, unknown>) => ({
          ...row,
          calories_kcal: null,
          ingredients: [],
        })) as MenuItemData[];
      }
    }
  }

  if (bestSellersRes.success && bestSellersRes.data) {
    bestSellers = bestSellersRes.data;
  }

  // Compute current hour in Indian Standard Time (UTC+5:30) for contextual student greeting
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + 330) % 1440;
  const istHour = Math.floor(istMinutes / 60);

  return (
    <div className="space-y-6">
      {/* Welcome Greeting Header with Live Kitchen Status & Dynamic Time Greeting */}
      <StudentGreetingHeader fullName={profile.full_name} initialHour={istHour} />

      {/* Active Order In-Flight Banner */}
      {latestActiveOrder && (
        <section className="overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Active Order
            </span>
            <Badge
              variant={getStatusBadgeConfig(latestActiveOrder.status).variant}
              className={cn("text-[10px]", getStatusBadgeConfig(latestActiveOrder.status).className)}
            >
              {getStatusBadgeConfig(latestActiveOrder.status).label}
            </Badge>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-mono text-base font-bold text-foreground">
                #{latestActiveOrder.order_code}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Expected ready at {formatIstTime(latestActiveOrder.estimated_ready_at)}
              </p>
            </div>
            <Link
              href={`/orders/${latestActiveOrder.id}`}
              className={buttonVariants({
                size: "sm",
                className: "min-h-[44px] h-11 px-3.5 rounded-xl text-xs font-bold gap-1.5 inline-flex items-center",
              })}
            >
              <span>View Token</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}

      {/* Interactive Zomato-Style Home View (Auto-Transitioning Hero + Veg Toggle + Search + Meal Filters + Items) */}
      <StudentHomeView
        categories={categories}
        initialItems={menuItems}
        bestSellers={bestSellers}
      />

      {/* Footer Info */}
      <footer className="pt-2 text-center text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Campus Canteen &bull; Smart Pre-Order System</p>
      </footer>
    </div>
  );
}
