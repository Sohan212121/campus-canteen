"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { getStudentAvatarUrlAction } from "@/server/actions/profile";

export const AVATAR_URL_MAX_AGE_MS = 50 * 60 * 1000; // 50 minutes
export const BACKGROUND_REFRESH_THROTTLE_MS = 60 * 1000; // 60 seconds

export interface AvatarUrlManagerOptions {
  initialAvatarUrl: string | null;
  avatarLookupTimedOut?: boolean;
  fetchAvatarUrlAction?: () => Promise<{ success: boolean; avatarUrl?: string | null; error?: string }>;
  nowFn?: () => number;
}

export interface AvatarUrlState {
  avatarUrl: string | null;
  imgError: boolean;
  showAvatarImage: boolean;
}

export class AvatarUrlManager {
  private avatarUrl: string | null;
  private imgError: boolean;
  private state: AvatarUrlState;
  private issuedAt: number;
  private lastBackgroundRefresh: number = 0;
  private inFlightPromise: Promise<string | null> | null = null;
  private urlVersion: number = 0;
  private retriedUrls: Set<string> = new Set();
  private prevPropUrl: string | null;
  private hasAttemptedTimeoutRecovery: boolean = false;
  private readonly fetchAction: () => Promise<{ success: boolean; avatarUrl?: string | null; error?: string }>;
  private readonly nowFn: () => number;
  private listeners: Set<() => void> = new Set();
  private cleanupWindowListeners: (() => void) | null = null;

  constructor(options: AvatarUrlManagerOptions) {
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.fetchAction = options.fetchAvatarUrlAction ?? getStudentAvatarUrlAction;
    this.avatarUrl = options.initialAvatarUrl;
    this.prevPropUrl = options.initialAvatarUrl;
    this.imgError = false;
    this.issuedAt = options.initialAvatarUrl ? this.nowFn() : 0;
    this.state = {
      avatarUrl: this.avatarUrl,
      imgError: this.imgError,
      showAvatarImage: Boolean(this.avatarUrl && !this.imgError),
    };
  }

  public getState = (): AvatarUrlState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateState(avatarUrl: string | null, imgError: boolean) {
    if (this.state.avatarUrl === avatarUrl && this.state.imgError === imgError) {
      return;
    }
    this.avatarUrl = avatarUrl;
    this.imgError = imgError;
    this.state = {
      avatarUrl,
      imgError,
      showAvatarImage: Boolean(avatarUrl && !imgError),
    };
    this.notify();
  }

  public syncPropUrl(newPropUrl: string | null, timedOut: boolean = false) {
    if (timedOut) {
      // Lookup timed out on server: do NOT overwrite an existing valid avatar with null
      return;
    }

    // Authoritative update from server: reset timeout recovery flag
    this.hasAttemptedTimeoutRecovery = false;

    if (this.prevPropUrl !== newPropUrl) {
      this.prevPropUrl = newPropUrl;
      this.urlVersion += 1;
      this.issuedAt = newPropUrl ? this.nowFn() : 0;
      this.updateState(newPropUrl, false);
    }
  }

  public handleTimeoutRecovery = () => {
    // If we already have a valid avatar URL, no need to fetch
    if (this.avatarUrl) {
      return;
    }

    // Only ONE client refresh per timeout event
    if (this.hasAttemptedTimeoutRecovery) {
      return;
    }

    this.hasAttemptedTimeoutRecovery = true;
    void this.executeRefresh({ isError: false });
  };

  public setAvatarUrlDirectly = (newUrl: string | null) => {
    this.urlVersion += 1;
    this.issuedAt = newUrl ? this.nowFn() : 0;
    this.inFlightPromise = null;
    this.updateState(newUrl, false);
  };

