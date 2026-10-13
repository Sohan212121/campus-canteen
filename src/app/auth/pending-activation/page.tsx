import { Clock, RefreshCw, LogOut } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signOutAction } from "@/server/actions/auth";

export default function PendingActivationPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
            <Clock className="h-7 w-7 text-amber-600" />
          </div>
          <div className="mb-2 flex justify-center">
            <Badge variant="outline" className="border-amber-500/30 text-amber-600">
              Pending Administrator Activation
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Account Not Active Yet
          </CardTitle>
          <CardDescription className="text-sm">
            Your account is not active yet. If you were just invited, an administrator needs to activate it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground">
            Staff and administrative accounts require a designated canteen assignment
            and manual activation by a campus administrator before kitchen queue
            access is enabled.
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href="/auth/pending-activation"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Check Status
            </a>

            <form action={signOutAction} className="w-full">
              <Button variant="secondary" type="submit" className="w-full">
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
