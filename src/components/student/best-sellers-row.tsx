"use client";

import { TrendingUp } from "lucide-react";

import { BestSellerCard } from "@/components/student/best-seller-card";
import type { BestSellerItem } from "@/server/actions/best-sellers";
import type { MenuItemData } from "@/components/student/item-detail-sheet";

interface BestSellersRowProps {
  bestSellers: BestSellerItem[];
  onOpenDetail: (item: MenuItemData) => void;
}

export function BestSellersRow({
  bestSellers,
  onOpenDetail,
}: BestSellersRowProps) {
  if (!bestSellers || bestSellers.length < 3) {
    return null;
  }

  return (
    <section className="space-y-2.5" aria-labelledby="best-sellers-heading">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 id="best-sellers-heading" className="text-sm font-bold tracking-tight text-foreground">
              Best Sellers
            </h2>
          </div>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">
          Top {bestSellers.length} items
        </span>
      </div>

      {/* Horizontally scrollable container with self-contained overflow */}
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pt-0.5 scroll-smooth snap-x snap-mandatory">
        {bestSellers.map((bs) => (
          <div key={bs.item.id} className="w-[210px] sm:w-[230px] shrink-0 snap-start">
            <BestSellerCard
              bestSeller={bs}
              onOpenDetail={onOpenDetail}
              className="h-full"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
