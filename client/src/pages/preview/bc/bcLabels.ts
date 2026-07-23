/**
 * Batch P1c — pure label-key mappers for the BC storefront preview.
 *
 * Every function returns an i18n KEY (resolved via t() in JSX — red line 7:
 * no hardcoded Chinese in components). Pure and React-free so Vitest can
 * assert the mappings without a DOM.
 *
 * AVAILABILITY RULE (Jeff 2026-07-20): the public sees EXACTLY three
 * buckets — 充足 / 少量 / 候補. This module can express nothing else:
 * `bucketLabelKey` accepts only the three bucket values and throws on
 * anything unknown (fail-closed — an unmapped state must never render as a
 * fourth availability word or, worse, a number).
 */

export const BC_BUCKETS = ["plenty", "few", "waitlist"] as const;
export type BcBucket = (typeof BC_BUCKETS)[number];

/**
 * Client mirror of server BUCKET_LABEL_KEYS (availabilityBucket.ts). The
 * server also ships a resolved label key per departure; this mapper exists so
 * the client can fail-closed if a DTO ever carries an out-of-contract value.
 */
export function bucketLabelKey(bucket: string): string {
  switch (bucket) {
    case "plenty":
      return "storefront.availability.plenty";
    case "few":
      return "storefront.availability.few";
    case "waitlist":
      return "storefront.availability.waitlist";
    default:
      throw new Error(`Unknown availability bucket "${bucket}" — refusing to render`);
  }
}

/** feeItems.payeeType → label key. Unknown values fall back to `other`. */
export function payeeLabelKey(payeeType: string): string {
  const known = [
    "airline",
    "government",
    "guide_and_driver",
    "leader_and_driver",
    "restaurant_or_traveler_choice",
    "packgo_or_hotel",
    "local_supplier",
    "ticket_supplier",
    "other",
  ];
  const key = known.includes(payeeType) ? payeeType : "other";
  return `bcPreview.fees.payee.${key}`;
}

/** feeItems.paymentTiming → label key. Unknown ⇒ honest pending wording. */
export function timingLabelKey(timing: string): string {
  const known = ["before_departure", "during_trip", "if_selected"];
  const key = known.includes(timing) ? timing : "pending";
  return `bcPreview.fees.timing.${key}`;
}

/** feeItems.unit → label key (每人 / 每次訂購). */
export function feeUnitLabelKey(unit: string): string {
  return unit === "per_booking"
    ? "bcPreview.fees.unit.perBooking"
    : "bcPreview.fees.unit.perPerson";
}

/** Meal service status (itinerary contract) → label key. Unknown ⇒ pending. */
export function mealStatusLabelKey(status: string): string {
  const known = ["self", "included", "included_unconfirmed", "in_flight", "pending"];
  const key = known.includes(status) ? status : "pending";
  return `bcPreview.itinerary.meal.${key}`;
}

/**
 * Movement (transport) status → label key. `estimated` renders the honest
 * 預估·示意 wording; only `confirmed` may read as a settled claim.
 */
export function movementStatusLabelKey(status: string): string {
  const known = ["estimated", "confirmed", "pending"];
  const key = known.includes(status) ? status : "pending";
  return `bcPreview.itinerary.movement.${key}`;
}

/**
 * Contract/fee sourceStatus → honest provenance tag key. Anything that is
 * not explicitly confirmed by a supplier renders as an estimate/pending tag
 * — demo_estimate must NEVER look like verified data.
 */
export function sourceStatusLabelKey(status: string | null | undefined): string {
  switch (status) {
    case "supplier_confirmed":
    case "confirmed":
      return "bcPreview.source.confirmed";
    case "supplier_quote":
      return "bcPreview.source.supplierQuote";
    case "source_document":
      return "bcPreview.source.sourceDocument";
    case "demo_estimate":
      return "bcPreview.source.demoEstimate";
    default:
      return "bcPreview.source.pending";
  }
}

/** Fee category → section title + note keys, in the BC disclosure order. */
export const FEE_CATEGORY_ORDER = ["mandatory", "tips", "self", "optional"] as const;
export type BcFeeCategory = (typeof FEE_CATEGORY_ORDER)[number];

