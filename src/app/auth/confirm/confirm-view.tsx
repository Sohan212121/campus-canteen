"use client";

import { useState, useTransition, useSyncExternalStore } from "react";
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

interface HashSession {
  accessToken: string;
  refreshToken: string;
  type?: string;
}

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHashSnapshot(): HashSession | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash || hash.length <= 1) return null;
  try {
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type") || undefined;

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken, type };
    }
  } catch {
    return null;
  }
  return null;
}

function getServerSnapshot(): HashSession | null {
  return null;
}

interface ConfirmViewProps {
  initialTokenHash?: string;
  initialCode?: string;
  initialType?: string;
  initialNext?: string;
}

export function ConfirmView({
  initialTokenHash,
  initialCode,
  initialType,
  initialNext,
}: ConfirmViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hashError, setHashError] = useState<string | null>(null);

  // Synchronously subscribe to browser hash fragment without cascading renders
  const hashData = useSyncExternalStore(
    subscribeHash,
    getHashSnapshot,
    getServerSnapshot
  );

  const effectiveType = initialType || hashData?.type;
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

  // Link has viable parameters if token_hash, code, or hash-fragment session exists
  const hasTokenHash = Boolean(initialTokenHash && isTypeValid);
  const hasCode = Boolean(initialCode);
  const hasHashTokens = Boolean(hashData?.accessToken && hashData?.refreshToken);

  const isInvalid = !hasTokenHash && !hasCode && !hasHashTokens;

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
    if (!hashData) return;

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: hashData.accessToken,
          refresh_token: hashData.refreshToken,
        });

        if (sessionError) {
          setHashError("Your verification link has expired or has already been used. Please request a new link.");
          return;
        }

        // If recovery or invite, bind the server-side password-reset-allowed cookie
        if (effectiveType === "recovery" || effectiveType === "invite" || safeNext === "/set-password") {
          const authRes = await authorizeRecoverySessionAction();
          if (!authRes.success) {
            setHashError("Unable to authorize password reset. Please request a new link.");
            return;
          }
        }

        // Clear hash fragments from browser URL history for token hygiene
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }

        router.replace(safeNext);
      } catch {
        setHashError("Failed to complete verification. Please try again or request a new link.");
      }
    });
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {isInvalid || hashError ? (
              <AlertCircle className="h-6 w-6 text-destructive" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {isInvalid || hashError ? "Invalid verification link" : title}
          </CardTitle>
          <CardDescription>
            {hashError ? (
              hashError
            ) : isInvalid ? (
              "This verification link is incomplete or missing necessary tokens. Please request a new link."
            ) : (
              description
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isInvalid || hashError ? (
            <div className="space-y-3">
              <Link
                href="/forgot-password"
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
