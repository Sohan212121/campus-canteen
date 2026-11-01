"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  UtensilsCrossed,
  ShoppingCart,
  Receipt,
  User,
} from "lucide-react";

import { useCartStore } from "@/lib/cart-store";
import { useNavigationTransition } from "@/components/navigation/navigation-transition-provider";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isCart?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Menu", href: "/menu", icon: UtensilsCrossed },
  { label: "Cart", href: "/cart", icon: ShoppingCart, isCart: true },
  { label: "Orders", href: "/orders", icon: Receipt },
  { label: "Profile", href: "/profile", icon: User },
];

export function StudentBottomNav() {
  const pathname = usePathname();
  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const hasHydrated = useCartStore((s) => s.hasHydrated);
  const { startTransition } = useNavigationTransition();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#efe3cb]/95 dark:bg-[#12100e]/95 backdrop-blur-xl border-t border-[#decdb0] dark:border-[#2d2621] shadow-[0_-4px_20px_rgba(29,23,19,0.06)] dark:shadow-[0_-6px_24px_rgba(0,0,0,0.7)]"
      aria-label="Student primary navigation"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={() => {
                if (!isActive) {
                  startTransition(item.href, item.label);
                }
              }}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center min-h-[50px] min-w-[50px] py-0.5 rounded-xl transition-colors",
                isActive
                  ? "text-[#1d1713] dark:text-amber-400 font-bold"
                  : "text-[#635549] dark:text-stone-400 hover:text-[#1d1713] dark:hover:text-white active:scale-95"
              )}
            >
              <div className="relative">
                {isActive ? (
                  <div className="w-8 h-8 rounded-full bg-[#181615] flex items-center justify-center text-[#fe7543] shadow-sm">
                    <Icon className="h-4 w-4 stroke-[2.25]" />
                  </div>
                ) : (
                  <div className="w-8 h-8 flex items-center justify-center">
                    <Icon className="h-5 w-5 stroke-[1.75]" />
                  </div>
                )}

                {/* Cart Badge - rendered only after hydration to avoid hydration mismatch */}
                {item.isCart && hasHydrated && totalItemCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#fe7543] dark:bg-amber-500 text-[#181615] dark:text-stone-950 ring-2 ring-[#efe3cb] dark:ring-[#12100e] px-1 text-[10px] font-bold shadow-xs animate-in zoom-in-75 duration-150"
                    aria-label={`${totalItemCount} items in cart`}
                  >
                    {totalItemCount > 99 ? "99+" : totalItemCount}
                  </span>
                )}
              </div>

              <span className="text-[10px] sm:text-[11px] font-headline uppercase tracking-wider leading-tight mt-0.5">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
