"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Search, UtensilsCrossed, CheckCircle, Ban, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatPaise } from "@/lib/money";
import { setItemAvailabilityAction } from "@/server/actions/staff";

export interface StaffInventoryItem {
  id: string;
  name: string;
  description: string | null;
  price_paise: number;
  is_veg: boolean;
  is_available: boolean;
  stock: number | null;
  prep_minutes: number;
  category_name: string | null;
}

interface InventoryViewProps {
  initialItems: StaffInventoryItem[];
}

export function InventoryView({ initialItems }: InventoryViewProps) {
  const [items, setItems] = useState<StaffInventoryItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const categories = [
    "ALL",
    ...Array.from(
      new Set(items.map((item) => item.category_name || "General"))
    ),
  ];

  const filteredItems = items.filter((item) => {
    const itemCat = item.category_name || "General";
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description &&
        item.description.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory =
      selectedCategory === "ALL" || itemCat === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleToggle = async (itemId: string, currentStatus: boolean) => {
    const targetItem = items.find((i) => i.id === itemId);
    if (!targetItem) return;

    const nextStatus = !currentStatus;
    setUpdatingId(itemId);

    // Optimistic update
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, is_available: nextStatus } : i))
    );

    try {
      const res = await setItemAvailabilityAction(itemId, nextStatus);
      if (!res.success) {
        // Rollback
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId ? { ...i, is_available: currentStatus } : i
          )
        );
        toast.error(res.error || "Failed to update item availability");
      } else {
        toast.success(
          `${targetItem.name} marked as ${nextStatus ? "Available" : "Sold Out"}`
        );
      }
    } catch {
      // Rollback
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, is_available: currentStatus } : i
        )
      );
      toast.error("Network error updating item status");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu Availability</h1>
          <p className="text-sm text-muted-foreground">
            Instantly mark items as Sold Out / 86&apos;d during kitchen rushes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {items.filter((i) => i.is_available).length} Available
          </span>
          <span>&bull;</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            {items.filter((i) => !i.is_available).length} Sold Out
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items by name..."
            aria-label="Search items by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 text-sm rounded-xl"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[44px] px-3.5 text-xs font-semibold rounded-xl whitespace-nowrap transition-colors border ${
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Item List */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed">
          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="font-semibold text-base">No items found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query or category filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const isPending = updatingId === item.id;
            const categoryName = item.category_name || "General";
            return (
              <Card
                key={item.id}
                className={`transition-all border ${
                  item.is_available
                    ? "border-border/60 bg-card"
                    : "border-rose-500/30 bg-rose-500/5 opacity-80"
                }`}
              >
                <CardContent className="p-4 flex flex-col justify-between h-full space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base line-clamp-1">
                        {item.name}
                      </h3>
                      <Badge variant="outline" className="text-xs shrink-0 font-medium">
                        <Layers className="h-3 w-3 mr-1" />
                        {categoryName}
                      </Badge>
                    </div>

                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="font-bold font-mono text-primary text-sm">
                        {formatPaise(item.price_paise)}
                      </span>
                      {item.stock !== null && (
                        <span className="text-xs text-muted-foreground">
                          Stock: <span className="font-semibold">{item.stock}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Toggle Button */}
                  <div className="pt-2 border-t border-border/40">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleToggle(item.id, item.is_available)}
                      className={`w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-2xs ${
                        item.is_available
                          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 border border-emerald-500/30"
                          : "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400 border border-rose-500/30"
                      } ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {item.is_available ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          <span>Available (Tap to 86/Sold Out)</span>
                        </>
                      ) : (
                        <>
                          <Ban className="h-4 w-4" />
                          <span>Sold Out (Tap to Re-enable)</span>
                        </>
                      )}
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
