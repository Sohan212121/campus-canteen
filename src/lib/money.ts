/**
 * Money formatting and parsing utility.
 *
 * Monetary values in the database are strictly stored as integer paise
 * (e.g., 5000 = ₹50.00).
 */

export function formatPaise(paise: number): string {
  if (typeof paise !== "number" || isNaN(paise)) {
    return "₹0";
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const rupees = Math.floor(absPaise / 100);
  const remainingPaise = absPaise % 100;

  let formattedAmount: string;
  if (remainingPaise === 0) {
    formattedAmount = rupees.toLocaleString("en-IN");
  } else {
    formattedAmount = `${rupees.toLocaleString("en-IN")}.${remainingPaise
      .toString()
      .padStart(2, "0")}`;
  }

  return `${isNegative ? "-" : ""}₹${formattedAmount}`;
}

/**
 * Strict price parser from a user-supplied rupee string to integer paise.
 * Converted to integer paise without float math to eliminate IEEE-754 precision errors.
 * Rejects zero, negative, NaN, and decimals with more than 2 decimal places.
 */
export function parseRupeesToPaise(input: string | number): {
  success: boolean;
  paise?: number;
  error?: string;
} {
  const str = String(input ?? "").trim();
  if (!str) {
    return { success: false, error: "Price is required." };
  }

  const regex = /^\d{1,5}(\.\d{1,2})?$/;
  if (!regex.test(str)) {
    return {
      success: false,
      error: "Please enter a valid price in rupees (max 5 digits, up to 2 decimal places).",
    };
  }

  const parts = str.split(".");
  const rupees = parseInt(parts[0], 10);
  const paiseDec = parts[1] ? (parts[1] + "0").slice(0, 2) : "00";
  const paise = rupees * 100 + parseInt(paiseDec, 10);

  if (isNaN(paise) || paise <= 0) {
    return { success: false, error: "Price must be greater than zero." };
  }

  if (paise > 9999999) {
    return { success: false, error: "Price exceeds maximum allowed limit." };
  }

  return { success: true, paise };
}
