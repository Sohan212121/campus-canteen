"use client";

import { useState, useEffect, useTransition, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertCircle, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  verifyConfirmTokenAction,
  verifyConfirmCodeAction,
  authorizeRecoverySessionAction,
} from "@/server/actions/auth";
import {
  ALLOWED_OTP_TYPES,
  validateRedirectPath,
  type AllowedOtpType,
} from "@/lib/validation/auth-recovery";

export interface HashSession {
  accessToken: string;
  refreshToken: string;
  type?: string;
}

export interface HashError {
  code?: string;
  description?: string;
}

export interface ParsedHash {
  session: HashSession | null;
  error: HashError | null;
}

/**
 * Maps authentication error codes to user-friendly messages.
 * Never reflects raw or untrusted error text from the URL.
 */
export function mapAuthErrorMessage(errorCode?: string): string {
  const code = (errorCode || "").toLowerCase();
  if (
    code === "otp_expired" ||
    code === "access_denied" ||
    code.includes("expired") ||
    code.includes("denied")
  ) {
    return "Your verification link has expired or has already been used. Please request a new link.";
  }
  return "Your verification link is invalid or has expired. Please request a new link.";
}

/**
 * Pure parser for URL hash fragment.
 */
export function parseHashFragment(hash: string): ParsedHash | null {
  if (!hash || hash.length <= 1) return null;
  try {
    const raw = hash.startsWith("#") ? hash.substring(1) : hash;
    const params = new URLSearchParams(raw);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type") || undefined;
    const errorCode = params.get("error_code") || params.get("error") || undefined;
    const errorDesc = params.get("error_description") || undefined;

    const session =
      accessToken && refreshToken
        ? { accessToken, refreshToken, type }
        : null;

    const error =
      errorCode || errorDesc
        ? { code: errorCode, description: errorDesc }
        : null;

    if (session || error) {
      return { session, error };
    }
  } catch {
    return null;
  }
  return null;
}

let currentSnapshot: ParsedHash | null = null;
let lastSeenHash = "";
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function subscribeHash(callback: () => void) {
  listeners.add(callback);
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", onHashChange);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("hashchange", onHashChange);
    }
  };
}

function onHashChange() {
  updateSnapshotFromLocation();
  notifyListeners();
}

function updateSnapshotFromLocation(): ParsedHash | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (hash === lastSeenHash) {
    return currentSnapshot;
  }
  lastSeenHash = hash;

  if (!hash || hash.length <= 1) {
    // If the URL fragment was sanitized via replaceState, keep the captured snapshot in memory
    return currentSnapshot;
  }

  const parsed = parseHashFragment(hash);
  if (parsed) {
    currentSnapshot = parsed;
  }
  return currentSnapshot;
}

export function getHashSnapshot(): ParsedHash | null {
  return updateSnapshotFromLocation();
}

export function getServerSnapshot(): ParsedHash | null {
  return null;
}

/**
 * Reset memory cache between tests.
 */
export function _resetHashStoreForTesting() {
  currentSnapshot = null;
  lastSeenHash = "";
  listeners.clear();
}

const emptySubscribe = () => () => {};

export function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export interface ConfirmViewProps {
  initialTokenHash?: string;
  initialCode?: string;
  initialType?: string;
  initialNext?: string;
  initialError?: string;
  initialErrorDescription?: string;
}

