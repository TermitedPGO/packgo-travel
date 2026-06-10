/**
 * quoteTask — pure parse of a quote-lane approval payload for workspace cards
 * (批2 m2). Canonical shape: QuoteDraftPayload in quoteProducer.ts (server)
 * mirrored in admin-v2/CommandCenter/lanes. Parsed here independently so the
 * workspace chunk doesn't import the admin lane UI module for one function;
 * malformed/drifted payloads return null and the card falls back to summary.
 *
 * Honest rendering rule: only fields the producer actually writes — no 佔床
 * breakdown exists in the payload today, so none is fabricated on the card
 * (the mockup's occupancy editor needs producer fields first; see
 * tasks/batch-2-customers.md).
 */

export interface QuoteCardInfo {
  /** The price to show: Jeff's finalPrice when set, else supplier 直客價. */
  price: number | null;
  /** Which price it is — drives the label key. */
  priceKind: "final" | "supplier" | null;
  currency: string;
  /** 客製遊 → manual quote needed, no auto price. */
  isCustomTrip: boolean;
  /** True when the price came from the supplier portal (show the src line). */
  fromSupplier: boolean;
}

export function parseQuoteCard(payload: string): QuoteCardInfo | null {
  let obj: unknown;
  try {
    obj = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const p = obj as Record<string, unknown>;
  if (typeof p.tourTitle !== "string") return null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const finalPrice = num(p.finalPrice);
  const supplierPrice = num(p.supplierPrice);
  const price = finalPrice ?? supplierPrice;

  return {
    price,
    priceKind:
      finalPrice !== null ? "final" : supplierPrice !== null ? "supplier" : null,
    currency: typeof p.currency === "string" && p.currency ? p.currency : "USD",
    isCustomTrip: p.isCustomTrip === true,
    fromSupplier: supplierPrice !== null,
  };
}
