"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, KeyRound } from "lucide-react";

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
  setPasswordAction,
  type AuthActionState,
} from "@/server/actions/auth";

const initialState: AuthActionState = {};

export default function SetPasswordPage() {
  const [state, formAction, isPending] = useActionState(
    setPasswordAction,
    initialState
  );

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Set new password
          </CardTitle>
          <CardDescription>
            Choose a secure password for your account (minimum 8 characters).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.error && (
            <div
              id="set-password-error"
              className="mb-4 rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive"
            >
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                New password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                disabled={isPending}
              />
              {state.fieldErrors?.password && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.password[0]}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm password
              </label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                disabled={isPending}
              />
              {state.fieldErrors?.confirmPassword && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.confirmPassword[0]}
                </p>
              )}
            </div>

            <Button
              id="set-password-submit"
              type="submit"
              className="w-full"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...
                </>
              ) : (
                "Save password"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel and return to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
