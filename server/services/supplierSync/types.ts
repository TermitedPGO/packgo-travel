/**
 * supplierSync/types — Normalized detail shapes for downstream consumers.
 *
 * These shapes are PACK&GO's OWN format — deliberately decoupled from
 * Lion's `LionTravelInfo` / UV's `UvProductMain` etc. Why:
 *
 *   1. TourDetail page + InquiryAgent + (future) public REST API all
 *      read from the SAME normalized shape, so adding/swapping
 *      suppliers doesn't ripple changes through consumers.
 *
 *   2. Stage 3 public API contract stability — these become the
 *      JSON returned by `GET /api/v1/products/:id/detail`.
 *
 *   3. Future PACK&GO-owned products + partner products use the same
 *      shape, so the catalog is supplier-agnostic from the consumer's
 *      perspective.
 *
 * Migration: 0083_supplier_product_details.sql columns store these as
 * JSON strings in `*Parsed` columns. `schemaVersion` on the row tracks
 * any future shape bumps so consumers can branch on it.
 */

export type DetailKind =
  | "itinerary"
  | "priceTerms"
  | "notices"
  | "optional"
  | "tourInfo";

export type ParseStatus =
  | "parsed"
  | "parse_failed"
  | "missing"
  | "stale";

/* ─────────────────── Itinerary ─────────────────── */

export interface NormalizedItineraryDay {
  /** 1-indexed (Day 1, Day 2, …). */
  dayNumber: number;
  /** Short title for the day, e.g. "桃園 → 東京 機場接送". */
  title: string;
  /** Attractions / activities visited that day. */
  attractions: Array<{
    name: string;
    description?: string;
    durationHours?: number;
  }>;
  /** Hotels for the overnight stay AFTER this day's activities. */
  hotels: Array<{
    name: string;
    city?: string;
    /** 1-5 star, supplier-reported. Not customer review score. */
    rating?: number;
    type?: "5星" | "4星" | "3星" | "經濟" | "民宿" | "未指定";
  }>;
  /** Meals — `false` = not included; `true` / string = included with description. */
  meals: {
    breakfast: boolean | string;
    lunch: boolean | string;
    dinner: boolean | string;
  };
  /** Transportation for the day (e.g. "包車", "新幹線", "飛機"). */
  transportation?: string;
}

export interface NormalizedItinerary {
  totalDays: number;
  days: NormalizedItineraryDay[];
}

/* ─────────────────── Price terms ─────────────────── */

export interface NormalizedPriceTerms {
  /** What the customer's payment covers. */
  included: string[];
  /** Out-of-pocket items. */
  excluded: string[];
  /** Plain-text payment terms (deposit + final due date). */
  paymentTerms: string;
  /** Refund schedule. Sorted by daysBeforeDeparture DESC. */
  cancellationPolicy: Array<{
    daysBeforeDeparture: number;
    refundPercent: number;
    note?: string;
  }>;
}

/* ─────────────────── Notices ─────────────────── */

export interface NormalizedNotices {
  /** Visa requirements (country, lead time, fees). */
  visa: string;
  /** Insurance terms. */
  insurance: string;
  /** Baggage allowance / restrictions. */
  baggage: string;
  /** Catchall important notes (clothing, season, behavior). */
  general: string;
}

/* ─────────────────── Optional add-ons ─────────────────── */

export interface NormalizedOptionalItem {
  name: string;
  description: string;
  price: number;
  currency: string;
  /** Minimum participants required to operate this add-on. */
  minParticipants?: number;
}

export interface NormalizedOptional {
  items: NormalizedOptionalItem[];
}

/* ─────────────────── Tour info (metadata) ─────────────────── */

export interface NormalizedTourInfo {
  /** Marketing highlights ("行程亮點"). */
  highlights: string[];
  /** Free-form supplier metadata (key → value), kept for completeness. */
  metadata: Record<string, string>;
}

/* ─────────────────── Enrichment result ─────────────────── */

/**
 * One detail-fetch outcome for a single (product, kind) pair. The worker
 * collects these per product and upserts them via `upsertProductDetail`.
 */
export interface EnrichmentResult {
  kind: DetailKind;
  /** Raw supplier response as JSON string. `null` if API call failed. */
  raw: string | null;
  /** Normalized JSON-serialisable shape. `null` if parser couldn't extract. */
  parsed:
    | NormalizedItinerary
    | NormalizedPriceTerms
    | NormalizedNotices
    | NormalizedOptional
    | NormalizedTourInfo
    | null;
  status: ParseStatus;
  fetchedAt: Date;
  errorMessage?: string;
}

/** Full enrichment for one product — one Result per kind. */
export interface ProductEnrichment {
  itinerary: EnrichmentResult;
  priceTerms: EnrichmentResult;
  notices: EnrichmentResult;
  optional: EnrichmentResult;
  tourInfo: EnrichmentResult;
}
