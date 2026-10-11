"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, QrCode, Boxes, LogOut, Store, AlertTriangle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { signOutAction } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

interface StaffNavProps {
  canteenName: string | null;
  canteenId: string | null;
}

export function StaffNav({ canteenName, canteenId }: StaffNavProps) {
  const pathname = usePathname();

  const navItems = [
    { label: "Kitchen Board", href: "/staff", icon: LayoutGrid, exact: true },
    { label: "Pickup Scanner", href: "/staff/pickup", icon: QrCode },
    { label: "Inventory", href: "/staff/inventory", icon: Boxes },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand & Canteen Badge */}
        <div className="flex items-center gap-3">
          <Link href="/staff" className="flex items-center gap-2 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs group-hover:scale-105 transition-transform">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <span className="text-sm font-black tracking-tight leading-none text-foreground block">
                Kitchen Counter
              </span>
              <span className="text-[11px] text-muted-foreground font-medium">
                Staff Portal
              </span>
            </div>
          </Link>

          {canteenId ? (
            <div className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-semibold text-foreground border border-border">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{canteenName ?? "Active Canteen"}</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 border border-amber-500/30">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>No canteen assigned</span>
            </div>
          )}
        </div>

        {/* Center Nav Links */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  buttonVariants({
                    variant: isActive ? "default" : "ghost",
                    size: "sm",
                  }),
                  "h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 transition-all",
                  isActive
                    ? "shadow-2xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sign Out Action */}
        <div className="flex items-center gap-2">
          <form action={signOutAction}>
            <Button
              variant="outline"
              size="sm"
              type="submit"
              className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
