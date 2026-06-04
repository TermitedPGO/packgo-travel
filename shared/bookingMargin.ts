/**
 * Phase 2.5: per-booking margin from a MANUALLY-entered supplier cost.
 *
 * IMPORTANT (不准猜): supplierCost is the cost Jeff entered after verifying it
 * against the supplier's actual order confirmation. It is NEVER auto-derived
 * from the supplier mirror, because supplier pricing carries nuance (adult
 * two-in-a-room basis, child rates that only live in flyer prose) that has
 * repeatedly burned auto-quotes. An auto-margin would be confidently wrong; a
 * manual one is trustworthy. This module only does the arithmetic.
 *
 * Units: totalPrice and supplierCost share the booking's currency + unit (both
 * the schema `int`). Margin is in the same unit. Pure + dependency-free.
 */
export interface MarginResult {
  /** totalPrice - supplierCost (same unit/currency as the booking). */
  margin: number;
  /** margin / totalPrice * 100, rounded to 1 dp. null when totalPrice <= 0. */
  marginPct: number | null;
  /** true when selling at or below cost (margin < 0) — an objective red flag. */
  isNegative: boolean;
  /** false when no supplier cost has been entered yet (don't show a margin). */
  hasCost: boolean;
}

export function computeMargin(
  totalPrice: number,
  supplierCost: number | null | undefined,
): MarginResult {
  if (supplierCost === null || supplierCost === undefined || Number.isNaN(supplierCost)) {
    return { margin: 0, marginPct: null, isNegative: false, hasCost: false };
  }
  const margin = totalPrice - supplierCost;
  const marginPct = totalPrice > 0 ? Math.round((margin / totalPrice) * 1000) / 10 : null;
  return { margin, marginPct, isNegative: margin < 0, hasCost: true };
}
