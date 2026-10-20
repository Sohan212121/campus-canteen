import Link from "next/link";
import { UtensilsCrossed, ArrowRight, Sparkles, Clock, TrendingUp } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/server/auth";
import { getActiveCanteenId } from "@/server/canteen";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { logSupabaseError, isMissingColumnError } from "@/lib/supabase-error";
import { getBestSellersAction, type BestSellerItem } from "@/server/actions/best-sellers";
import { formatPaise } from "@/lib/money";
import { formatIstTime, getStatusBadgeConfig } from "@/lib/order-status";
import { formatBestSellerBadge, formatUnitsSoldBadge } from "@/lib/best-sellers";
import { VegIndicator } from "@/components/student/veg-indicator";
import { MenuItemImage } from "@/components/student/menu-item-image";
import type { MenuItemData } from "@/components/student/item-detail-sheet";
import { cn } from "@/lib/utils";

export default async function StudentHomePage() {
  const profile = await requireRole(["student"]);
  const canteenId = await getActiveCanteenId();

  const supabase = await createReadOnlyClient();
  let previewItems: MenuItemData[] = [];
  let bestSellers: BestSellerItem[] = [];
  let latestActiveOrder: {
    id: string;
    order_code: string;
    status: string;
    estimated_ready_at: string;
    pickup_window_end: string;
  } | null = null;

  // Fetch student's latest active order
  const { data: activeOrderData } = await supabase
    .from("orders")
    .select("id, order_code, status, estimated_ready_at, pickup_window_end")
    .eq("user_id", profile.id)
    .in("status", ["PLACED", "ACCEPTED", "PREPARING", "READY"])
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeOrderData) {
    latestActiveOrder = activeOrderData;
  }

  if (canteenId) {
    // 1. Fetch best sellers (wrapped in try/catch to degrade silently)
    try {
      const bestSellersRes = await getBestSellersAction();
      if (bestSellersRes.success && bestSellersRes.data && bestSellersRes.data.length >= 3) {
        bestSellers = bestSellersRes.data;
      }
    } catch (err) {
      console.error("Failed to load best sellers on home page:", err);
    }

    // 2. Fetch fallback preview items if best sellers not available
    if (bestSellers.length < 3) {
      const { data, error } = await supabase
        .from("menu_items")
        .select(
          "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count, calories_kcal, ingredients"
        )
        .eq("canteen_id", canteenId)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("name", { ascending: true })
        .limit(4);

      if (data) {
        previewItems = data as MenuItemData[];
      } else if (error) {
        logSupabaseError("StudentHomePage:previewItems", error);

        if (isMissingColumnError(error)) {
          // TODO: Remove fallback after migration 0018 is applied
          console.warn("[StudentHomePage] WARNING: migration 0018 not applied");
          const fallbackRes = await supabase
            .from("menu_items")
            .select(
              "id, canteen_id, category_id, name, description, price_paise, image_url, is_veg, is_available, stock, prep_minutes, is_active, rating_avg, rating_count"
            )
            .eq("canteen_id", canteenId)
            .eq("is_active", true)
            .eq("is_available", true)
            .order("name", { ascending: true })
            .limit(4);

          if (fallbackRes.data) {
            previewItems = fallbackRes.data.map((row: Record<string, unknown>) => ({
              ...row,
              calories_kcal: null,
              ingredients: [],
            })) as MenuItemData[];
          } else if (fallbackRes.error) {
            logSupabaseError("StudentHomePage:previewItems_fallback", fallbackRes.error);
          }
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          Campus Canteen
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Welcome, {profile.full_name ?? "Student"}!
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Pre-order fresh meals before your break and pick up without waiting.
        </p>
      </header>

      {/* Active Order In-Flight Banner (PRD Section 14) */}
      {latestActiveOrder && (
        <section className="overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Active Order
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

      {/* Prominent Order Now Hero Card */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-xs">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Skip the physical queue</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold">Ready to grab a bite?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Browse breakfast, meals, snacks, and beverages ready for quick counter collection.
            </p>
          </div>
          <Link
            href="/menu"
            className={buttonVariants({
              size: "lg",
              className: "w-full h-12 text-sm font-semibold rounded-xl gap-2 shadow-xs inline-flex items-center justify-center",
            })}
          >
            <UtensilsCrossed className="h-4 w-4" />
            <span>Order Now</span>
            <ArrowRight className="h-4 w-4 ml-auto" />
          </Link>
        </div>
      </section>

      {/* Best Sellers Section (Replaces Today's Specials when available) */}
      {bestSellers.length >= 3 ? (
        <section className="space-y-3" aria-labelledby="home-bestsellers-heading">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <h2 id="home-bestsellers-heading" className="text-base font-bold tracking-tight">
                Best Sellers
              </h2>
            </div>
            <Link
              href="/menu"
              className="text-xs font-semibold text-primary hover:underline flex min-h-[44px] items-center gap-1 px-1"
            >
              View Menu <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {bestSellers.slice(0, 4).map(({ item, rank, units_sold }) => (
              <Link
                key={item.id}
                href="/menu"
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-3 shadow-2xs transition-all hover:border-foreground/20 hover:shadow-xs"
              >
                <div className="space-y-2">
                  <div className="relative h-24 w-full overflow-hidden rounded-lg bg-muted">
                    <MenuItemImage
                      src={item.image_url}
                      alt={item.name}
                      aspect="4/3"
                      sizes="(max-width: 640px) 50vw, 200px"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      containerClassName="h-full w-full"
                    />
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-background/95 backdrop-blur-xs px-1.5 py-0.5 text-[9px] font-bold text-foreground shadow-2xs border border-border/60">
                      <TrendingUp className="h-2.5 w-2.5 text-amber-500" />
                      <span>{formatBestSellerBadge(rank)}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <VegIndicator isVeg={item.is_veg} />
                        {item.prep_minutes > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            ~{item.prep_minutes}m
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-medium text-muted-foreground">
                        {formatUnitsSoldBadge(units_sold)}
                      </span>
                    </div>
                    <h3 className="text-xs font-semibold leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                      {item.name}
                    </h3>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between pt-1">
                  <span className="text-xs font-bold text-foreground">
                    {formatPaise(item.price_paise)}
                  </span>
                  <span className="text-[10px] font-semibold text-primary">
                    Order &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : previewItems.length > 0 ? (
        <section className="space-y-3" aria-labelledby="home-specials-heading">
          <div className="flex items-center justify-between">
            <h2 id="home-specials-heading" className="text-base font-bold tracking-tight">Today&apos;s Specials</h2>
            <Link
              href="/menu"
              className="text-xs font-semibold text-primary hover:underline flex min-h-[44px] items-center gap-1 px-1"
            >
              View Menu <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {previewItems.map((item) => (
              <Link
                key={item.id}
                href="/menu"
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-3 shadow-2xs transition-all hover:border-foreground/20 hover:shadow-xs"
              >
                <div className="space-y-2">
                  <div className="relative h-24 w-full overflow-hidden rounded-lg bg-muted">
                    <MenuItemImage
                      src={item.image_url}
                      alt={item.name}
                      aspect="4/3"
                      sizes="(max-width: 640px) 50vw, 200px"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      containerClassName="h-full w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <VegIndicator isVeg={item.is_veg} />
                      {item.prep_minutes > 0 && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          ~{item.prep_minutes}m
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-semibold leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                      {item.name}
                    </h3>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between pt-1">
                  <span className="text-xs font-bold text-foreground">
                    {formatPaise(item.price_paise)}
                  </span>
                  <span className="text-[10px] font-semibold text-primary">
                    View &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Footer Info */}
      <footer className="pt-2 text-center text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Campus Canteen &bull; Smart Pre-Order System</p>
      </footer>
    </div>
  );
}
