/**
 * uvBulkImportService — convert UV Bookings products into draft tours.
 *
 * Parallel to server/services/lionBulkImportService.ts. Pipeline:
 *
 *   1. supplierProducts row (mirrored by supplierSyncService) gives us
 *      productCode + raw JSON metadata.
 *   2. We call uvClient.getProductTravelDetail + getDeparturesNext180Days
 *      to enrich (itinerary HTML, refund policy, full departure list).
 *   3. Insert a row into `tours` with status='draft' + qaStatus='needs_review'
 *      so it's hidden from public until the LLM rewrite pass runs.
 *   4. Insert each departure into `tourDepartures` with REAL bookedSlots
 *      derived from groupStock - groupSaleStock.
 *   5. Enqueue a tourGenerationQueue job to rewrite into PACK&GO style.
 *
 * Total wall-clock per product: ~2-4 sec (3 API calls + 2 DB writes +
 * queue enqueue). Concurrency 4 in bulk mode → ~150 tours/min throughput.
 *
 * Idempotency: caller is responsible for dedup. The tours table has no
 * unique index on (sourceProvider, sourceUrl) so importing the same
 * productCode twice will create two draft tours. The admin panel bulk-
 * import flow pre-filters out products already in `tours` (matching by
 * sourceUrl containing the productCode).
 */

import {
  getProductMain,
  getProductTravelDetail,
  getDeparturesNext180Days,
  type UvProductTravelDetail,
} from "../suppliers/uvClient";
import { createTour, createDeparture, getDb } from "../db";
import { tourGenerationQueue } from "../queue";
import { SupplierApiError } from "../suppliers/types";
import { createChildLogger } from "../_core/logger";

const log = createChildLogger({ module: "uvBulkImport" });

/**
 * Read the already-synced supplierProducts row for a UV product. The sync
 * service (supplierSync/uv.ts) populated clean, derived columns here —
 * title / days / destinationCountry / destinationCity / departureCity /
 * imageUrl — which are MORE reliable than re-deriving from getProductMain
 * (whose response doesn't even carry destinationName/tempImageUrl). Also
 * returns the enriched itineraryParsed when present, for a cleaner LLM blob.
 * Returns null when the row isn't found (caller falls back to API).
 */
