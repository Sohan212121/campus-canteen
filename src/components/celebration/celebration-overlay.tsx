"use client";

import { useEffect, useRef, useCallback } from "react";
import { Clock, IndianRupee, ArrowRight, Utensils } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/money";
import { formatIstTime } from "@/lib/order-status";
import { useReducedMotion } from "@/lib/celebration";
import { AnimatedCheck } from "@/components/celebration/animated-check";
import { ConfettiBurst } from "@/components/celebration/confetti-burst";

export interface CelebrationOrderProps {
  order_code: string;
  total_paise: number;
  estimated_ready_at: string;
}

interface CelebrationOverlayProps {
  isOpen: boolean;
  order: CelebrationOrderProps;
  onClose: () => void;
  onBackToMenu: () => void;
  heading?: string;
  dismissOnBackdrop?: boolean;
  isNavigating?: boolean;
}

export function CelebrationOverlay({
  isOpen,
  order,
  onClose,
  onBackToMenu,
  heading = "Order placed!",
  dismissOnBackdrop = true,
  isNavigating = false,
}: CelebrationOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const secondaryButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const reducedMotion = useReducedMotion();

  // Safe haptic vibration on appear
  useEffect(() => {
    if (!isOpen || reducedMotion) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(30);
      } catch {
        // Ignore devices where vibration permission is denied
      }
    }
  }, [isOpen, reducedMotion]);

  // Scroll lock, focus trap, and body data attribute
  useEffect(() => {
    if (!isOpen) return;

    // 1. Save previously focused element to restore on close
    if (typeof document !== "undefined") {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      document.body.setAttribute("data-celebration-open", "true");
    }

    // 2. Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 3. Move focus to primary action button
    const focusTimer = setTimeout(() => {
      primaryButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      document.body.removeAttribute("data-celebration-open");
      // Restore focus
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // Keyboard navigation: Escape to close and Tab trapping
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const focusableElements = [primaryButtonRef.current, secondaryButtonRef.current].filter(
          Boolean
        ) as HTMLElement[];

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cc-celebration-title"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissOnBackdrop) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm cc-overlay-backdrop select-none"
    >
      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Order placed. Order code {order.order_code}. Total {formatPaise(order.total_paise)}.
      </div>

      {/* Centered 3D-feeling Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-3xl border border-border/80 bg-card p-6 shadow-2xl text-center text-card-foreground cc-card-3d max-h-[92vh] overflow-y-auto"
      >
        {/* Confetti particles */}
        <ConfettiBurst count={28} reducedMotion={reducedMotion} />

        {/* Animated Check with radial glow */}
        <div className="pt-2 pb-1">
          <AnimatedCheck size={72} reducedMotion={reducedMotion} />
        </div>

        {/* Sequence item 1: Header */}
        <div className="mt-4 space-y-1 cc-stagger-1">
          <h2
            id="cc-celebration-title"
            className="text-2xl font-black tracking-tight text-foreground"
          >
            {heading}
          </h2>
          <p className="text-xs text-muted-foreground font-medium">
            We&apos;re getting it ready
          </p>
        </div>

        {/* Sequence item 2: Order Code Badge */}
        <div className="mt-5 cc-stagger-2">
          <div className="inline-flex flex-col items-center justify-center rounded-2xl bg-muted/60 px-5 py-2.5 border border-border/80 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Order Code
            </span>
            <span className="font-mono text-3xl font-black tracking-widest text-foreground mt-0.5">
              #{order.order_code}
            </span>
          </div>
        </div>

        {/* Sequence item 3: Timings and Total */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs cc-stagger-3">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-left">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <Clock className="h-3 w-3 text-primary" />
              Est. Ready
            </span>
            <span className="block font-bold text-foreground text-sm mt-1">
              {formatIstTime(order.estimated_ready_at)}
            </span>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-left">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <IndianRupee className="h-3 w-3 text-primary" />
              Total Amount
            </span>
            <span className="block font-bold text-foreground text-sm mt-1">
              {formatPaise(order.total_paise)}
            </span>
          </div>
        </div>

        {/* Sequence item 4: Action Buttons */}
        <div className="mt-6 space-y-2.5 cc-stagger-4">
          <Button
            ref={primaryButtonRef}
            type="button"
            size="lg"
            disabled={isNavigating}
            onClick={onClose}
            className="w-full font-bold min-h-[48px] rounded-xl shadow-xs gap-1.5"
          >
            <span>{isNavigating ? "Opening..." : "Track order"}</span>
            <ArrowRight className="h-4 w-4" />
          </Button>

          <Button
            ref={secondaryButtonRef}
            type="button"
            variant="outline"
            size="lg"
            disabled={isNavigating}
            onClick={onBackToMenu}
            className="w-full font-semibold min-h-[48px] rounded-xl border-border/80 gap-1.5"
          >
            <Utensils className="h-4 w-4 text-muted-foreground" />
            <span>{isNavigating ? "Opening..." : "Back to menu"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
