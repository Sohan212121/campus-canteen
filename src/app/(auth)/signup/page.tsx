"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Loader2, MailCheck, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signupAction, resendConfirmationAction, type AuthActionState } from "@/server/actions/auth";
import { SIGNUP_EMAIL_PLACEHOLDER } from "@/lib/constants";

const initialState: AuthActionState = {};

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(signupAction, initialState);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  const handleResend = async () => {
    if (!state.email) return;
    setResendLoading(true);
    setResendStatus(null);
    try {
      const res = await resendConfirmationAction(state.email);
      setResendStatus(res.message);
    } catch {
      setResendStatus("Failed to request link. Please try again later.");
    } finally {
      setResendLoading(false);
    }
  };

  if (state.needsConfirmation) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MailCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl font-bold">Check Your Email</CardTitle>
          <CardDescription className="text-sm">
            We sent a verification link to your campus address
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <div className="rounded-lg bg-muted/50 p-3 text-sm font-medium text-foreground break-all">
            {state.email}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Please click the link inside your confirmation email to activate your account.
            Once verified, you can sign in to start pre-ordering meals.
          </p>

          {resendStatus && (
            <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              {resendStatus}
            </div>
          )}

          <div className="pt-2 flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResend}
              disabled={resendLoading}
              className="w-full"
            >
              {resendLoading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  Resend Confirmation Email
                </>
              )}
            </Button>
            <Link
              href="/login"
              className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 w-full"
            >
              Go to Sign In
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto relative flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden shadow-sm">
          <Image
            src="/brand/logo.png"
            alt="C@mpBite"
            width={48}
            height={48}
            className="w-full h-full object-cover"
            priority
          />
        </div>
        <CardTitle className="text-xl font-bold">Create Account</CardTitle>
        <CardDescription className="text-sm">
          Join C<span className="text-red-600 dark:text-red-500 font-bold">@</span>mpBite with your campus credentials
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.error && (
          <div
            id="signup-error"
            className="mb-4 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive"
          >
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="fullName" className="text-sm font-medium">
              Full Name
            </label>
            <Input
              id="fullName"
              name="fullName"
              type="text"
              placeholder="Jane Doe"
              required
              maxLength={80}
              autoComplete="name"
            />
            {state.fieldErrors?.fullName && (
              <p className="text-xs text-destructive">{state.fieldErrors.fullName[0]}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="collegeId" className="text-sm font-medium">
              College ID
            </label>
            <Input
              id="collegeId"
              name="collegeId"
              type="text"
              placeholder="e.g. CS2024001"
              required
              minLength={3}
              maxLength={30}
              autoComplete="username"
            />
            <p className="text-[11px] text-muted-foreground">
              Official student roll or registration number.
            </p>
            {state.fieldErrors?.collegeId && (
              <p className="text-xs text-destructive">{state.fieldErrors.collegeId[0]}</p>
            )}
          </div>

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
            />
            <p className="text-[11px] text-muted-foreground">
              Use the email address you want to sign in with.
            </p>
            {state.fieldErrors?.email && (
              <p className="text-xs text-destructive">{state.fieldErrors.email[0]}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
            {state.fieldErrors?.password && (
              <p className="text-xs text-destructive">{state.fieldErrors.password[0]}</p>
            )}
          </div>

          <Button
            id="signup-submit"
            type="submit"
            className="w-full"
            size="lg"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account…
              </>
            ) : (
              "Sign Up"
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
