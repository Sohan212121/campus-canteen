"use client";

import { useState, lazy, Suspense } from "react";
import Link from "next/link";
import { RefreshCw, Gamepad2, ArrowLeft } from "lucide-react";
import { OfflineGameErrorBoundary } from "@/components/offline/offline-game-boundary";

const LazyOfflineGame = lazy(() =>
  import("@/components/offline/offline-game-canvas").then((mod) => ({ default: mod.OfflineGameCanvas }))
);

/**
 * Static Offline Fallback Page
 *
 * Served when the browser directly navigates or reloads while disconnected.
 * Contains zero student components and zero cart stores to maintain role isolation.
 */
export default function OfflinePage() {
  const [showGame, setShowGame] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center bg-background text-foreground selection:bg-[#F59E0B] selection:text-black">
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl flex flex-col items-center text-center">
        {!showGame ? (
          <>
            {/* Inline SVG Canteen Cloche Disconnected Illustration */}
            <div className="my-2 flex h-20 w-20 items-center justify-center rounded-3xl bg-muted text-primary p-3 shadow-inner">
              <svg
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full"
                aria-hidden="true"
              >
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
              <h1 className="text-xl font-extrabold tracking-tight">You&apos;re offline</h1>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px] mx-auto font-medium">
                Orders you have already placed are safe.
              </p>
              <p className="text-[11px] text-muted-foreground/80 leading-normal max-w-[270px] mx-auto">
                Please check your Wi-Fi or mobile data connection to view menus and track your orders.
              </p>
            </div>

            <div className="w-full space-y-2.5">
              <Link
                href="/"
                className="w-full min-h-[44px] h-11 rounded-xl bg-primary text-primary-foreground font-bold text-xs inline-flex items-center justify-center gap-2 shadow-xs hover:opacity-90 active:scale-98 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Connection</span>
              </Link>

              <button
                type="button"
                onClick={() => setShowGame(true)}
                className="w-full min-h-[44px] h-11 rounded-xl bg-muted text-foreground font-semibold text-xs inline-flex items-center justify-center gap-2 hover:bg-muted/80 active:scale-98 transition-all cursor-pointer"
              >
                <Gamepad2 className="w-4 h-4 text-primary" />
                <span>Play a game while you wait</span>
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground mt-4">
              C<span className="text-red-600 dark:text-red-500 font-bold">@</span>mpBite &bull; Smart Pre-Order System
            </p>
          </>
        ) : (
          <div className="w-full flex flex-col items-center">
            <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-border">
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
              <div className="w-12" />
            </div>

            <OfflineGameErrorBoundary onClose={() => setShowGame(false)}>
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
            </OfflineGameErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