  public executeRefresh = ({ isError = false }: { isError?: boolean } = {}): Promise<string | null> => {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    const requestVersion = ++this.urlVersion;

    const fetchPromise = (async () => {
      try {
        const res = await this.fetchAction();

        // If a newer URL was set directly or via prop sync while in flight, ignore response
        if (requestVersion !== this.urlVersion) {
          return null;
        }

        if (res.success) {
          const freshUrl = res.avatarUrl ?? null;
          // If this was an error retry, record the refreshed URL so that if it ALSO fails,
          // it won't loop (only once per URL, no loops)
          if (isError && freshUrl) {
            this.retriedUrls.add(freshUrl);
          }
          this.issuedAt = freshUrl ? this.nowFn() : 0;
          this.updateState(freshUrl, false);
          return freshUrl;
        } else {
          if (isError) {
            this.updateState(this.avatarUrl, true);
          }
          return null;
        }
      } catch {
        if (isError && requestVersion === this.urlVersion) {
          this.updateState(this.avatarUrl, true);
        }
        return null;
      } finally {
        this.inFlightPromise = null;
      }
    })();

    this.inFlightPromise = fetchPromise;
    return fetchPromise;
  };

  public handleBackgroundResume = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    if (!this.avatarUrl) {
      return;
    }

    const now = this.nowFn();

    // 1. Cheap local check: must be >= 50 minutes old
    const isStale = now - this.issuedAt >= AVATAR_URL_MAX_AGE_MS;
    if (!isStale) {
      return;
    }

    // 2. 60-second limit applies ONLY to focus/visibilitychange refreshes
    if (now - this.lastBackgroundRefresh < BACKGROUND_REFRESH_THROTTLE_MS) {
      return;
    }

    if (this.inFlightPromise) {
      return;
    }

    this.lastBackgroundRefresh = now;
    void this.executeRefresh({ isError: false });
  };

  public handleImageError = () => {
    const currentUrl = this.avatarUrl;
    if (!currentUrl) {
      this.updateState(null, true);
      return;
    }

    // Only ONCE per URL: if this URL was already retried, stop and show initials (no loops)
    if (this.retriedUrls.has(currentUrl)) {
      this.updateState(currentUrl, true);
      return;
    }

    this.retriedUrls.add(currentUrl);

    // If a refresh is already in flight, show initials/fallback and do not start another
    if (this.inFlightPromise) {
      this.updateState(currentUrl, true);
      return;
    }

    this.updateState(currentUrl, true);

    // Image onError refresh is allowed whenever no refresh is in flight (bypasses 60s background throttle & 50m age)
    void this.executeRefresh({ isError: true });
  };

  public attachListeners() {
    if (typeof window === "undefined") return;

    const onResume = () => this.handleBackgroundResume();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    this.cleanupWindowListeners = () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }

  public destroy() {
    if (this.cleanupWindowListeners) {
      this.cleanupWindowListeners();
      this.cleanupWindowListeners = null;
    }
    this.listeners.clear();
  }

  // Getters for testing
  public getIssuedAt(): number {
    return this.issuedAt;
  }

  public getLastBackgroundRefresh(): number {
    return this.lastBackgroundRefresh;
  }

  public getInFlightPromise(): Promise<string | null> | null {
    return this.inFlightPromise;
  }

  public getRetriedUrls(): Set<string> {
    return this.retriedUrls;
  }
}

export function useAvatarSignedUrl({
  initialAvatarUrl,
  avatarLookupTimedOut = false,
}: {
  initialAvatarUrl: string | null;
  avatarLookupTimedOut?: boolean;
}) {
  const [manager] = useState(
    () => new AvatarUrlManager({ initialAvatarUrl, avatarLookupTimedOut })
  );

  manager.syncPropUrl(initialAvatarUrl, avatarLookupTimedOut);

  const state = useSyncExternalStore(
    manager.subscribe,
    manager.getState,
    () => ({
      avatarUrl: initialAvatarUrl,
      imgError: false,
      showAvatarImage: Boolean(initialAvatarUrl),
    })
  );

  useEffect(() => {
    manager.attachListeners();
    if (avatarLookupTimedOut) {
      manager.handleTimeoutRecovery();
    }
    return () => {
      manager.destroy();
    };
  }, [manager, avatarLookupTimedOut]);

  return {
    avatarUrl: state.avatarUrl,
    imgError: state.imgError,
    showAvatarImage: state.showAvatarImage,
    handleImageError: manager.handleImageError,
    setAvatarUrlDirectly: manager.setAvatarUrlDirectly,
  };
}
