"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loginAction, type AuthActionState } from "@/server/actions/auth";
import { SIGNUP_EMAIL_PLACEHOLDER } from "@/lib/constants";

const initialState: AuthActionState = {};

/** Inner form component that uses useSearchParams (requires Suspense). */
function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const urlErrorMessage =
    !state.error && errorParam === "account_deactivated"
      ? "Your account is not active yet. If you were just invited, an administrator needs to activate it."
      : !state.error && errorParam === "auth_code_error"
      ? "The confirmation link was invalid or has expired. Please sign in or request a new confirmation email."
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
          id="login-error"
          className="mb-4 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
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
          {state.fieldErrors?.email && (
            <p className="text-xs text-destructive">{state.fieldErrors.email[0]}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          {state.fieldErrors?.password && (
            <p className="text-xs text-destructive">{state.fieldErrors.password[0]}</p>
          )}
        </div>

        <Button
          id="login-submit"
          type="submit"
          className="w-full"
          size="lg"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing In…
            </>
          ) : (
            "Sign In"
          )}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Sign Up
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto relative flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden shadow-xs bg-[#FFFDF5] dark:bg-[#1E202B] p-1 border border-black/5 dark:border-white/10">
          <Image
            src="/brand/logo.png"
            alt="C@mpBite"
            width={48}
            height={48}
            className="w-full h-full object-contain"
            priority
          />
        </div>
        <CardTitle className="text-xl font-bold">Welcome Back</CardTitle>
        <CardDescription className="text-sm">
          Sign in to C<span className="text-red-600 dark:text-red-500 font-bold">@</span>mpBite
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
