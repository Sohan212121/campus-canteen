"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Camera,
  Keyboard,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ShoppingBag,
  User,
  ShieldAlert,
  Loader2,
  CreditCard,
  Banknote,
  KeyRound,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  previewCollectionAction,
  collectOrderAction,
  type CollectionCard,
} from "@/server/actions/staff";
import { formatPaise } from "@/lib/money";
import { LazyQrScanner } from "./lazy-qr-scanner";

export function PickupScannerView() {
  const [mode, setMode] = useState<"camera" | "manual" | "override">("camera");
  const [orderCodeInput, setOrderCodeInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [collectedWith, setCollectedWith] = useState<"CASH" | "UPI">("CASH");

  const [isVerifying, setIsVerifying] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [verifiedCard, setVerifiedCard] = useState<CollectionCard | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  // Late Handover Modal State (for orders expired within 6 hours)
  const [expiredOrderId, setExpiredOrderId] = useState<string | null>(null);
  const [expiredOrderCode, setExpiredOrderCode] = useState<string | null>(null);
  const [lateHandoverCard, setLateHandoverCard] = useState<CollectionCard | null>(null);
  const [showLateHandoverModal, setShowLateHandoverModal] = useState(false);
  const [lateHandoverReason, setLateHandoverReason] = useState("");
  const [isSubmittingLateHandover, setIsSubmittingLateHandover] = useState(false);

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

  const handlePreview = async (orderRef: string, code?: string, pin?: string) => {
    setErrorMessage(null);
    setErrorCode(null);
    setErrorStatus(null);
    setExpiredOrderId(null);
    setExpiredOrderCode(null);
    setIsVerifying(true);
    try {
      const res = await previewCollectionAction({
        orderRef,
        code,
        pin,
      });

      if (!res.success || !res.data) {
        const err = res.error || "Verification failed";
        setErrorCode(res.code || null);
        setErrorStatus(res.status || null);
        setErrorMessage(err);
        toast.error(err);
        setVerifiedCard(null);
        if (res.code === "PICKUP_EXPIRED") {
          setExpiredOrderId(res.order_id || null);
          setExpiredOrderCode(res.order_code || null);
          setLateHandoverCard(res.data || null);
        } else {
          setLateHandoverCard(null);
        }
        if (code && res.code === "AMBER_REQUIRES_BOTH") {
          setLastScannedCode(code);
          setOrderCodeInput(orderRef);
          setCodeInput(code);
        }
      } else {
        setVerifiedCard(res.data);
        setErrorCode(null);
        setErrorStatus(null);
        setExpiredOrderId(null);
        setExpiredOrderCode(null);
        setLateHandoverCard(null);
        if (code) setLastScannedCode(code);
        toast.success(`Order #${res.data.order_code} verified!`);
      }
    } catch {
      setErrorMessage("Network error verifying pickup");
      toast.error("Network error verifying pickup");
      setPaused(false);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleScan = (detectedCodes: { rawValue: string }[]) => {
    if (paused || isVerifying || verifiedCard) return;
    if (detectedCodes.length > 0 && detectedCodes[0].rawValue) {
      setPaused(true);
      const val = detectedCodes[0].rawValue.trim();

      // QR format: CC1:<order_id>:<code>
      if (val.startsWith("CC1:")) {
        const parts = val.split(":");
        if (parts.length >= 3) {
          const orderId = parts[1];
          const code = parts[2];
          handlePreview(orderId, code);
          return;
        }
      }

      setErrorMessage("Invalid QR code format. Please scan a valid Campus Canteen pickup QR.");
      toast.error("Invalid QR format");
      setPaused(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderCodeInput.trim()) {
      toast.error("Please enter an order code (e.g. CN10001)");
      return;
    }
    handlePreview(orderCodeInput.trim(), codeInput.trim() || undefined, pinInput.trim() || undefined);
  };

  const handleCollect = async () => {
    if (!verifiedCard || isCollecting) return;

    // Amber orders check: must have PIN
    if (verifiedCard.is_amber && (!pinInput.trim() || pinInput.trim().length !== 4)) {
      toast.error("Amber orders require a valid 4-digit student PIN");
      return;
    }

    setIsCollecting(true);
    try {
      const isManual = mode === "override";
      const isPinOnly = !lastScannedCode && Boolean(pinInput.trim());

      const res = await collectOrderAction({
        orderId: verifiedCard.order_id,
        code: lastScannedCode || undefined,
        collectedWith,
        method: isManual ? "MANUAL" : isPinOnly ? "PIN" : "SCAN",
        pin: pinInput.trim() || undefined,
        reason: isManual ? manualReason.trim() : undefined,
      });

      if (res.success && res.data) {
        toast.success(
          `Order #${res.data.order_code} collected! Payment confirmed via ${collectedWith}.`
        );
        resetState();
      } else {
        const err = res.error || "Collection failed";
        setErrorMessage(err);
        setErrorCode(res.code || null);
        setErrorStatus(res.status || (res.code === "ALREADY_COLLECTED" ? "COLLECTED" : null));
        toast.error(err);
        if (res.code === "ALREADY_COLLECTED" || res.code === "ORDER_NOT_READY") {
          setVerifiedCard(null);
        }
      }
    } catch {
      toast.error("Network error during collection");
    } finally {
      setIsCollecting(false);
    }
  };

  const resetState = () => {
    setVerifiedCard(null);
    setErrorMessage(null);
    setErrorCode(null);
    setErrorStatus(null);
    setExpiredOrderId(null);
    setExpiredOrderCode(null);
    setShowLateHandoverModal(false);
    setLateHandoverReason("");
    setLateHandoverCard(null);
    setOrderCodeInput("");
    setCodeInput("");
    setPinInput("");
    setManualReason("");
    setLastScannedCode("");
    setPaused(false);
  };

  return (
    <div ref={containerRef} className="max-w-2xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pickup Verification</h1>
          <p className="text-sm text-muted-foreground">
            Scan dynamic student QR code or verify counter PIN to release orders.
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
            className={`flex min-h-[44px] items-center gap-2 px-3 text-xs font-bold rounded-lg transition-colors ${
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
            className={`flex min-h-[44px] items-center gap-2 px-3 text-xs font-bold rounded-lg transition-colors ${
              mode === "manual"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Keyboard className="h-4 w-4" />
            Code / PIN
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("override");
              resetState();
            }}
            className={`flex min-h-[44px] items-center gap-2 px-3 text-xs font-bold rounded-lg transition-colors ${
              mode === "override"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-4 w-4" />
            Manual
          </button>
        </div>
      </div>

      {/* Verified Scan Card */}
      {verifiedCard ? (
        <Card
          className={`shadow-md animate-in fade-in zoom-in-95 duration-200 ${
            verifiedCard.is_amber
              ? "border-amber-500/60 bg-amber-500/5"
              : "border-emerald-500/40 bg-emerald-500/5"
          }`}
        >
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {verifiedCard.is_amber ? (
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                )}
                <div>
                  <CardTitle className="text-xl">
                    Order #{verifiedCard.order_code}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <User className="h-3 w-3 text-muted-foreground" />
                      {verifiedCard.first_name}
                    </span>
                    {verifiedCard.college_id_last4 && (
                      <span className="font-mono bg-muted/60 px-1.5 py-0.5 rounded text-[11px]">
                        ID: ••••{verifiedCard.college_id_last4}
                      </span>
                    )}
                    {verifiedCard.pickup_for_name && (
                      <span className="font-medium text-primary">
                        Pickup by: {verifiedCard.pickup_for_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Badge
                className={
                  verifiedCard.is_amber
                    ? "bg-amber-600 text-white font-bold"
                    : "bg-emerald-600 text-white font-bold"
                }
              >
                {verifiedCard.is_amber ? "AMBER VERIFICATION" : "READY FOR COLLECTION"}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-4">
            {verifiedCard.is_amber && (
              <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  High-Value or Bulk Order Security Check
                </p>
                <p>
                  Orders over 5 items or ₹500 require the student&apos;s 4-digit PIN in addition to the rotating code.
                </p>
                <div className="pt-2 max-w-xs">
                  <label className="text-[11px] font-semibold text-foreground block mb-1">
                    Student 4-digit PIN:
                  </label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                    className="font-mono text-center tracking-widest text-lg h-10 bg-background"
                  />
                </div>
              </div>
            )}

            {mode === "override" && (
              <div className="p-3 rounded-xl border border-border bg-muted/40 text-xs space-y-2">
                <label className="font-bold block text-foreground">
                  Manual Collection Reason (Min 5 characters):
                </label>
                <Input
                  placeholder="e.g. Student phone battery depleted, student ID verified"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  className="bg-background text-xs"
                />
              </div>
            )}

            {/* Items list */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Order Items ({verifiedCard.items.length})
              </h4>
              <div className="rounded-xl border border-border/40 divide-y divide-border/30 bg-background/50 overflow-hidden text-sm">
                {verifiedCard.items.map((item, index) => (
                  <div
                    key={`${index}-${item.name}`}
                    className="flex items-center justify-between p-2.5"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Qty: {item.quantity} &times; {formatPaise(item.unit_price_paise)}
                      </p>
                    </div>
                    <span className="font-bold text-foreground">
                      {formatPaise(item.unit_price_paise * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment & Amount bar */}
            <div className="p-3 rounded-xl bg-card border border-border/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Total Bill Amount</p>
                <p className="text-2xl font-black tracking-tight text-foreground">
                  {formatPaise(verifiedCard.total_paise)}
                </p>
              </div>

              {/* Payment Method Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-muted-foreground">Received as:</span>
                <div className="inline-flex rounded-lg border bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => setCollectedWith("CASH")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                      collectedWith === "CASH"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Banknote className="h-3.5 w-3.5" />
                    CASH
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollectedWith("UPI")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                      collectedWith === "UPI"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    UPI
                  </button>
                </div>
              </div>
            </div>

            {/* Handover Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <Button
                size="lg"
                onClick={handleCollect}
                disabled={isCollecting}
                className="flex-1 min-h-[48px] rounded-xl text-sm font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              >
                {isCollecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirming Payment & Handover...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="h-5 w-5" />
                    Received {collectedWith} & Hand Over Order
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={resetState}
                disabled={isCollecting}
                className="gap-2 rounded-xl"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Error Banner */}
          {errorMessage && (() => {
            const isStopStatus =
              errorStatus === "COLLECTED" ||
              errorStatus === "CANCELLED" ||
              errorStatus === "REJECTED" ||
              errorStatus === "NO_SHOW" ||
              errorCode === "ALREADY_COLLECTED" ||
              errorCode === "PICKUP_EXPIRED";

            const isNotReadyStatus =
              !isStopStatus &&
              (errorCode === "ORDER_NOT_READY" ||
                errorStatus === "PLACED" ||
                errorStatus === "ACCEPTED" ||
                errorStatus === "PREPARING");

            let bannerTitle = "Verification Failed";
            if (errorStatus === "COLLECTED" || errorCode === "ALREADY_COLLECTED") {
              bannerTitle = "Already Collected";
            } else if (errorStatus === "CANCELLED") {
              bannerTitle = "Order Cancelled";
            } else if (errorStatus === "REJECTED") {
              bannerTitle = "Order Rejected";
            } else if (errorStatus === "NO_SHOW" || errorCode === "PICKUP_EXPIRED") {
              bannerTitle = "Hold Window Expired (No-Show)";
            } else if (isNotReadyStatus) {
              bannerTitle = "Order Not Ready";
            } else if (errorCode === "PIN_LOCKED") {
              bannerTitle = "PIN Locked";
            } else if (errorCode === "AMBER_REQUIRES_BOTH") {
              bannerTitle = "PIN Required (Amber Order)";
            } else if (errorCode === "RATE_LIMITED_STAFF" || errorCode === "RATE_LIMITED_ORDER") {
              bannerTitle = "Rate Limit Reached";
            } else if (errorCode === "MANUAL_LIMIT") {
              bannerTitle = "Manual Limit Reached";
            } else if (errorCode === "MANUAL_REASON_REQUIRED") {
              bannerTitle = "Reason Required";
            } else if (errorCode === "NO_PICKUP_SECRET") {
              bannerTitle = "Security Error";
            } else if (errorCode === "INVALID_CODE" || errorCode === "WRONG_PIN") {
              bannerTitle = "Invalid Credentials";
            }

            return (
              <div
                className={`p-4 rounded-xl border flex items-start justify-between gap-3 animate-in fade-in ${
                  isNotReadyStatus
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {isStopStatus ? (
                    <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
                  ) : isNotReadyStatus ? (
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
                  )}
                  <div className="text-sm">
                    <p className="font-semibold">{bannerTitle}</p>
                    <p
                      className={`text-xs mt-0.5 ${
                        isNotReadyStatus
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-destructive/90 font-medium"
                      }`}
                    >
                      {errorMessage}
                    </p>
                    {errorCode === "AMBER_REQUIRES_BOTH" && mode === "camera" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMode("manual")}
                        className="mt-2 text-xs font-bold bg-background text-foreground hover:bg-muted"
                      >
                        Enter Student PIN
                      </Button>
                    )}
                    {errorCode === "PICKUP_EXPIRED" && expiredOrderId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowLateHandoverModal(true)}
                        className="mt-2 text-xs font-bold border-destructive/40 bg-background text-destructive hover:bg-destructive/10"
                      >
                        Manual Late Handover (Within 6h)
                      </Button>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetState}
                  className={`min-h-[40px] px-3 text-xs font-bold ${
                    isNotReadyStatus
                      ? "border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
                      : "text-destructive hover:bg-destructive/10"
                  }`}
                >
                  Try Again
                </Button>
              </div>
            );
          })()}

          {/* Camera Scanner View */}
          {mode === "camera" && (
            <Card className="overflow-hidden border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Camera QR Scanner</span>
                  {paused && (
                    <Badge variant="outline" className="text-amber-500 border-amber-500">
                      Processing...
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="aspect-square max-w-sm mx-auto overflow-hidden rounded-2xl bg-black border relative">
                  <LazyQrScanner
                    onScan={handleScan}
                    onError={(err) => {
                      const msg = err instanceof Error ? err.message : "Camera error";
                      setErrorMessage(msg);
                      setMode("manual");
                      toast.error("Camera access failed. Switched to code/PIN entry.");
                    }}
                    paused={paused}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Center the student&apos;s dynamic pickup QR code inside the viewfinder.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Manual Code or PIN Entry */}
          {mode === "manual" && (
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Enter Order Code & Code/PIN</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualSubmit} className="space-y-4 max-w-sm mx-auto">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Order Reference:
                    </label>
                    <Input
                      placeholder="e.g. CN10001"
                      value={orderCodeInput}
                      onChange={(e) => setOrderCodeInput(e.target.value.toUpperCase())}
                      className="font-mono text-center text-base uppercase"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      6-Digit Rotating Code:
                    </label>
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
                      className="font-mono text-center tracking-widest text-lg"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />
                      4-Digit Student PIN (Fallback or Amber):
                    </label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="••••"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                      className="font-mono text-center tracking-widest text-lg"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={isVerifying}
                    className="w-full min-h-[44px] rounded-xl font-bold gap-2"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify Order"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Manual Override Mode */}
          {mode === "override" && (
            <Card className="border shadow-sm border-amber-500/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  Manual Collection Override
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualSubmit} className="space-y-4 max-w-sm mx-auto">
                  <p className="text-xs text-muted-foreground">
                    Use when a student cannot present their phone or QR code. A reason is required and will be logged in the campus audit log.
                  </p>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Order Reference (CNxxxxx):
                    </label>
                    <Input
                      placeholder="CN10001"
                      value={orderCodeInput}
                      onChange={(e) => setOrderCodeInput(e.target.value.toUpperCase())}
                      className="font-mono text-center text-base uppercase"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isVerifying}
                    className="w-full min-h-[44px] rounded-xl font-bold gap-2"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Checking Order...
                      </>
                    ) : (
                      "Load Order For Manual Release"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Manual Late Handover Modal (Permitted within 6 hours of hold window expiry) */}
      {showLateHandoverModal && expiredOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in">
          <Card className="w-full max-w-md border shadow-lg bg-card text-card-foreground">
            <CardHeader className="pb-3 border-b border-border/40">
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                Manual Late Handover {expiredOrderCode ? `#${expiredOrderCode}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                This order expired after the canteen hold window. Late handovers are permitted within 6 hours of expiry if the student arrived late at the counter. A reason (minimum 5 characters) is required and will be logged in the campus audit log.
              </p>
              {lateHandoverCard && (
                <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                  <div className="flex items-center justify-between font-semibold text-foreground">
                    <span>{lateHandoverCard.first_name} (ID: ••••{lateHandoverCard.college_id_last4})</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      ₹{(lateHandoverCard.total_paise / 100).toFixed(2)}
                    </span>
                  </div>
                  {lateHandoverCard.pickup_for_name && (
                    <p className="text-muted-foreground text-[11px]">
                      Pickup for: <span className="text-foreground font-medium">{lateHandoverCard.pickup_for_name}</span>
                    </p>
                  )}
                  <div className="divide-y divide-border/40 text-[11px] pt-1 max-h-28 overflow-y-auto">
                    {lateHandoverCard.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between py-1 text-muted-foreground">
                        <span>{it.quantity}x {it.name}</span>
                        <span>₹{((it.unit_price_paise * it.quantity) / 100).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="font-bold text-foreground">
                  Reason for Late Handover (Min 5 chars):
                </label>
                <Input
                  placeholder="e.g. Student arrived late, verified student ID"
                  value={lateHandoverReason}
                  onChange={(e) => setLateHandoverReason(e.target.value)}
                  className="bg-background text-xs"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="font-bold text-foreground">Payment Received As:</span>
                <div className="inline-flex rounded-lg border bg-muted p-0.5">
                  <button
                    type="button"
                    onClick={() => setCollectedWith("CASH")}
                    className={`px-3 py-1 text-xs font-bold rounded-md ${
                      collectedWith === "CASH" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    CASH
                  </button>
                  <button
                    type="button"
                    onClick={() => setCollectedWith("UPI")}
                    className={`px-3 py-1 text-xs font-bold rounded-md ${
                      collectedWith === "UPI" ? "bg-background shadow-xs text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    UPI
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSubmittingLateHandover}
                  onClick={() => setShowLateHandoverModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={isSubmittingLateHandover || lateHandoverReason.trim().length < 5}
                  onClick={async () => {
                    setIsSubmittingLateHandover(true);
                    try {
                      const res = await collectOrderAction({
                        orderId: expiredOrderId,
                        method: "MANUAL",
                        reason: lateHandoverReason.trim(),
                        collectedWith,
                      });
                      if (res.success && res.data) {
                        toast.success(`Late handover confirmed for Order #${res.data.order_code}!`);
                        resetState();
                      } else {
                        toast.error(res.error || "Late handover failed");
                      }
                    } catch {
                      toast.error("Network error during late handover");
                    } finally {
                      setIsSubmittingLateHandover(false);
                    }
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  {isSubmittingLateHandover ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Handing Over...
                    </>
                  ) : (
                    "Confirm Late Handover"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
