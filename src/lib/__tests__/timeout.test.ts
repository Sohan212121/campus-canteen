import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "@/lib/timeout";

describe("Sub-Step 3C: withTimeout utility", () => {
  it("resolves quickly when promise finishes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast_data"), 50);
    });

    const result = await withTimeout(fastPromise, 500);
    expect(result).toBe("fast_data");
  });

  it("rejects with TimeoutError when promise exceeds timeout threshold", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow_data"), 500);
    });

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow(TimeoutError);
    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("auth service unreachable");
  });

  it("aborts the AbortSignal when factory times out", async () => {
    let signalAborted = false;

    const factory = (signal: AbortSignal) => {
      signal.addEventListener("abort", () => {
        signalAborted = true;
      });
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve("never"), 500);
      });
    };

    await expect(withTimeout(factory, 50)).rejects.toThrow(TimeoutError);
    expect(signalAborted).toBe(true);
  });

  it("does not abort signal if factory completes before timeout", async () => {
    let signalAborted = false;

    const factory = (signal: AbortSignal) => {
      signal.addEventListener("abort", () => {
        signalAborted = true;
      });
      return Promise.resolve("instant_success");
    };

    const res = await withTimeout(factory, 500);
    expect(res).toBe("instant_success");
    expect(signalAborted).toBe(false);
  });
});
