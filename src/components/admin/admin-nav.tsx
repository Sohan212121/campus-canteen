"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBag,
  Users,
  Settings,
  LogOut,
  ShieldCheck,
  Menu as MenuIcon,
  X,
  MessageSquare,
  Globe,
  Receipt,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/server/actions/auth";

const navItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Reconciliation", href: "/admin/reconciliation", icon: Receipt },
  { label: "Strikes", href: "/admin/strikes", icon: AlertTriangle },
  { label: "Reports", href: "/admin/reports", icon: FileText },
  { label: "Menu", href: "/admin/menu", icon: UtensilsCrossed },
  { label: "Orders", href: "/admin/orders", icon: ShoppingBag },
  { label: "Reviews", href: "/admin/reviews", icon: MessageSquare },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Domains", href: "/admin/domains", icon: Globe },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

export function AdminNav({ adminName }: { adminName?: string | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="font-brand text-lg sm:text-xl tracking-wide leading-none text-[#611c08] dark:text-[#f5efe4]">
                C@MPBITE
              </span>
              <span className="block text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                Admin Console
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-[44px] items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-2xs font-bold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold leading-tight">
              {adminName || "Administrator"}
            </span>
            <span className="text-[10px] text-muted-foreground">Admin Access</span>
          </div>

          <form action={signOutAction} className="hidden sm:block">
            <Button
              variant="outline"
              size="sm"
              type="submit"
              className="min-h-[44px] h-10 px-3.5 gap-2 text-xs sm:text-sm font-semibold rounded-xl"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </form>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-b bg-background px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex min-h-[44px] items-center gap-2.5 px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-2xs font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}

          <div className="pt-2 border-t mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              {adminName || "Administrator"}
            </span>
            <form action={signOutAction}>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                className="min-h-[44px] h-10 px-3.5 gap-2 text-xs font-semibold rounded-xl"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