async function readUvSupplierRow(productCode: string): Promise<{
  title: string | null;
  days: number | null;
  destinationCountry: string | null;
  destinationCity: string | null;
  departureCity: string | null;
  imageUrl: string | null;
  nightDay: number | null;
  itineraryParsed: string | null;
  supplierProductId: number | null;
} | null> {
  const db = await getDb();
  if (!db) return null;
  const { supplierProducts, supplierProductDetails, suppliers } = await import(
    "../../drizzle/schema"
  );
  const { eq, and } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: supplierProducts.id,
      title: supplierProducts.title,
      days: supplierProducts.days,
      destinationCountry: supplierProducts.destinationCountry,
      destinationCity: supplierProducts.destinationCity,
      departureCity: supplierProducts.departureCity,
      imageUrl: supplierProducts.imageUrl,
      rawProductJson: supplierProducts.rawProductJson,
      itineraryParsed: supplierProductDetails.itineraryParsed,
    })
    .from(supplierProducts)
    .innerJoin(suppliers, eq(supplierProducts.supplierId, suppliers.id))
    .leftJoin(
      supplierProductDetails,
      eq(supplierProductDetails.supplierProductId, supplierProducts.id),
    )
    .where(
      and(
        eq(suppliers.code, "uv"),
        eq(supplierProducts.externalProductCode, productCode),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  let nightDay: number | null = null;
  try {
    const raw = r.rawProductJson ? JSON.parse(r.rawProductJson) : null;
    if (raw && typeof raw.nightDay === "number") nightDay = raw.nightDay;
  } catch {
    /* rawProductJson not parseable — nightDay stays null */
  }
  return {
    title: r.title,
    days: r.days,
    destinationCountry: r.destinationCountry,
    destinationCity: r.destinationCity,
    departureCity: r.departureCity,
    imageUrl: r.imageUrl,
    nightDay,
    itineraryParsed: r.itineraryParsed,
    supplierProductId: r.id,
  };
}

/**
 * Headline price from the SYNCED supplierDepartures.retailPrice (verified
 * 2026-06-02 to equal getProductGroup priceType=4 for room tours / pt1 for
 * 1-day tours). Used instead of a live getProductGroup re-fetch, which was
 * found to intermittently return $0. Returns the lowest priced departure.
 */
async function readSyncedHeadlinePrice(supplierProductId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const { supplierDepartures } = await import("../../drizzle/schema");
  const { eq, and, gt, sql } = await import("drizzle-orm");
  const rows = await db
    .select({ p: sql<string>`MIN(${supplierDepartures.retailPrice})` })
    .from(supplierDepartures)
    .where(
      and(
        eq(supplierDepartures.supplierProductId, supplierProductId),
        gt(supplierDepartures.retailPrice, "0"),
      ),
    );
  return Math.round(Number(rows[0]?.p ?? 0) || 0);
}

/** Minimal departure shape the price pickers read (subset of UvDepartureRow). */
export interface UvDepartureForPricing {
  groupPrice?: Array<{ priceType: number; groupPrice: number }>;
}

/**
 * Per-departure adult price. Two UV pricing schemes (verified 2026-06-02
 * over all 639 products):
 *   - ROOM tours (multi-day w/ hotel): priceType 3=單人入住 / 4=兩人一房 /
 *     5=三人 / 6=四人. Adult basis = priceType=4 (double-occupancy).
 *   - NON-ROOM (1-day tours / tickets / cruises): priceType 1=成人 / 2=兒童.
 *     Adult = priceType=1. There is NO pt4 (no room), so pt1 is correct.
 * So: pt4 → pt1 → 0 (skip). NOTHING else. priceType=3 (單人/single)
 * over-quotes ~30-37%; priceType=5/6 (三人/四人 per-person) UNDER-quote — so
 * neither is ever an adult basis. Hardened 2026-07-10 (uv-audit §4): the old
 * "first non-single tier" fallback could silently pick pt5/pt6 (low-report =
 * a real quoting risk). Now: no pt4 AND no pt1 → return 0 and SKIP the date,
 * never fall through to a cheaper occupancy tier. Rounded.
 * Pure + exported for unit tests (Jeff rule: real getProductGroup price only).
 */
export function pickDepartureAdultPrice(dep: UvDepartureForPricing): number {
  const byType = (t: number) => dep.groupPrice?.find((g) => g.priceType === t)?.groupPrice;
  // pt4 (兩人一房) → pt1 (成人). Never pt3 (over-quote) / pt5 / pt6 (under-quote).
  const adult = byType(4) ?? byType(1);
  return Math.round(Number(adult ?? 0) || 0);
}

/**
 * Headline 起價 = the LOWEST priceType=4 price across all future departures
 * (`從 $X 起`). 0 when no departure carries a usable price. Pure + exported.
 */
export function pickHeadlinePrice(departures: UvDepartureForPricing[]): number {
  return departures.reduce<number>((min, dep) => {
    const p = pickDepartureAdultPrice(dep);
    return p > 0 && (min === 0 || p < min) ? p : min;
  }, 0);
}

/** A tourDepartures-shaped row built from one synced mirror departure. */
export interface BuiltMirrorDeparture {
  departureDate: Date;
  returnDate: Date;
  adultPrice: number;
  totalSlots: number;
  bookedSlots: number;
  status: "open" | "full";
}

/**
 * Build one tourDepartures row from a synced `supplierDepartures.rawDepartureJson`
 * blob. The blob is the SAME shape as a live getProductGroup departure
 * (`groupDate` / `groupStock` / `groupSaleStock` / `groupPrice[]`), so this
 * reuses `pickDepartureAdultPrice` and produces departures identical to the
 * live importer — but from the mirror, with ZERO live re-fetch.
 *
 * Why this exists: the `supplierDepartures.retailPrice` COLUMN is polluted
 * (the sync stored priceType=3 / 單人 on some dates, pt4 on others), so it
 * cannot be trusted as the adult basis. The full tier list lives in
 * `rawDepartureJson`, so we re-derive pt4 (→ pt1) here.
 *
 * Returns null when: unparseable, no date, the departure is already in the
 * past (`< todayMs`), or there is no usable pt4/pt1 price — in which case we
 * SKIP the date rather than fall back to single-occupancy. Never over-quotes.
 * Pure + exported for unit tests.
 */
export function buildDepartureFromMirrorRow(
  rawDepartureJson: string | null | undefined,
  tripDays: number,
  todayMs: number,
): BuiltMirrorDeparture | null {
  if (!rawDepartureJson) return null;
  let dep: (UvDepartureForPricing & {
    groupDate?: string;
    groupStock?: number;
    groupSaleStock?: number;
  }) | null;
  try {
    dep = JSON.parse(rawDepartureJson);
  } catch {
    return null;
  }
  if (!dep || !dep.groupDate) return null;
  const dateStr = String(dep.groupDate).slice(0, 10);
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return null;
  const departureDate = new Date(year, month - 1, day, 8, 0, 0);
  if (departureDate.getTime() < todayMs) return null; // skip past departures
  // pt4 (兩人一房) → pt1 (成人). NEVER single-occupancy. Skip the date if neither.
  const adultPrice = pickDepartureAdultPrice(dep);
  if (adultPrice <= 0) return null;
  const returnDate = new Date(
    year,
    month - 1,
    day + Math.max(0, tripDays - 1),
    20,
    0,
    0,
  );
  const totalSeats = Number(dep.groupStock || 0);
  const sold = Number(dep.groupSaleStock || 0);
  const status: "open" | "full" =
    totalSeats > 0 && totalSeats - sold <= 0 ? "full" : "open";
  return {
    departureDate,
    returnDate,
    adultPrice,
    totalSlots: totalSeats > 0 ? totalSeats : 20,
    bookedSlots: Math.max(0, sold),
    status,
  };
}

/** Headline 起價 across already-built mirror departures (lowest adult price). */
export function headlineFromBuiltDepartures(
  deps: BuiltMirrorDeparture[],
): number {
  return deps.reduce<number>(
    (min, d) => (d.adultPrice > 0 && (min === 0 || d.adultPrice < min) ? d.adultPrice : min),
    0,
  );
}

/** Mirror of BulkImportResult from lionBulkImportService for parity. */
export interface UvBulkImportResult {
  productCode: string;
  success: boolean;
  tourId?: number;
  error?: string;
  title?: string;
  destinationCountry?: string;
  durationDays?: number;
}

export interface UvBulkImportBatchResult {
  total: number;
  imported: number;
  failed: number;
  durationMs: number;
  results: UvBulkImportResult[];
}

/**
 * Map UV's destination-name (city-level, e.g. "Vancouver") to a coarse
 * country bucket. UV's API doesn't expose ISO country code at the
 * product-list level — we lean on a name-substring map as good-enough
 * for routing into the right PACK&GO destination page.
 *
 * If the destination doesn't match any key, we fall back to the raw
 * destinationName as both country AND city (LLM rewrite will fix).
 */
function inferDestinationCountry(destinationName: string): string {
  const name = (destinationName || "").toLowerCase();
  // North America (the bulk of UV's catalog per the research PDF)
  if (/los angeles|san francisco|new york|las vegas|seattle|chicago|boston|orlando|miami|honolulu|hawaii|alaska/i.test(destinationName)) return "美國";
  if (/vancouver|toronto|montreal|banff|calgary|edmonton/i.test(destinationName)) return "加拿大";
  if (/mexico|cancun|cabo|tulum|puerto vallarta/i.test(destinationName)) return "墨西哥";
  // Asia
  if (/tokyo|osaka|kyoto|hokkaido|okinawa|nagoya|fukuoka/i.test(destinationName)) return "日本";
  if (/seoul|busan|jeju/i.test(destinationName)) return "韓國";
  if (/bangkok|phuket|chiang mai/i.test(destinationName)) return "泰國";
  if (/singapore/i.test(destinationName)) return "新加坡";
  if (/taipei|taichung|kaohsiung|taiwan/i.test(destinationName)) return "台灣";
  // Europe (less common in UV's catalog)
  if (/london|paris|rome|barcelona|amsterdam|berlin|zurich|prague|vienna|interlaken|munich/i.test(destinationName)) return "歐洲";
  // Oceania
  if (/sydney|melbourne|brisbane|auckland|queenstown/i.test(destinationName)) return "澳洲";
  // Unmappable: return "" rather than the raw city, so we NEVER store a
  // city/landmark as the destinationCountry (the "Cancún-as-country" bug).
  return "";
  void name; // satisfy unused-var lint
}

/**
 * Best-effort departure airport code derivation from the departure
 * city name. UV's product-list response includes departCityName but
 * not airport code; map common gateway cities here. Unmapped falls
 * back to empty (LLM rewrite will fill in).
 */
function deriveAirportCode(cityName: string): string {
  const city = (cityName || "").toLowerCase();
  const map: Record<string, string> = {
    "los angeles": "LAX",
    "san francisco": "SFO",
    "new york": "JFK",
    "seattle": "SEA",
    "chicago": "ORD",
    "boston": "BOS",
    "vancouver": "YVR",
    "toronto": "YYZ",
    taipei: "TPE",
    桃園: "TPE",
    "hong kong": "HKG",
    tokyo: "NRT",
  };
  return map[city] || "";
}

/**
 * Import one UV product as a draft tour.
 *
 * Returns success=false with a populated error string on any failure;
 * NEVER throws — the bulk caller relies on this to filter results.
 */
export async function importOneUvProduct(
  productCode: string,
  createdBy: number = 1
): Promise<UvBulkImportResult> {
  try {
    // Step 1: prefer the already-synced supplierProducts row (clean derived
    // fields: title/days/destinationCountry/destinationCity/departureCity/
    // imageUrl + enriched itineraryParsed). Pull travelDetail + departures
    // from the API in parallel. getProductMain is now only a last-resort
    // fallback for title (its response does NOT carry destinationName/
    // tempImageUrl/tripDay — casting them off it yielded undefined, which is
    // why imported tours had price/destination/days wrong).
    const [spRow, travelDetail, departures] = await Promise.all([
      readUvSupplierRow(productCode).catch(() => null),
      getProductTravelDetail(productCode).catch(() => null),
      getDeparturesNext180Days(productCode).catch(() => []),
    ]);

    // Title is required. Source of truth = supplierProducts row; fall back to
    // getProductMain only if the row is missing.
    let title = spRow?.title ?? null;
    if (!title) {
      const main = await getProductMain(productCode).catch(() => null);
      title = main?.productName ?? null;
    }
    if (!title) {
      return {
        productCode,
        success: false,
        error: "no title in supplierProducts row or getProductMain",
      };
    }

    const days = spRow?.days ?? 0;
    const nights = spRow?.nightDay ?? Math.max(0, days - 1);
    const departureCity = spRow?.departureCity || "Los Angeles";
    // destinationCountry already inferred + stored by the sync; only re-infer
    // from the city when the synced value is missing (the 11 NULL cases).
    const destinationCountry =
      spRow?.destinationCountry ||
      inferDestinationCountry(spRow?.destinationCity || "");
    const destinationCity = spRow?.destinationCity || destinationCountry;
    if (!destinationCountry) {
      return { productCode, success: false, error: "no derivable destinationCountry" };
    }
    const imageUrl = spRow?.imageUrl || null;

    // Headline price from SYNCED supplierDepartures.retailPrice (verified =
    // priceType=4 / pt1), live getProductGroup as fallback only. The live
    // re-fetch intermittently returned $0 for products that have a correct
    // synced price, so synced is the source of truth.
    const syncedHeadline = spRow?.supplierProductId
      ? await readSyncedHeadlinePrice(spRow.supplierProductId)
      : 0;
    const headlinePrice =
      syncedHeadline > 0 ? syncedHeadline : pickHeadlinePrice(departures);
    // Never build a $0 tour — no-price products are 去掉, not imported.
    if (headlinePrice <= 0) {
      return {
        productCode,
        success: false,
        error: "no usable price (synced + live both 0)",
      };
    }

    // dailyItinerary stop-gap blob for the LLM rewrite pass. Prefer the
    // enriched itineraryParsed (clean structure); fall back to the raw
    // travelDetail blob.
    const rawItineraryBlob =
      spRow?.itineraryParsed ||
      (travelDetail
        ? JSON.stringify({
            productTravel: (travelDetail as UvProductTravelDetail).productTravel,
            productNotice: (travelDetail as UvProductTravelDetail).productNotice,
            productCost: (travelDetail as UvProductTravelDetail).productCost,
            productShop: (travelDetail as UvProductTravelDetail).productShop,
          })
        : null);

    const tour = await createTour({
      title: title.slice(0, 200),
      description: "", // empty until LLM rewrite — keeps draft visibly unfinished
      productCode: productCode.slice(0, 100),
      departureCountry: "美國",
      departureCity,
      departureAirportCode: deriveAirportCode(departureCity),
      destinationCountry,
      destinationCity,
      duration: days,
      nights,
      price: Math.round(Number(headlinePrice) || 0),
      priceCurrency: "USD",
      heroImage: imageUrl,
      imageUrl,
      status: "draft",
      sourceUrl: `https://uvbookings.toursbms.com/en/product/detail/${productCode}`,
      dailyItinerary: rawItineraryBlob,
      createdBy,
    });

    // Step 2: insert departures with real bookedSlots.
    for (const dep of departures) {
      try {
        if (!dep.groupDate) continue;
        const dateStr = dep.groupDate.slice(0, 10);
        const [year, month, day] = dateStr.split("-").map(Number);
        if (!year || !month || !day) continue;
        const departureDate = new Date(year, month - 1, day, 8, 0, 0);
        const returnDate = new Date(
          year,
          month - 1,
          day + Math.max(0, days - 1),
          20,
          0,
          0
        );
        const totalSeats = Number(dep.groupStock || 0);
        const sold = Number(dep.groupSaleStock || 0);
        const bookedSlots = Math.max(0, sold);
        // priceType=4 (兩人一房) per-person basis; priceType=3 over-quotes ~30-37%.
        // Fall back to the synced headline so a live $0 never becomes a $0 departure.
        const adultPrice = pickDepartureAdultPrice(dep) || headlinePrice;
        const finalStatus: "open" | "full" =
          totalSeats > 0 && totalSeats - sold <= 0 ? "full" : "open";
        await createDeparture({
          tourId: tour.id,
          departureDate,
          returnDate,
          adultPrice,
          totalSlots: totalSeats > 0 ? totalSeats : 20,
          bookedSlots,
          status: finalStatus,
          currency: "USD",
          notes: `uvProductCode: ${productCode} · stockStatus: ${dep.stockStatus}`,
        });
      } catch {
        // individual departure failure shouldn't kill the import
      }
    }

    return {
      productCode,
      success: true,
      tourId: tour.id,
      title,
      destinationCountry,
      durationDays: days,
    };
  } catch (err) {
    const e = err as Error & { cause?: { sqlMessage?: string; code?: string } };
    const cause = e.cause;
    const causeMsg = cause?.sqlMessage || cause?.code;
    const fullMessage = causeMsg
      ? `${causeMsg} (${e.message?.slice(0, 200)})`
      : err instanceof SupplierApiError
        ? err.message
        : e.message || String(err);
    log.error(
      { productCode, err: fullMessage },
      "[uvBulkImport] importOneUvProduct failed",
    );
    return { productCode, success: false, error: fullMessage };
  }
}

/**
 * Bulk import N UV products in batches of 4 concurrent calls.
 * Concurrency = 4 matches lionBulkImportService.ts conventions.
 */
export async function bulkImportFromUv(input: {
  productCodes: string[];
  userId?: number;
}): Promise<UvBulkImportBatchResult> {
  const start = Date.now();
  const codes = input.productCodes;
  if (codes.length === 0) {
    return { total: 0, imported: 0, failed: 0, durationMs: 0, results: [] };
  }
  const createdBy = input.userId ?? 1;
  const concurrency = 4;
  const results: UvBulkImportResult[] = [];
  for (let i = 0; i < codes.length; i += concurrency) {
    const batch = codes.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((code) => importOneUvProduct(code, createdBy))
    );
    results.push(...batchResults);
  }
  const imported = results.filter((r) => r.success).length;
  const failed = results.length - imported;
  const durationMs = Date.now() - start;
  log.info(
    { imported, total: results.length, failed, durationMs },
    "[uvBulkImport] batch done",
  );
  return { total: results.length, imported, failed, durationMs, results };
}

/**
 * Queue a background LLM upgrade for tours that were bulk-imported.
 * Parallel to lionBulkImportService.queueRewriteForImportedTours.
 */
export async function queueRewriteForImportedUvTours(
  tourIds: number[],
  options: { userId?: number } = {}
): Promise<{ queued: number }> {
  const { userId = 1 } = options;
  let queued = 0;
  for (const tourId of tourIds) {
    try {
      const { getTourById } = await import("../db");
      const tour = await getTourById(tourId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const url = (tour as any)?.sourceUrl;
      if (!url) continue;
      const requestId = `rewrite_uv_${tourId}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      await tourGenerationQueue.add(
        "generate-tour",
        {
          url,
          userId,
          requestId,
          forceRegenerate: true,
          isPdf: false,
          // 2026-05-16: tell masterAgent to flip the source draft to
          // inactive on success so we don't accumulate stranded drafts.
          // Same flag the Lion bulk import sets.
          sourceDraftTourId: tourId,
        },
        { jobId: requestId }
      );
      queued++;
    } catch (err) {
      log.warn(
        { tourId, err: (err as Error).message },
        "[uvBulkImport] failed to queue rewrite",
      );
    }
  }
  return { queued };
}
