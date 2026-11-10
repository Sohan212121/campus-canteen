import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseHashFragment,
  mapAuthErrorMessage,
  getHashSnapshot,
  getServerSnapshot,
  _resetHashStoreForTesting,
} from "../confirm-view";
import ConfirmPage from "../page";

describe("Confirm View URL Parsing & Snapshot Caching", () => {
  beforeEach(() => {
    _resetHashStoreForTesting();
    // Simulate browser window
    const mockHistory = {
      replaceState: () => {},
    };
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          hash: "",
          pathname: "/auth/confirm",
          search: "",
        },
        history: mockHistory,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      writable: true,
      configurable: true,
    });
  });

  describe("parseHashFragment", () => {
    it("returns null for empty or single '#' hashes", () => {
      expect(parseHashFragment("")).toBeNull();
      expect(parseHashFragment("#")).toBeNull();
    });

    it("parses valid access_token, refresh_token and type", () => {
      const parsed = parseHashFragment(
        "#access_token=mock_at_123&refresh_token=mock_rt_456&type=recovery"
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.session).toEqual({
        accessToken: "mock_at_123",
        refreshToken: "mock_rt_456",
        type: "recovery",
      });
      expect(parsed?.error).toBeNull();
    });

    it("parses error and error_code from hash", () => {
      const parsed = parseHashFragment(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.session).toBeNull();
      expect(parsed?.error).toEqual({
        code: "otp_expired",
        description: "Email link is invalid or has expired",
      });
    });

    it("parses error when error_code is absent", () => {
      const parsed = parseHashFragment("#error=access_denied");
      expect(parsed).not.toBeNull();
      expect(parsed?.error?.code).toBe("access_denied");
    });

    it("returns null session when refresh_token is missing", () => {
      const parsed = parseHashFragment("#access_token=token_without_refresh");
      expect(parsed).toBeNull();
    });
  });

  describe("mapAuthErrorMessage", () => {
    it("maps otp_expired and access_denied to friendly expired/used message", () => {
      const expected =
        "Your verification link has expired or has already been used. Please request a new link.";
      expect(mapAuthErrorMessage("otp_expired")).toBe(expected);
      expect(mapAuthErrorMessage("access_denied")).toBe(expected);
      expect(mapAuthErrorMessage("OTP_EXPIRED")).toBe(expected);
      expect(mapAuthErrorMessage("link_expired")).toBe(expected);
    });

    it("maps other/unknown errors to friendly invalid/expired message", () => {
      const expected =
        "Your verification link is invalid or has expired. Please request a new link.";
      expect(mapAuthErrorMessage("invalid_grant")).toBe(expected);
      expect(mapAuthErrorMessage("unknown_error")).toBe(expected);
      expect(mapAuthErrorMessage(undefined)).toBe(expected);
    });

    it("never reflects raw or untrusted input strings", () => {
      const untrusted = "<script>alert(1)</script>";
      const result = mapAuthErrorMessage(untrusted);
      expect(result).not.toContain("<script>");
      expect(result).toBe(
        "Your verification link is invalid or has expired. Please request a new link."
      );
    });
  });

  describe("Snapshot stability and memory preservation", () => {
    it("returns exact same object reference when called repeatedly with same hash (useSyncExternalStore invariant)", () => {
      window.location.hash =
        "#access_token=stable_at&refresh_token=stable_rt&type=recovery";

      const snap1 = getHashSnapshot();
      const snap2 = getHashSnapshot();

      expect(snap1).not.toBeNull();
      expect(snap1).toBe(snap2); // Strict identity (Object.is)
      expect(snap1?.session?.accessToken).toBe("stable_at");
    });

    it("preserves captured session in memory when location hash is cleared via replaceState", () => {
      window.location.hash =
        "#access_token=hygiene_at&refresh_token=hygiene_rt&type=recovery";

      const snap1 = getHashSnapshot();
      expect(snap1?.session?.accessToken).toBe("hygiene_at");

      // Address bar is cleared for security hygiene
      window.location.hash = "";

      const snap2 = getHashSnapshot();
      expect(snap2).toBe(snap1); // Preserves in memory
      expect(snap2?.session?.accessToken).toBe("hygiene_at");
    });

    it("getServerSnapshot always returns null for SSR", () => {
      expect(getServerSnapshot()).toBeNull();
    });
  });

  describe("ConfirmPage Server Component forwarding", () => {
    it("forwards query parameters including error and error_code", async () => {
      const pageJsx = await ConfirmPage({
        searchParams: Promise.resolve({
          token_hash: "th_test",
          type: "recovery",
          next: "/set-password",
          error_code: "otp_expired",
          error_description: "Link expired",
        }),
      });

      expect(pageJsx).not.toBeNull();
      expect(pageJsx.props.initialTokenHash).toBe("th_test");
      expect(pageJsx.props.initialType).toBe("recovery");
      expect(pageJsx.props.initialNext).toBe("/set-password");
      expect(pageJsx.props.initialError).toBe("otp_expired");
      expect(pageJsx.props.initialErrorDescription).toBe("Link expired");
    });
  });

  describe("Request new link URL", () => {
    it("uses /forgot-password?from=link so signed-in users are not redirected by the proxy", () => {
      // Static verification of link target in ConfirmView source
      const confirmViewFile = fs.readFileSync(
        path.join(__dirname, "../confirm-view.tsx"),
        "utf-8"
      );
      expect(confirmViewFile).toContain('href="/forgot-password?from=link"');
    });
  });
});
