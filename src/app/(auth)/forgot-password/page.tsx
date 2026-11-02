"use client";

import { Suspense, useActionState, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  forgotPasswordAction,
  type AuthActionState,
} from "@/server/actions/auth";
import { SIGNUP_EMAIL_PLACEHOLDER } from "@/lib/constants";

const initialState: AuthActionState = {};

function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    forgotPasswordAction,
    initialState
  );
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = () => {
    setCooldown(30);
  };

  const urlErrorMessage =
    errorParam === "link_expired"
      ? "Your reset or invite link has expired or has already been used. Please request a new link below."
      : errorParam === "invalid_link"
      ? "The link was invalid or incomplete. Please request a new link below."
      : null;

  return (
    <>
      {urlErrorMessage && (
        <div
          id="url-error"
          className="mb-4 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive"
        >
          {urlErrorMessage}
        </div>
      )}

      {state.error && (
        <div
          id="forgot-error"
          className="mb-4 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      {state.success && (
        <div
          id="forgot-success"
          className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm text-foreground"
        >
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>{state.message}</p>
        </div>
      )}

      <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder={SIGNUP_EMAIL_PLACEHOLDER}
            required
            autoComplete="email"
            disabled={isPending || cooldown > 0}
          />
          {state.fieldErrors?.email && (
            <p className="text-xs text-destructive">
              {state.fieldErrors.email[0]}
            </p>
          )}
        </div>

        <Button
          id="forgot-submit"
          type="submit"
          className="w-full"
          disabled={isPending || cooldown > 0}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending link...
            </>
          ) : cooldown > 0 ? (
            `Resend in ${cooldown}s`
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Link
          href="/login"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-3 w-3" />
          Back to sign in
        </Link>
      </div>
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 relative flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden shadow-sm">
            <Image
              src="/brand/logo.png"
              alt="C@mpBite"
              width={48}
              height={48}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Forgot password
          </CardTitle>
          <CardDescription>
            Enter your email and we will send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={
              <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ForgotPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
