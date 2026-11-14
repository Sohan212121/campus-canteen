"use client";

import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import { WifiOff, RefreshCw, X, ArrowLeft, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import {
  ReachabilityController,
  ReachabilityStatus,
  isStudentRoute,
} from "@/lib/offline-reachability";

// Lazy-load game component only when user clicks "Play a game"
const LazyOfflineGame = lazy(() =>
  import("./offline-game-canvas").then((mod) => ({ default: mod.OfflineGameCanvas }))
);

export function OfflineIndicator() {
  const pathname = usePathname();
  const [controller] = useState(() => new ReachabilityController());

  const [status, setStatus] = useState<ReachabilityStatus>("online");
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [showGame, setShowGame] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const prevStatusRef = useRef<ReachabilityStatus>("online");

  const isStudent = isStudentRoute(pathname);
  const isDedicatedOfflinePage = pathname === "/offline";

  // Re-check handler
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      const ok = await controller.checkReachability(true);
      if (ok) {
        setIsDismissed(false);
        setShowGame(false);
      }
    } finally {
      setIsRetrying(false);
    }
  }, [controller]);

  // Subscribe to reachability controller & window events
  useEffect(() => {
    const unsubscribe = controller.subscribe((newStatus) => {
      // If returning to online from a confirmed outage, notify user with toast
      if (prevStatusRef.current === "offline_confirmed" && newStatus === "online") {
        toast.success("Back online", { id: "offline-status", duration: 3000 });
        setIsDismissed(false);
        setShowGame(false);
      }
      prevStatusRef.current = newStatus;
      setStatus(newStatus);
    });

    const onOnline = () => controller.handleOnlineEvent();
    const onOffline = () => controller.handleOfflineEvent();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        controller.handleVisibilityResume();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Initial check if navigator reports offline
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      controller.handleOfflineEvent();
    }

    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [controller]);

  // Handle escape key to dismiss modal
  useEffect(() => {
    if (status !== "offline_confirmed" || isDismissed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDismissed(true);
        setShowGame(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, isDismissed]);

  // Don't render on the dedicated static /offline page (page handles its own view)
  if (isDedicatedOfflinePage) {
    return null;
  }

  // If online or not yet confirmed offline (under double-probe grace period), render nothing
  if (status !== "offline_confirmed") {
    return null;
  }

  // =========================================================================
  // 1. NON-STUDENT ROUTES (Staff, Admin, Auth, Unlisted): Compact Top Banner
  // =========================================================================
  if (!isStudent) {
    return (
      <aside
        aria-label="Offline status"
        className="fixed top-0 left-0 right-0 z-[49] pointer-events-none flex justify-center pt-[max(0.5rem,env(safe-area-inset-top,0px))] px-3"
      >
        <div className="pointer-events-auto flex items-center justify-between gap-3 w-full max-w-md px-3.5 py-2 rounded-xl bg-[#D9531E] dark:bg-[#231A12] border border-[#B83E0F] dark:border-[#F59E0B]/30 text-white shadow-lg text-xs animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-4 h-4 text-white dark:text-[#FBBF24] shrink-0" />
            <span className="font-medium truncate text-white dark:text-[#F3F4F6]">
              You&apos;re offline. Actions will sync when connected.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="shrink-0 min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg bg-black/20 hover:bg-black/30 dark:bg-[#FBBF24] dark:hover:bg-[#F59E0B] dark:text-[#090A0F] font-semibold text-white transition-all active:scale-95 cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            aria-label="Retry connection"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>
        </div>
      </aside>
    );
  }

  // =========================================================================
  // 2. STUDENT ROUTE: Dismissed Outage Pill (Compact non-intrusive status)
  // =========================================================================
  if (isDismissed) {
    return (
      <aside
        aria-label="Offline notice"
        className="fixed top-0 left-0 right-0 z-[49] pointer-events-none flex justify-center pt-[max(0.5rem,env(safe-area-inset-top,0px))] px-3"
      >
        <div className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#181513]/90 dark:bg-[#121319]/95 text-white border border-white/15 shadow-md backdrop-blur-md text-xs animate-in fade-in duration-200">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <button
            type="button"
            onClick={() => setIsDismissed(false)}
            className="font-medium hover:underline cursor-pointer"
          >
            Offline mode &bull; View details
          </button>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center hover:text-amber-400 text-white/80 transition-colors"
            aria-label="Retry connection"
            title="Retry connection"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? "animate-spin" : ""}`} />
          </button>
        </div>
      </aside>
    );
  }

  // =========================================================================
  // 3. STUDENT ROUTE: Full-Screen Dismissible Offline Overlay (z-[49])
  // =========================================================================
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      aria-describedby="offline-desc"
      className="fixed inset-0 z-[49] flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-[#ded5c4] dark:border-[#2A2E3D] bg-[#f5efe4] dark:bg-[#121319] text-[#181513] dark:text-[#f8fafc] p-6 shadow-2xl flex flex-col items-center text-center">
        {/* Dismiss / Close Button (Never traps user) */}
        <button
          type="button"
          onClick={() => {
            setIsDismissed(true);
            setShowGame(false);
          }}
          className="absolute top-3 right-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
          aria-label="Close offline banner"
        >
          <X className="w-5 h-5" />
        </button>

        {!showGame ? (
          <>
            {/* Inline SVG Illustration (Canteen Cloche with Disconnected Signal) */}
            <div className="my-2 flex h-20 w-20 items-center justify-center rounded-3xl bg-[#ded5c4]/60 dark:bg-[#1A1C24] text-[#d9531e] dark:text-[#FBBF24] p-3 shadow-inner">
              <svg
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full"
                aria-hidden="true"
              >
                {/* Food Cloche / Plate Dome */}
                <path
                  d="M10 46h44c1.1 0 2 .9 2 2s-.9 2-2 2H10c-1.1 0-2-.9-2-2s.9-2 2-2z"
                  fill="currentColor"
                  fillOpacity="0.85"
                />
                <path
                  d="M14 44c1.5-12 10.5-20 18-20s16.5 8 18 20H14z"
                  fill="currentColor"
                  fillOpacity="0.3"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <circle cx="32" cy="20" r="3.5" fill="currentColor" />

                {/* Slashed Wi-Fi signal arcs */}
                <path
                  d="M24 12c4.4-3.5 11.6-3.5 16 0"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M27 16c2.8-2 7.2-2 10 0"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                {/* Diagonal disconnection slash */}
                <line
                  x1="16"
                  y1="10"
                  x2="48"
                  y2="50"
                  stroke="#DC2626"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="space-y-2 mt-2 mb-5">
              <h2 id="offline-title" className="text-xl font-extrabold tracking-tight">
                You&apos;re offline
              </h2>
              <p
                id="offline-desc"
                className="text-xs text-muted-foreground leading-relaxed max-w-[280px] mx-auto font-medium"
              >
                Orders you have already placed are safe.
              </p>
              <p className="text-[11px] text-muted-foreground/80 leading-normal max-w-[270px] mx-auto">
                Please check your Wi-Fi or data connection to view real-time menu availability and place new orders.
              </p>
            </div>

            <div className="w-full space-y-2.5">
              {/* Retry Button */}
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                className="w-full min-h-[44px] h-11 rounded-xl bg-[#d9531e] dark:bg-[#FBBF24] text-white dark:text-[#090A0F] font-bold text-xs inline-flex items-center justify-center gap-2 shadow-xs hover:opacity-90 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
                <span>{isRetrying ? "Checking connection..." : "Retry Connection"}</span>
              </button>

              {/* Play Game Button */}
              <button
                type="button"
                onClick={() => setShowGame(true)}
                className="w-full min-h-[44px] h-11 rounded-xl bg-[#ded5c4] dark:bg-[#1A1C24] text-[#181513] dark:text-[#f8fafc] font-semibold text-xs inline-flex items-center justify-center gap-2 hover:bg-[#ded5c4]/80 dark:hover:bg-[#1A1C24]/80 active:scale-98 transition-all cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4 text-[#d9531e] dark:text-[#FBBF24]" />
                <span>Play a game while you wait</span>
              </button>
            </div>
          </>
        ) : (
          /* Mini Game View */
          <div className="w-full flex flex-col items-center">
            <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-[#ded5c4] dark:border-[#2A2E3D]">
              <button
                type="button"
                onClick={() => setShowGame(false)}
                className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-semibold text-muted-foreground hover:text-foreground active:scale-95 transition-transform cursor-pointer"
                aria-label="Back to offline status"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <span className="text-xs font-bold tracking-tight">Burger Jump</span>
              <div className="w-12" /> {/* balance spacing */}
            </div>

            <Suspense
              fallback={
                <div className="w-full h-[180px] flex items-center justify-center bg-card rounded-xl text-xs text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  Loading mini game...
                </div>
              }
            >
              <LazyOfflineGame />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
