"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Download, Share2, X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/lib/cart-store";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const STORAGE_KEY = "cc_pwa_install_dismissed_v1";

function subscribeStandalone(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => {
    mql.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", callback);
  };
}

function getStandaloneSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  const isDisplay = window.matchMedia("(display-mode: standalone)").matches;
  const isNav = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isDisplay || isNav;
}

function subscribeStorage(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getStorageDismissedSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getIosSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIosDevice = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|crios|fxios/.test(ua);
  return isIosDevice && isSafari;
}

export function StudentInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  const isStandalone = useSyncExternalStore(subscribeStandalone, getStandaloneSnapshot, () => false);
  const isStorageDismissed = useSyncExternalStore(subscribeStorage, getStorageDismissedSnapshot, () => true);
  const isIos = useSyncExternalStore(() => () => {}, getIosSnapshot, () => false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setSessionDismissed(true);
    setDeferredPrompt(null);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Gracefully ignore storage quota or private browsing errors
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        handleDismiss();
      }
    } catch {
      handleDismiss();
    }
  };

  const pathname = usePathname();
  const totalItemCount = useCartStore((s) => s.getTotalItemCount());
  const hasHydrated = useCartStore((s) => s.hasHydrated);

  // If student is on /menu with items in cart, CartShortcut renders at bottom-4.25rem.
  // Stack install prompt directly above it with transition to avoid overlap.
  const hasCartShortcut = hasHydrated && totalItemCount > 0 && pathname === "/menu";
  const bottomOffsetClass = hasCartShortcut
    ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom,0px))]"
    : "bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]";

  const isDismissed = isStorageDismissed || sessionDismissed;

  // Never render in standalone mode or once dismissed
  if (isStandalone || isDismissed) {
    return null;
  }

  // 1. Android / Chrome / Desktop beforeinstallprompt prompt
  if (deferredPrompt) {
    return (
      <div
        className={cn(
          "fixed left-3 right-3 z-30 mx-auto max-w-md animate-in slide-in-from-bottom-3 duration-200 transition-all",
          bottomOffsetClass
        )}
        role="region"
        aria-label="Install app prompt"
      >
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-card/95 p-3.5 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
              <Download className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <h3 className="text-xs font-bold leading-tight truncate">Install C@mpBite</h3>
              <p className="text-[11px] text-muted-foreground leading-tight line-clamp-1">
                Order fast and track tokens right from your home screen.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              size="sm"
              onClick={handleInstallClick}
              className="h-11 px-3.5 rounded-xl text-xs font-bold gap-1 shadow-xs"
            >
              <span>Install</span>
            </Button>
            <button
              type="button"
              onClick={handleDismiss}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. iOS Safari Add to Home Screen hint
  if (isIos) {
    return (
      <div
        className={cn(
          "fixed left-3 right-3 z-30 mx-auto max-w-md animate-in slide-in-from-bottom-3 duration-200 transition-all",
          bottomOffsetClass
        )}
        role="region"
        aria-label="Add to home screen hint"
      >
        <div className="rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-lg backdrop-blur-md space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Smartphone className="h-4 w-4" />
              </div>
              <h3 className="text-xs font-bold text-foreground">Install on iPhone / iPad</h3>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="flex h-11 w-11 -mr-2 -mt-2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss iOS install hint"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Tap the <span className="font-semibold text-foreground inline-flex items-center gap-0.5"><Share2 className="inline h-3 w-3" /> Share</span> icon in Safari, then tap <strong className="text-foreground">&ldquo;Add to Home Screen&rdquo;</strong> for 1-tap ordering.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
