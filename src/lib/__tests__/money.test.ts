import { describe, it, expect } from "vitest";
import { formatPaise } from "@/lib/money";

describe("formatPaise", () => {
  it("formats 0 paise as ₹0", () => {
    expect(formatPaise(0)).toBe("₹0");
  });

  it("formats whole rupee amounts without trailing decimals", () => {
    expect(formatPaise(5000)).toBe("₹50");
    expect(formatPaise(100)).toBe("₹1");
    expect(formatPaise(15000)).toBe("₹150");
  });

  it("formats fractional rupee amounts with two decimal places", () => {
    expect(formatPaise(5050)).toBe("₹50.50");
    expect(formatPaise(5005)).toBe("₹50.05");
    expect(formatPaise(75)).toBe("₹0.75");
  });

  it("handles negative amounts cleanly", () => {
    expect(formatPaise(-5000)).toBe("-₹50");
    expect(formatPaise(-5050)).toBe("-₹50.50");
  });

  it("handles non-number or NaN safely", () => {
    expect(formatPaise(NaN)).toBe("₹0");
    // @ts-expect-error test non-number
    expect(formatPaise(null)).toBe("₹0");
  });

  it("formats large numbers with Indian number formatting commas", () => {
    expect(formatPaise(10000000)).toBe("₹1,00,000");
  });
});
