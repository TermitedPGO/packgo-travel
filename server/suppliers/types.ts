/**
 * Shared types for supplier-product synchronization.
 *
 * Two suppliers wired in Phase 1:
 *   • lion — 雄獅旅遊 (Lion Travel) B2C, https://travel.liontravel.com
 *   • uv   — UV Bookings (Universal Vision / ToursBMS public storefront),
 *            https://uvbookings.toursbms.com proxying to
 *            https://online.ctrip.com/restapi/soa2/{serviceId}/*.json
 *
 * Both APIs were mapped via the toursbms-api-report.pdf research dated
 * 2026-05-15. Neither is officially documented — if the supplier changes
 * the wire format, format-change detection in the sync service should
 * catch it and surface a clear error in supplierSyncRuns.
 *
 * Design note: each supplier-specific client returns its NATIVE response
 * shape (with the supplier's field names intact). The sync service
 * normalizes into our DB schema. This keeps the client thin and lets us
 * carry the raw JSON forward in supplierProducts.rawProductJson for
 * fields we haven't yet promoted to first-class columns.
 */

/**
 * Common availability bucket per Jeff's product call (Q4) — never expose
 * raw seat count to customers. See supplierDepartures.availability.
 */
export type Availability = "available" | "limited" | "full" | "unavailable";

/** Common pagination params accepted by both suppliers (same semantics). */
export interface PageParams {
  page: number; // 1-based
  pageSize: number; // both suppliers cap at 200
}

/**
 * Normalized supplier-product summary used by the sync orchestrator.
 * Per-supplier clients map their native field names into this shape so
 * the sync service is supplier-agnostic.
 */
export interface NormalizedProduct {
  /** Supplier-side stable code: Lion's NormGroupID (UUID) or UV's productCode. */
  externalProductCode: string;
  title: string;
  days: number;
  departureCity?: string;
  destinationCountry?: string;
  destinationCity?: string;
  imageUrl?: string;
  currency: string; // ISO 4217 — "TWD" or "USD"
  /** Active = visible to customer; inactive = supplier removed; pending = missing required fields. */
  status: "active" | "inactive" | "pending";
  /** Full native response. Persisted to rawProductJson MEDIUMTEXT. */
  raw: unknown;
}

/** Normalized departure (團期) row used by the sync orchestrator. */
export interface NormalizedDeparture {
  externalProductCode: string;
  externalDepartureCode: string;
  departureDate: string; // ISO YYYY-MM-DD
  retailPrice: number;
  agentPrice: number | null;
  currency: string;
  totalSeats: number;
  spareSeats: number;
  availability: Availability;
  raw: unknown;
}

/**
 * Map a raw seat count to the 3-tier availability bucket.
 *
 * Per Jeff (Q4): three tiers + a fourth "unavailable" for explicit
 * supplier-side closure (Lion "停售" / UV stockStatus !== 200).
 *
 * Thresholds tuned for typical tour group sizes (16–40 seats):
 *   spareSeats === 0           → full
 *   spareSeats ≤ 5             → limited
 *   spareSeats > 5             → available
 * The supplier can also override via explicit closed status.
 */
export function deriveAvailability(
  spareSeats: number,
  supplierClosed: boolean
): Availability {
  if (supplierClosed) return "unavailable";
  if (spareSeats <= 0) return "full";
  if (spareSeats <= 5) return "limited";
  return "available";
}

/**
 * Standard error class so the sync service can distinguish supplier-side
 * errors (HTTP 4xx/5xx, bad responseResult.code) from infra problems
 * (network failure, DB error). errorMessage in supplierSyncRuns captures
 * `${name}: ${message}`.
 */
export class SupplierApiError extends Error {
  constructor(
    public readonly supplier: "lion" | "uv",
    public readonly endpoint: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[${supplier}] ${endpoint}: ${message}`);
    this.name = "SupplierApiError";
  }
}