export function feeCategoryTitleKey(category: BcFeeCategory): string {
  return `bcPreview.fees.category.${category}.title`;
}

export function feeCategoryNoteKey(category: BcFeeCategory): string {
  return `bcPreview.fees.category.${category}.note`;
}

/* ── BC shelf card data (safe surface only — Codex 2026-07-22 P0-1/P0-3) ──
 *
 * BC cards are built EXCLUSIVELY from:
 *   1. tours.searchCards — lean catalog fields only (id/title/destination/
 *      duration/nights/heroImage). Its price/priceCurrency/costExplanation
 *      wire fields are IGNORED: no fixed-FX derivation, no whole-unit
 *      formatting, no text-derived flight claim (寧缺勿假).
 *   2. storefront.listDepartures — the safe P1a DTO. Dates and prices on
 *      cards come ONLY from here (native currency, integer minor units).
 */

/** The only searchCards fields a BC card may consume. */
export interface BcShelfTour {
  id: number;
  title: string;
  destinationCountry: string | null;
  destinationCity: string | null;
  duration: number | null;
  nights: number | null;
  heroImage: string | null;
}

/** Soonest-departure facts for one card, sourced from storefront.listDepartures. */
export type BcCardDepartureFacts =
  | { state: "loading" }
  | { state: "error" }
  | { state: "none" }
  | {
      state: "scheduled";
      departureDate: Date | string;
      priceMinorUnits: number;
      currency: string;
    };

/**
 * Map one tours.searchCards row to the BC shelf shape — explicit allow-list,
 * nothing else from the wire payload is kept.
 */
export function toBcShelfTour(row: {
  id: number;
  title: string;
  destinationCountry: string | null;
  destinationCity: string | null;
  duration: number | null;
  nights: number | null;
  heroImage: string | null;
}): BcShelfTour {
  return {
    id: row.id,
    title: row.title,
    destinationCountry: row.destinationCountry ?? null,
    destinationCity: row.destinationCity ?? null,
    duration: row.duration ?? null,
    nights: row.nights ?? null,
    heroImage: row.heroImage ?? null,
  };
}

/**
 * Fold one listDepartures query result into card facts. The SOONEST
 * departure (server returns date-ascending) supplies date + price; there is
 * NO cross-currency lowest-price claim (Codex 2026-07-22 P1-5) — the card
 * shows the next departure, labeled 最近班期.
 */
export function toBcCardDepartureFacts(query: {
  isLoading: boolean;
  isError: boolean;
  data:
    | Array<{
        departureDate: Date | string;
        pricePerPersonMinorUnits: number;
        currency: string;
      }>
    | undefined;
}): BcCardDepartureFacts {
  if (query.isError) return { state: "error" };
  if (query.isLoading || query.data === undefined) return { state: "loading" };
  const soonest = query.data[0];
  if (!soonest) return { state: "none" };
  return {
    state: "scheduled",
    departureDate: soonest.departureDate,
    priceMinorUnits: soonest.pricePerPersonMinorUnits,
    currency: soonest.currency,
  };
}

/**
 * Stay (hotel) claim → { key, params } for one honest line.
 *   - not_applicable        ⇒ 當日不住宿或機上過夜
 *   - rating with verified  ⇒ N 星
 *   - rating unverified     ⇒ N 星或同級（待核實）
 *   - no rating claim       ⇒ 星級待確認
 */
export function stayLabel(stay: {
  propertyStatus: string;
  rating: { value: number; sourceStatus: string | null } | null;
}): { key: string; params?: Record<string, string | number> } {
  if (stay.propertyStatus === "not_applicable") {
    return { key: "bcPreview.itinerary.stay.noStay" };
  }
  if (stay.rating && Number.isFinite(stay.rating.value)) {
    if (stay.rating.sourceStatus === "verified") {
      return {
        key: "bcPreview.itinerary.stay.ratingVerified",
        params: { value: stay.rating.value },
      };
    }
    return {
      key: "bcPreview.itinerary.stay.ratingEquivalent",
      params: { value: stay.rating.value },
    };
  }
  return { key: "bcPreview.itinerary.stay.ratingPending" };
}
