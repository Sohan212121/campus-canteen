"use client";

import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Camera,
  Keyboard,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ShoppingBag,
  User,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  verifyPickupAction,
  transitionOrderAction,
  type VerifiedPickupOrder,
} from "@/server/actions/staff";
import { formatPaise } from "@/lib/money";

import { LazyQrScanner } from "./lazy-qr-scanner";

const tokenSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Token must be exactly 6 digits");

export function PickupScannerView() {
  const [mode, setMode] = useState<"camera" | "manual">("camera");
  const [tokenInput, setTokenInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifiedOrder, setVerifiedOrder] = useState<VerifiedPickupOrder | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Stop camera tracks on unmount
  useEffect(() => {
    const node = containerRef.current;
    return () => {
      if (node) {
        const videos = node.querySelectorAll("video");
        videos.forEach((video) => {
          const stream = video.srcObject as MediaStream | null;
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }
        });
      }
    };
  }, []);

  const handleVerify = async (rawToken: string) => {
    setErrorMessage(null);
    const parsed = tokenSchema.safeParse(rawToken);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid token format";
      setErrorMessage(msg);
      toast.error(msg);
      setPaused(false);
      return;
    }

    setIsVerifying(true);
    try {
      const res = await verifyPickupAction(parsed.data);
      if (!res.success) {
        setErrorMessage(res.error || "Verification failed");
        toast.error(res.error || "Verification failed");
        setVerifiedOrder(null);
      } else if (res.data) {
        setVerifiedOrder(res.data);
        toast.success(`Order #${res.data.order_code} verified for pickup!`);
      }
    } catch {
      setErrorMessage("Network error during pickup verification");
      toast.error("Network error during pickup verification");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleScan = (detectedCodes: { rawValue: string }[]) => {
    if (paused || isVerifying || verifiedOrder) return;
    if (detectedCodes.length > 0 && detectedCodes[0].rawValue) {
      setPaused(true);
      const val = detectedCodes[0].rawValue.trim();
      handleVerify(val);
    }
  };

  const handleCameraError = (err: unknown) => {
    const errorStr =
      err instanceof Error ? err.message : "Camera access denied or unavailable";
    setCameraError(errorStr);
    setMode("manual");
    toast.error("Camera access failed. Switched to manual token entry.");
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    handleVerify(tokenInput.trim());
  };

  const handleCollect = async () => {
    if (!verifiedOrder) return;
    setIsCollecting(true);
    try {
      const res = await transitionOrderAction(
        verifiedOrder.order_id,
        "COLLECTED"
      );
      if (res.success) {
        toast.success(
          `Order #${verifiedOrder.order_code} collected successfully!`
        );
        resetState();
      } else {
        toast.error(res.error || "Failed to mark as collected");
      }
    } catch {
      toast.error("Network error marking collected");
    } finally {
      setIsCollecting(false);
    }
  };

  const resetState = () => {
    setVerifiedOrder(null);
    setErrorMessage(null);
    setTokenInput("");
    setPaused(false);
  };

  return (
    <div ref={containerRef} className="max-w-2xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pickup Verification</h1>
          <p className="text-sm text-muted-foreground">
            Scan student QR code or enter the 6-digit pickup token to release orders.
          </p>
        </div>

        {/* Mode Selector */}
        <div className="inline-flex rounded-lg border bg-muted p-1">
          <button
            type="button"
            onClick={() => {
              setMode("camera");
              resetState();
            }}
            className={`flex min-h-[44px] items-center gap-2 px-4 text-xs font-bold rounded-lg transition-colors ${
              mode === "camera"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Camera className="h-4 w-4" />
            Scanner
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("manual");
              resetState();
            }}
            className={`flex min-h-[44px] items-center gap-2 px-4 text-xs font-bold rounded-lg transition-colors ${
              mode === "manual"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Keyboard className="h-4 w-4" />
            Manual Entry
          </button>
        </div>
      </div>

      {/* Verified Order Card */}
      {verifiedOrder ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5 shadow-md animate-in fade-in zoom-in-95 duration-200">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                <div>
                  <CardTitle className="text-xl">
                    Order #{verifiedOrder.order_code}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <User className="h-3 w-3" />
                    Customer:{" "}
                    <span className="font-semibold text-foreground">
                      {verifiedOrder.student_name}
                    </span>
                  </p>
                </div>
              </div>
              <Badge className="bg-emerald-600 text-white font-bold">
                READY FOR COLLECTION
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Order Items ({verifiedOrder.items.length})
              </h4>
              <div className="divide-y divide-border/40 rounded-lg border bg-background/50 px-3">
                {verifiedOrder.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">
                        {item.quantity}x
                      </span>
                      <span>{item.name_snapshot}</span>
                    </div>
                    <span className="font-medium text-muted-foreground">
                      {formatPaise(item.unit_price_paise * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center py-2 px-3 rounded-lg bg-card border font-bold text-base">
              <span>Total Bill</span>
              <span className="text-primary font-mono text-lg">
                {formatPaise(verifiedOrder.total_paise)}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                size="lg"
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold shadow-sm"
                onClick={handleCollect}
                disabled={isCollecting}
              >
                {isCollecting ? (
                  "Marking Collected..."
                ) : (
                  <>
                    <ShoppingBag className="h-5 w-5" />
                    Hand Over & Mark Collected
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={resetState}
                disabled={isCollecting}
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Cancel / Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Error Message Banner */}
          {errorMessage && (
            <div className="p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive flex items-start justify-between gap-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Verification Failed</p>
                  <p className="text-xs text-destructive/90 mt-0.5">
                    {errorMessage}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={resetState}
                className="min-h-[44px] px-3.5 text-xs font-bold text-destructive hover:bg-destructive/10"
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Camera Scanner View */}
          {mode === "camera" && (
            <Card className="overflow-hidden border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Camera QR Scanner</span>
                  {paused && (
                    <Badge variant="outline" className="text-amber-500 border-amber-500">
                      Paused
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-square max-w-sm mx-auto overflow-hidden rounded-xl border bg-black/90">
                  <LazyQrScanner
                    onScan={handleScan}
                    onError={handleCameraError}
                    paused={paused || isVerifying}
                    formats={["qr_code"]}
                    styles={{
                      container: { width: "100%", height: "100%" },
                    }}
                  />
                  {isVerifying && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2">
                      <Sparkles className="h-8 w-8 text-primary animate-spin" />
                      <p className="text-sm font-semibold">Verifying token...</p>
                    </div>
                  )}
                </div>

                <div className="text-center space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Point camera at student&apos;s order pickup QR code.
                  </p>
                  {paused && !isVerifying && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPaused(false)}
                      className="gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Resume Camera
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Manual Entry View */}
          {mode === "manual" && (
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Enter 6-Digit Token</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label
                      htmlFor="pickup-token"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Pickup Token
                    </label>
                    <Input
                      id="pickup-token"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      autoFocus
                      placeholder="e.g. 748291"
                      value={tokenInput}
                      onChange={(e) =>
                        setTokenInput(e.target.value.replace(/\D/g, ""))
                      }
                      className="text-center font-mono text-2xl tracking-widest h-14"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 text-base font-semibold"
                    disabled={isVerifying || tokenInput.length !== 6}
                  >
                    {isVerifying ? "Verifying Token..." : "Verify Pickup Token"}
                  </Button>
                </form>

                {cameraError && (
                  <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>Camera unavailable: {cameraError}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
