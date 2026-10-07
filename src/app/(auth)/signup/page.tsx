"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UtensilsCrossed, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signupAction, type AuthActionState } from "@/server/actions/auth";

const initialState: AuthActionState = {};

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(signupAction, initialState);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <UtensilsCrossed className="h-5 w-5" />
        </div>
        <CardTitle className="text-xl font-bold">Create Account</CardTitle>
        <CardDescription className="text-sm">
          Join Campus Canteen to pre-order meals
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
              autoComplete="name"
            />
            {state.fieldErrors?.fullName && (
              <p className="text-xs text-destructive">{state.fieldErrors.fullName[0]}</p>
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
              placeholder="you@campus.edu"
              required
              autoComplete="email"
            />
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
              placeholder="••••••••"
              required
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
