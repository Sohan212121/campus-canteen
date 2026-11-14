"use client";

import React, { Component, ReactNode, ErrorInfo } from "react";
import { AlertCircle } from "lucide-react";

export interface OfflineGameErrorBoundaryProps {
  children?: ReactNode;
  onClose?: () => void;
}

export interface OfflineGameErrorBoundaryState {
  hasError: boolean;
}

export class OfflineGameErrorBoundary extends Component<
  OfflineGameErrorBoundaryProps,
  OfflineGameErrorBoundaryState
> {
  public state: OfflineGameErrorBoundaryState = {
    hasError: false,
  };

  public static getDerivedStateFromError(): OfflineGameErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[OfflineGameErrorBoundary] Caught game error:", error?.message, errorInfo);
    }
  }

  public handleClose = () => {
    this.setState({ hasError: false });
    this.props.onClose?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="w-full min-h-[160px] flex flex-col items-center justify-center p-4 text-center rounded-xl bg-card border border-border"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
            <AlertCircle className="w-5 h-5" />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px]">
            The game could not load. It needs a connection the first time, so try again when you are back online.
          </p>
          <button
            type="button"
            onClick={this.handleClose}
            className="mt-3 min-h-[36px] px-4 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 active:scale-95 transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
