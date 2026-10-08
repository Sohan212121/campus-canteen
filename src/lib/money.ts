/**
 * Money formatting utility.
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
