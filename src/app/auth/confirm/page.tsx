import Link from "next/link";
import { ShieldCheck, AlertCircle } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyConfirmTokenAction } from "@/server/actions/auth";

interface ConfirmPageProps {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    next?: string;
  }>;
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = await searchParams;
  const token_hash = params.token_hash;
  const type = params.type;
  const next = params.next || (type === "invite" || type === "recovery" ? "/set-password" : "/");

  const isInvalid = !token_hash || !type;

  let title = "Confirm your request";
  let description = "Click below to complete email verification.";

  if (type === "invite") {
    title = "Accept staff invitation";
    description =
      "Welcome to Campus Canteen! Click below to accept your invitation and configure your account password.";
  } else if (type === "recovery") {
    title = "Password reset verification";
    description =
      "Click below to securely proceed and choose a new password for your account.";
  } else if (type === "signup") {
    title = "Confirm campus registration";
    description =
      "Click below to verify your campus email address and activate your account.";
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {isInvalid ? (
              <AlertCircle className="h-6 w-6 text-destructive" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {isInvalid ? "Invalid verification link" : title}
          </CardTitle>
          <CardDescription>
            {isInvalid
              ? "This verification link is incomplete or missing necessary tokens. Please request a new link."
              : description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isInvalid ? (
            <div className="space-y-4">
              <Link href="/login" className={buttonVariants({ className: "w-full" })}>
                Return to sign in
              </Link>
            </div>
          ) : (
            <form action={verifyConfirmTokenAction} className="space-y-4">
              <input type="hidden" name="token_hash" value={token_hash} />
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="next" value={next} />

              <Button type="submit" className="w-full">
                Continue
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Protected against automated link scanners. Click Continue to proceed.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
