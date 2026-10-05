import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, QrCode, UtensilsCrossed } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between px-4 py-8 sm:py-16">
      <div className="w-full max-w-md mx-auto space-y-8 text-center">
        {/* Header / Brand */}
        <div className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <UtensilsCrossed className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Campus Canteen
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg leading-relaxed">
            Order before the break. Skip the queue. Pick up when you arrive.
          </p>
        </div>

        {/* Feature Highlights (Mobile-First Cards) */}
        <div className="grid gap-3 text-left">
          <Card className="border-border/60 shadow-xs">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-semibold">Pre-Order Early</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <CardDescription className="text-xs">
                Select meals and choose your break pickup window before class ends.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-xs">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <QrCode className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm font-semibold">Quick Token Pickup</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <CardDescription className="text-xs">
                Walk straight to the collection counter, show your pickup token, and grab your food.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Action Button */}
        <div className="pt-2">
          <Button size="lg" className="w-full font-medium shadow-sm">
            Browse Menu
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Campus Canteen &bull; Smart Pre-Order System
      </footer>
    </main>
  );
}
