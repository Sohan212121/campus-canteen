import { describe, it, expect, vi } from "vitest";
import {
  formatSupabaseError,
  logSupabaseError,
  isMissingColumnError,
} from "@/lib/supabase-error";

describe("supabase-error helper", () => {
  describe("formatSupabaseError", () => {
    it("formats standard PostgrestError with code, message, details, and hint", () => {
      const error = {
        code: "42703",
        message: 'column menu_items.calories_kcal does not exist',
        details: "table menu_items does not contain column calories_kcal",
        hint: "Perhaps you meant to reference column id",
      };

      const formatted = formatSupabaseError("TestScope", error);
      expect(formatted).toBe(
        '[TestScope] Supabase error: code: "42703" | message: "column menu_items.calories_kcal does not exist" | details: "table menu_items does not contain column calories_kcal" | hint: "Perhaps you meant to reference column id"'
      );
    });

    it("formats error when only some fields are present", () => {
      const error = {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      };

      const formatted = formatSupabaseError("OrderDetail", error);
      expect(formatted).toBe(
        '[OrderDetail] Supabase error: code: "PGRST116" | message: "JSON object requested, multiple (or no) rows returned"'
      );
    });

    it("never logs secrets or user data contained in the error object", () => {
      const errorWithSecrets = {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        password: "super_secret_user_password_123!",
        user_token: "jwt_bearer_token_secret",
        student_phone: "9876543210",
      };

      const formatted = formatSupabaseError("AuthAction", errorWithSecrets);
      expect(formatted).toContain('code: "23505"');
      expect(formatted).toContain('message: "duplicate key value violates unique constraint"');
      expect(formatted).not.toContain("super_secret_user_password_123!");
      expect(formatted).not.toContain("jwt_bearer_token_secret");
      expect(formatted).not.toContain("9876543210");
      expect(formatted).not.toContain("password");
      expect(formatted).not.toContain("user_token");
    });

    it("handles null and undefined gracefully", () => {
      expect(formatSupabaseError("NullScope", null)).toBe("[NullScope] Supabase error: (empty/null)");
      expect(formatSupabaseError("UndefinedScope", undefined)).toBe(
        "[UndefinedScope] Supabase error: (empty/null)"
      );
    });

    it("handles string error messages", () => {
      expect(formatSupabaseError("StringScope", "Network timeout")).toBe(
        "[StringScope] Supabase error: Network timeout"
      );
    });

    it("handles standard Error instances", () => {
      const err = new Error("Connection reset by peer");
      expect(formatSupabaseError("ErrorScope", err)).toBe(
        '[ErrorScope] Supabase error: message: "Connection reset by peer"'
      );
    });

    it("handles empty objects without serializing as {}", () => {
      const formatted = formatSupabaseError("EmptyScope", {});
      expect(formatted).toBe("[EmptyScope] Supabase error: unknown error structure");
    });
  });

  describe("logSupabaseError", () => {
    it("calls console.error with formatted string", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = {
        code: "42703",
        message: "column not found",
      };

      logSupabaseError("TestLog", error);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[TestLog] Supabase error: code: "42703" | message: "column not found"'
      );
      consoleSpy.mockRestore();
    });
  });

  describe("isMissingColumnError", () => {
    it("returns true for code 42703 (string or number)", () => {
      expect(isMissingColumnError({ code: "42703" })).toBe(true);
      expect(isMissingColumnError({ code: 42703 })).toBe(true);
    });

    it("returns true for error message indicating column does not exist", () => {
      expect(
        isMissingColumnError({
          message: 'column menu_items.calories_kcal does not exist',
        })
      ).toBe(true);
      expect(
        isMissingColumnError({
          message: 'column "ingredients" does not exist',
        })
      ).toBe(true);
    });

    it("returns false for other database error codes", () => {
      expect(isMissingColumnError({ code: "23505", message: "unique violation" })).toBe(false);
      expect(isMissingColumnError({ code: "42P01", message: "relation does not exist" })).toBe(false);
      expect(isMissingColumnError({ code: "PGRST116", message: "no rows found" })).toBe(false);
    });

    it("returns false for non-objects or empty values", () => {
      expect(isMissingColumnError(null)).toBe(false);
      expect(isMissingColumnError(undefined)).toBe(false);
      expect(isMissingColumnError("42703")).toBe(false);
      expect(isMissingColumnError({})).toBe(false);
    });
  });
});
