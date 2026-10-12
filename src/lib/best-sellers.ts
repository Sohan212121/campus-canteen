/**
 * Pure helper utilities for Best Sellers display.
 */

/**
 * Returns an accessible text badge label for rank.
 * Must never rely on color alone (PRD / Rule).
 */
export function formatBestSellerBadge(rank: number): string {
  if (!rank || rank <= 0) return "Best seller";
  return `Best seller #${rank}`;
}

/**
 * Returns a human-friendly units sold tag from bucketed text label.
 */
export function formatUnitsSoldBadge(unitsSold: string): string {
  if (!unitsSold || unitsSold === "Popular") return "Popular pick";
  return `${unitsSold} ordered`;
}
