import { describe, it, expect, vi } from "vitest";
import {
  AvatarUrlManager,
  AVATAR_URL_MAX_AGE_MS,
} from "../use-avatar-signed-url";

describe("useAvatarSignedUrl / AvatarUrlManager", () => {
  const BASE_TIME = 1_700_000_000_000;

  it("1. fresh URL (< 50 min) does not call server on focus or visibilitychange", async () => {
    let currentTime = BASE_TIME;
    let fetchCount = 0;
    const fetchAction = vi.fn(async () => {
      fetchCount++;
      return { success: true, avatarUrl: "https://example.com/new-avatar.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => currentTime,
    });

    // Advance by 10 minutes (less than 50 minutes)
    currentTime += 10 * 60 * 1000;
    manager.handleBackgroundResume();

    expect(fetchCount).toBe(0);
    expect(fetchAction).not.toHaveBeenCalled();
    expect(manager.getState().avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(manager.getState().showAvatarImage).toBe(true);
  });

  it("2. stale URL (>= 50 min) calls server on focus or visibilitychange", async () => {
    let currentTime = BASE_TIME;
    const fetchAction = vi.fn(async () => {
      return { success: true, avatarUrl: "https://example.com/fresh-avatar.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => currentTime,
    });

    // Advance by exactly 50 minutes (stale threshold)
    currentTime += AVATAR_URL_MAX_AGE_MS;
    manager.handleBackgroundResume();

    // Allow promise to settle
    await vi.waitFor(() => {
      expect(fetchAction).toHaveBeenCalledTimes(1);
    });

    expect(manager.getState().avatarUrl).toBe("https://example.com/fresh-avatar.jpg");
    expect(manager.getState().imgError).toBe(false);
    expect(manager.getState().showAvatarImage).toBe(true);
  });

  it("3. duplicate concurrent calls deduplicate (at most one refresh in flight)", async () => {
    let resolveServerCall: ((val: { success: boolean; avatarUrl: string }) => void) | null = null;
    let serverCallCount = 0;

    const fetchAction = vi.fn(() => {
      serverCallCount++;
      return new Promise<{ success: boolean; avatarUrl: string }>((resolve) => {
        resolveServerCall = resolve;
      });
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    // Fire two concurrent refresh requests
    const promise1 = manager.executeRefresh();
    const promise2 = manager.executeRefresh();

    expect(serverCallCount).toBe(1);
    expect(promise1).toBe(promise2); // Same in-flight promise returned

    resolveServerCall!({ success: true, avatarUrl: "https://example.com/deduped.jpg" });
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).toBe("https://example.com/deduped.jpg");
    expect(res2).toBe("https://example.com/deduped.jpg");
    expect(serverCallCount).toBe(1);
  });

  it("4. onError refreshes immediately when no refresh is in flight", async () => {
    const fetchAction = vi.fn(async () => {
      return { success: true, avatarUrl: "https://example.com/recovered-avatar.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/broken-avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    manager.handleImageError();

    await vi.waitFor(() => {
      expect(fetchAction).toHaveBeenCalledTimes(1);
    });

    expect(manager.getState().avatarUrl).toBe("https://example.com/recovered-avatar.jpg");
    expect(manager.getState().imgError).toBe(false);
    expect(manager.getState().showAvatarImage).toBe(true);
  });

  it("5. background check throttling (repeated focus within 60s does not call server)", async () => {
    let currentTime = BASE_TIME;
    let fetchCount = 0;
    const fetchAction = vi.fn(async () => {
      fetchCount++;
      return { success: true, avatarUrl: `https://example.com/avatar-v${fetchCount}.jpg` };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => currentTime,
    });

    // Advance to stale (55 minutes)
    currentTime += 55 * 60 * 1000;
    manager.handleBackgroundResume();

    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    // Try again 30 seconds later (within 60s throttle)
    currentTime += 30 * 1000;
    manager.handleBackgroundResume();
    expect(fetchCount).toBe(1); // Blocked by throttle

    // Try again 35 seconds later (total 65s > 60s limit, and still stale)
    currentTime += 35 * 1000;
    // Set issuedAt back to simulate URL remaining stale
    manager.handleBackgroundResume();
    // Since previous refresh at currentTime - 65s set issuedAt to (currentTime - 65s),
    // it's now only 65s old, which is fresh (< 50 min), so it won't re-fetch
    expect(fetchCount).toBe(1);
  });

  it("6. onError refresh is allowed within 60 seconds of a previous background check", async () => {
    let currentTime = BASE_TIME;
    let fetchCount = 0;
    const fetchAction = vi.fn(async () => {
      fetchCount++;
      return { success: true, avatarUrl: `https://example.com/avatar-${fetchCount}.jpg` };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => currentTime,
    });

    // Trigger a background refresh at t = 50 min
    currentTime += AVATAR_URL_MAX_AGE_MS;
    manager.handleBackgroundResume();

    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    // Advance only 15 seconds (< 60s limit)
    currentTime += 15 * 1000;

    // Image load fails -> onError should NOT be blocked by the 60s background throttle
    manager.handleImageError();

    await vi.waitFor(() => {
      expect(fetchCount).toBe(2);
    });

    expect(manager.getState().avatarUrl).toBe("https://example.com/avatar-2.jpg");
  });

  it("7. only one error refresh per URL: if the refreshed URL also fails, show fallback and do not loop", async () => {
    let fetchCount = 0;
    const fetchAction = vi.fn(async () => {
      fetchCount++;
      return { success: true, avatarUrl: "https://example.com/refreshed-still-broken.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/original-broken.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    // 1st error on initial URL -> triggers 1st refresh
    manager.handleImageError();

    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });
    expect(manager.getState().avatarUrl).toBe("https://example.com/refreshed-still-broken.jpg");

    // 2nd error on the refreshed URL -> must NOT loop or call server again
    manager.handleImageError();

    expect(fetchCount).toBe(1); // Server not called again!
    expect(manager.getState().imgError).toBe(true);
    expect(manager.getState().showAvatarImage).toBe(false); // Initials / fallback displayed
  });

  it("8. prop change adopts new URL and resets issue time", async () => {
    let currentTime = BASE_TIME;
    const fetchAction = vi.fn(async () => {
      return { success: true, avatarUrl: "https://example.com/should-not-fetch.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/url-1.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => currentTime,
    });

    // Advance 40 minutes
    currentTime += 40 * 60 * 1000;

    // Prop updates to url-2
    manager.syncPropUrl("https://example.com/url-2.jpg");

    expect(manager.getState().avatarUrl).toBe("https://example.com/url-2.jpg");
    expect(manager.getIssuedAt()).toBe(currentTime);

    // Advance 20 minutes (total 60 min from start, but only 20 min from prop sync)
    currentTime += 20 * 60 * 1000;
    manager.handleBackgroundResume();

    // Because url-2 was issued 20 minutes ago (< 50 min), no fetch happens
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("9. a late server response does not overwrite a newer URL set directly or by prop", async () => {
    let resolveServerCall: ((val: { success: boolean; avatarUrl: string }) => void) | null = null;

    const fetchAction = vi.fn(() => {
      return new Promise<{ success: boolean; avatarUrl: string }>((resolve) => {
        resolveServerCall = resolve;
      });
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/url-1.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    // Refresh begins (version 1)
    const refreshPromise = manager.executeRefresh();

    // User uploads a new photo or clears avatar before refresh completes (version 2)
    manager.setAvatarUrlDirectly("https://example.com/uploaded-new.jpg");

    expect(manager.getState().avatarUrl).toBe("https://example.com/uploaded-new.jpg");

    // Late server response arrives
    resolveServerCall!({ success: true, avatarUrl: "https://example.com/stale-resolved.jpg" });
    await refreshPromise;

    // Stale resolved response must have been ignored!
    expect(manager.getState().avatarUrl).toBe("https://example.com/uploaded-new.jpg");
  });

  it("10. removal via setAvatarUrlDirectly(null) clears avatar immediately and resets state", () => {
    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/avatar.jpg",
      nowFn: () => BASE_TIME,
    });

    expect(manager.getState().showAvatarImage).toBe(true);

    manager.setAvatarUrlDirectly(null);

    expect(manager.getState().avatarUrl).toBeNull();
    expect(manager.getState().imgError).toBe(false);
    expect(manager.getState().showAvatarImage).toBe(false);
    expect(manager.getIssuedAt()).toBe(0);
  });

  it("11. timeout recovery: avatarLookupTimedOut = true with initialAvatarUrl = null triggers exactly ONE client refresh", async () => {
    let fetchCount = 0;
    const fetchAction = vi.fn(async () => {
      fetchCount++;
      return { success: true, avatarUrl: "https://example.com/recovered-after-timeout.jpg" };
    });

    const manager = new AvatarUrlManager({
      initialAvatarUrl: null,
      avatarLookupTimedOut: true,
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    expect(manager.getState().avatarUrl).toBeNull();

    // Trigger timeout recovery
    manager.handleTimeoutRecovery();

    // Second call must deduplicate / be a no-op
    manager.handleTimeoutRecovery();

    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    expect(manager.getState().avatarUrl).toBe("https://example.com/recovered-after-timeout.jpg");
    expect(manager.getState().showAvatarImage).toBe(true);
  });

  it("12. preserves existing avatar when router.refresh times out (avatarLookupTimedOut = true)", () => {
    const fetchAction = vi.fn();
    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/existing-photo.jpg",
      fetchAvatarUrlAction: fetchAction,
      nowFn: () => BASE_TIME,
    });

    expect(manager.getState().avatarUrl).toBe("https://example.com/existing-photo.jpg");

    // Server re-render times out: passes null prop with timedOut = true
    manager.syncPropUrl(null, true);

    // Existing photo must NOT be wiped out!
    expect(manager.getState().avatarUrl).toBe("https://example.com/existing-photo.jpg");
    expect(manager.getState().showAvatarImage).toBe(true);

    // Recovery is not needed since photo is already present
    manager.handleTimeoutRecovery();
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("13. authoritative removal (avatarLookupTimedOut = false, newPropUrl = null) clears avatar immediately", () => {
    const manager = new AvatarUrlManager({
      initialAvatarUrl: "https://example.com/existing-photo.jpg",
      nowFn: () => BASE_TIME,
    });

    expect(manager.getState().showAvatarImage).toBe(true);

    // Real removal from server (timedOut = false)
    manager.syncPropUrl(null, false);

    expect(manager.getState().avatarUrl).toBeNull();
    expect(manager.getState().showAvatarImage).toBe(false);
  });
});
