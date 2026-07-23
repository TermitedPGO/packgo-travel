/**
 * Batch P1a — read-only query helpers for the storefront contract tables
 * (productVersions / itineraryVersions / itineraryDays / itineraryStops /
 * feeContracts / feeItems) plus the trusted supplier-availability lookup
 * (tours → provider from sourceUrl host → suppliers (isActive kill switch)
 * → supplierProducts scoped by supplierId → supplierDepartures).
 *
 * Read-only by design: this module contains NO insert/update/delete.
 * Publishing flows land in a later batch (with the one-published-per-tour
 * invariant enforced at write time); the storefront only ever reads
 * status='published' rows and returns null/[] honestly when none exist.
 *
 * ANCESTRY RULE (Codex 2026-07-20 P1-1): every public lookup starts from
 * tourId and walks the published chain downward. There is no direct
 * internal-ID entrypoint (the former by-itineraryId lookup was removed —
 * it could serve a child whose parent productVersion was unpublished).
 *
 * Follows the server/db/* pattern: lazy getDb(), graceful null/[] when the
 * database is unavailable so local tooling can run without DATABASE_URL.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  feeContracts,
  feeItems,
  itineraryDays,
  itineraryStops,
  itineraryVersions,
  productVersions,
  supplierDepartures,
  supplierProducts,
  suppliers,
  tours,
  type FeeContract,
  type FeeItem,
  type ItineraryDay,
  type ItineraryStop,
  type ItineraryVersion,
  type ProductVersion,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SupplierAvailability } from "./availabilityBucket";

/**
 * The single published productVersion for a tour, or null.
 * (At most one exists by code-enforced invariant; `desc(versionNumber)`
 * makes the read deterministic even if the invariant is ever violated.)
 */
export async function getPublishedProductVersionByTourId(
  tourId: number,
): Promise<ProductVersion | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(productVersions)
    .where(and(eq(productVersions.tourId, tourId), eq(productVersions.status, "published")))
    .orderBy(desc(productVersions.versionNumber))
    .limit(1);
  return rows[0] ?? null;
}

/** Published itineraryVersion for a productVersion, or null. */
export async function getPublishedItineraryVersionByProductVersionId(
  productVersionId: number,
): Promise<ItineraryVersion | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(itineraryVersions)
    .where(
      and(
        eq(itineraryVersions.productVersionId, productVersionId),
        eq(itineraryVersions.status, "published"),
      ),
    )
    .orderBy(desc(itineraryVersions.versionNumber))
    .limit(1);
  return rows[0] ?? null;
}

/** All days of an itineraryVersion, ordered by dayNumber. */
export async function getItineraryDaysByVersionId(
  itineraryVersionId: number,
): Promise<ItineraryDay[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(itineraryDays)
    .where(eq(itineraryDays.itineraryVersionId, itineraryVersionId))
    .orderBy(asc(itineraryDays.dayNumber));
}

/** All stops for a set of day row ids, ordered by day then sortOrder. */
export async function getItineraryStopsByDayIds(
  dayIds: number[],
): Promise<ItineraryStop[]> {
  if (dayIds.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(itineraryStops)
    .where(inArray(itineraryStops.itineraryDayId, dayIds))
    .orderBy(asc(itineraryStops.itineraryDayId), asc(itineraryStops.sortOrder));
}

/**
 * All PUBLISHED feeContracts for a productVersion (date filtering is done
 * in the caller via isContractValidOn — timestamps' NULL open-ends are
 * simpler and better tested in JS than in dialect SQL).
 */
export async function getPublishedFeeContractsByProductVersionId(
  productVersionId: number,
): Promise<FeeContract[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(feeContracts)
    .where(
      and(
        eq(feeContracts.productVersionId, productVersionId),
        eq(feeContracts.status, "published"),
      ),
    )
    .orderBy(desc(feeContracts.validFrom));
}

/** All fee lines of a contract, ordered by sortOrder. */
export async function getFeeItemsByContractId(feeContractId: number): Promise<FeeItem[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(feeItems)
    .where(eq(feeItems.feeContractId, feeContractId))
    .orderBy(asc(feeItems.sortOrder));
}

// ── Trusted supplier availability (Codex 2026-07-20 P0-1, 2026-07-21 P0-1) ──

/**
 * Known storefront providers. `suppliers.code` values ("lion" / "uv") — the
 * same registry keys catalogRebuild's resolveSupplierId uses.
 */
export type SupplierProvider = "lion" | "uv";

/** True when `hostname` is `domain` or a subdomain of it (never a substring). */
function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith("." + domain);
}

export interface SupplierLinkage {
  provider: SupplierProvider;
  externalCode: string;
}

/**
 * Resolve a tour row to a PROVIDER-SCOPED supplier linkage
 * (Codex 2026-07-21 P0-1). The provider identity comes from the sourceUrl
 * host, using the exact hosts production code already filters on
 * (catalogRebuild LION_SOURCE_HOST / UV_SOURCE_HOST, suppliersRouter
 * %liontravel.com% / %uvbookings% joins), and the per-provider code rules
 * catalogRebuild enforces:
 *   - Lion: external code comes ONLY from the sourceUrl `NormGroupID` param
 *     (tours.productCode holds a DIFFERENT Lion id — never a valid
 *     externalProductCode, so there is no Lion productCode fallback);
 *   - UV: external code from the `/product/detail/<code>` path; UV alone may
 *     fall back to tours.productCode (rebuildUvFromMirror idiom) — and only
 *     once the UV host has already been established.
 * Everything else is fail-closed null: no sourceUrl (no provider identity —
 * a bare productCode could collide with ANY supplier's code space), a
 * malformed URL, an unknown host, or a provider whose required code pattern
 * is absent.
 */
