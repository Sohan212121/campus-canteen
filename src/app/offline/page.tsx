import Link from "next/link";
import { WifiOff, RefreshCw } from "lucide-react";

/**
 * Static Offline Fallback Page
 *
 * ⚠️ Note: Since this application does not employ an aggressive service worker
 *    (preventing caching of authenticated sessions, orders, or user data),
 *    this page is served when directly navigated to or refreshed when a network
 *    failure is intercepted. It contains zero student-specific components or data.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-background text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border/80 bg-card p-8 shadow-xs">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <WifiOff className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight">You are offline</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Please check your campus Wi-Fi or mobile data connection to view menus,
            place orders, and track your pickup tokens.
          </p>
        </div>

        <div className="space-y-2.5 pt-2">
          <Link
            href="/"
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold text-xs inline-flex items-center justify-center gap-2 shadow-xs hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Connection</span>
          </Link>

          <p className="text-[11px] text-muted-foreground">
            C@mpBite &bull; Smart Pre-Order System
          </p>
        </div>
      </div>
    </div>
  );
}