export function ConfirmView({
  initialTokenHash,
  initialCode,
  initialType,
  initialNext,
  initialError,
  initialErrorDescription,
}: ConfirmViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useIsMounted();

  // Synchronously subscribe to browser hash fragment with stable reference caching
  const hashData = useSyncExternalStore(
    subscribeHash,
    getHashSnapshot,
    getServerSnapshot
  );

  // Clear hash fragment from address bar on mount for token hygiene while preserving in memory
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, []);

  const effectiveType = initialType || hashData?.session?.type;
  const isTypeValid =
    !effectiveType ||
    ALLOWED_OTP_TYPES.includes(effectiveType as AllowedOtpType);

  const defaultNext =
    effectiveType === "invite" || effectiveType === "recovery"
      ? "/set-password"
      : effectiveType === "email_change"
      ? "/profile"
      : "/";

  const safeNext = validateRedirectPath(initialNext, defaultNext);

  // Determine error from query parameters or hash fragment
  const rawErrorCode = initialError || hashData?.error?.code;
  const hasUrlError = Boolean(initialError || initialErrorDescription || hashData?.error);
  const friendlyUrlError = hasUrlError
    ? mapAuthErrorMessage(rawErrorCode)
    : null;

  const activeError = actionError || friendlyUrlError;

  // Link has viable parameters if token_hash, code, or hash-fragment session exists
  const hasTokenHash = Boolean(initialTokenHash && isTypeValid);
  const hasCode = Boolean(initialCode);
  const hasHashTokens = Boolean(
    hashData?.session?.accessToken && hashData?.session?.refreshToken
  );

  const hasValidToken = hasTokenHash || hasCode || hasHashTokens;
  const hasActiveError = Boolean(activeError);

  // Neutral state: show "Verifying link..." while client has not mounted and no server tokens exist
  const isVerifying = !mounted && !hasValidToken && !hasActiveError;

  // Invalid state: client mounted, no tokens, and no specific active error
  const isInvalid = mounted && !hasValidToken && !hasActiveError;

  const isErrorOrInvalid = isInvalid || hasActiveError;

  let title = "Confirm your request";
  let description = "Click below to complete email verification.";

  if (effectiveType === "invite") {
    title = "Accept staff invitation";
    description =
      "Welcome to CampBite! Click below to accept your invitation and configure your account password.";
  } else if (effectiveType === "recovery") {
    title = "Password reset verification";
    description =
      "Click below to securely proceed and choose a new password for your account.";
  } else if (effectiveType === "signup" || effectiveType === "email") {
    title = "Confirm campus registration";
    description =
      "Click below to verify your campus email address and activate your account.";
  } else if (effectiveType === "magiclink") {
    title = "Sign in to CampBite";
    description = "Click below to securely sign in to your CampBite account.";
  } else if (effectiveType === "email_change") {
    title = "Confirm email update";
    description =
      "Click below to confirm updating your campus email address.";
  }

  // Handle client-side hash verification on click
  const handleHashContinue = () => {
    const session = hashData?.session;
    if (!session) return;

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
        });

        if (sessionError) {
          setActionError(
            "Your verification link has expired or has already been used. Please request a new link."
          );
          return;
        }

        // If recovery or invite, bind the server-side password-reset-allowed cookie
        if (
          effectiveType === "recovery" ||
          effectiveType === "invite" ||
          safeNext === "/set-password"
        ) {
          const authRes = await authorizeRecoverySessionAction();
          if (!authRes.success) {
            try {
              await supabase.auth.signOut({ scope: "local" });
            } catch {
              // safe fallback
            }
            setActionError(
              "Unable to authorize password reset. Please request a new link."
            );
            return;
          }
          _resetHashStoreForTesting();
          router.replace("/set-password");
          return;
        }

        _resetHashStoreForTesting();
        router.replace(safeNext);
      } catch {
        setActionError(
          "Failed to complete verification. Please try again or request a new link."
        );
      }
    });
  };

  // Neutral loading card while client mounts for hash fragment detection
  if (isVerifying) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Verifying link...
            </CardTitle>
            <CardDescription>
              Please wait while we verify your request.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {isErrorOrInvalid ? (
              <AlertCircle className="h-6 w-6 text-destructive" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {isErrorOrInvalid ? "Invalid verification link" : title}
          </CardTitle>
          <CardDescription>
            {activeError ? (
              activeError
            ) : isInvalid ? (
              "This verification link is incomplete or missing necessary tokens. Please request a new link."
            ) : (
              description
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isErrorOrInvalid ? (
            <div className="space-y-3">
              <Link
                href="/forgot-password?from=link"
                className={buttonVariants({ className: "w-full" })}
              >
                Request a new link
              </Link>
              <div className="text-center">
                <Link
                  href="/login"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Return to sign in
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Token Hash Flow (Scanner-safe POST form) */}
              {hasTokenHash && (
                <form action={verifyConfirmTokenAction} className="space-y-4">
                  <input type="hidden" name="token_hash" value={initialTokenHash} />
                  <input type="hidden" name="type" value={effectiveType || ""} />
                  <input type="hidden" name="next" value={safeNext} />

                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              )}

              {/* PKCE Code Flow (Scanner-safe POST form) */}
              {!hasTokenHash && hasCode && (
                <form action={verifyConfirmCodeAction} className="space-y-4">
                  <input type="hidden" name="code" value={initialCode} />
                  <input type="hidden" name="type" value={effectiveType || ""} />
                  <input type="hidden" name="next" value={safeNext} />

                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              )}

              {/* Implicit Hash Fragment Flow (Client execution on click) */}
              {!hasTokenHash && !hasCode && hasHashTokens && (
                <div className="space-y-4">
                  <Button
                    type="button"
                    onClick={handleHashContinue}
                    disabled={isPending}
                    className="w-full"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Continue"
                    )}
                  </Button>
                </div>
              )}

              <p className="text-center text-xs text-muted-foreground">
                Protected against automated link scanners. Click Continue to proceed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