export function resolveSupplierLinkage(tour: {
  sourceUrl: string | null;
  productCode: string | null;
}): SupplierLinkage | null {
  if (!tour.sourceUrl) return null; // no host ⇒ unknown provider ⇒ fail-closed
  let hostname: string;
  try {
    hostname = new URL(tour.sourceUrl).hostname.toLowerCase();
  } catch {
    return null; // malformed URL ⇒ fail-closed
  }
  if (hostMatches(hostname, "liontravel.com")) {
    // Lion matches ONLY via the sourceUrl NormGroupID (catalogRebuild rule).
    const m = tour.sourceUrl.match(/[?&]NormGroupID=([^&#]+)/i);
    return m ? { provider: "lion", externalCode: decodeURIComponent(m[1]) } : null;
  }
  if (
    hostMatches(hostname, "uvbookings.com") ||
    hostMatches(hostname, "uvbookings.toursbms.com")
  ) {
    const m = tour.sourceUrl.match(/\/product\/detail\/([^/?#]+)/);
    const code = m?.[1] ?? tour.productCode; // UV-only productCode fallback
    return code ? { provider: "uv", externalCode: code } : null;
  }
  return null; // unknown host ⇒ fail-closed
}

/** Normalize a departure date (Date or 'YYYY-MM-DD…' string) to a UTC day key. */
export function departureDateKey(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** Fail-closed rank: when two supplier rows share a date, keep the LEAST available. */
const AVAILABILITY_RANK: Record<SupplierAvailability, number> = {
  unavailable: 0,
  full: 1,
  limited: 2,
  available: 3,
};

/**
 * Trusted supplier availability for a tour, keyed by departure-date
 * ('YYYY-MM-DD') — the ONLY permitted source of public availability.
 *
 * Supplier-scoped trust chain (Codex 2026-07-21 P0-1):
 *   1. the tour's sourceUrl host resolves a known provider (lion/uv) and
 *      that provider's external code — see resolveSupplierLinkage;
 *   2. the provider's suppliers row must exist AND have isActive=true
 *      (kill switch, checked BEFORE any product lookup);
 *   3. the product is locked by supplierId + externalProductCode +
 *      status='active' + isHiddenByAdmin=false. The DB only guarantees
 *      (supplierId, externalProductCode) composite uniqueness — codes are
 *      NOT globally unique, so the supplierId binding is what stops another
 *      supplier's same-code mirror from being used as evidence. Anything
 *      other than exactly one match (including an ambiguous multi-match,
 *      which would mean the composite invariant itself is broken) is
 *      fail-closed — there is no arbitrary limit(1) pick.
 *
 * Returns null (⇒ nothing may be publicly listed) when any link in the
 * chain is missing. Duplicate dates keep the least-available state
 * (fail-closed).
 */
export async function getTrustedSupplierAvailabilityByTourId(
  tourId: number,
): Promise<Map<string, SupplierAvailability> | null> {
  const db = await getDb();
  if (!db) return null;

  const tourRows = await db
    .select({ sourceUrl: tours.sourceUrl, productCode: tours.productCode })
    .from(tours)
    .where(eq(tours.id, tourId))
    .limit(1);
  const tour = tourRows[0];
  if (!tour) return null;

  const linkage = resolveSupplierLinkage(tour);
  if (!linkage) return null;

  // Kill switch first: the provider's root suppliers row must be active.
  // suppliers.code is DB-unique, so exactly-one is the only trusted outcome.
  const supplierRows = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.code, linkage.provider), eq(suppliers.isActive, true)));
  if (supplierRows.length !== 1) return null;
  const supplier = supplierRows[0];

  const productRows = await db
    .select({ id: supplierProducts.id })
    .from(supplierProducts)
    .where(
      and(
        eq(supplierProducts.supplierId, supplier.id),
        eq(supplierProducts.externalProductCode, linkage.externalCode),
        eq(supplierProducts.status, "active"),
        eq(supplierProducts.isHiddenByAdmin, false),
      ),
    );
  // Composite-unique (supplierId, externalProductCode) ⇒ at most one row can
  // legitimately exist; 0 or >1 (broken invariant / ambiguous) ⇒ fail-closed.
  if (productRows.length !== 1) return null;
  const product = productRows[0];

  const departureRows = await db
    .select({
      departureDate: supplierDepartures.departureDate,
      availability: supplierDepartures.availability,
    })
    .from(supplierDepartures)
    .where(eq(supplierDepartures.supplierProductId, product.id));

  const byDate = new Map<string, SupplierAvailability>();
  for (const row of departureRows) {
    const key = departureDateKey(row.departureDate);
    const existing = byDate.get(key);
    if (
      existing === undefined ||
      AVAILABILITY_RANK[row.availability] < AVAILABILITY_RANK[existing]
    ) {
      byDate.set(key, row.availability);
    }
  }
  return byDate;
}
