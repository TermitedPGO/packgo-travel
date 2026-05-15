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
  type UvProductMain,
  type UvProductTravelDetail,
} from "../suppliers/uvClient";
import { createTour, createDeparture } from "../db";
import { tourGenerationQueue } from "../queue";
import { SupplierApiError } from "../suppliers/types";

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
  return destinationName;
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
  productCode: string
): Promise<UvBulkImportResult> {
  try {
    // Step 1: pull product main + travel detail + departures in parallel.
    // Three concurrent API calls; each <1s on UV's gateway.
    const [main, travelDetail, departures] = await Promise.all([
      getProductMain(productCode).catch(() => null),
      getProductTravelDetail(productCode).catch(() => null),
      getDeparturesNext180Days(productCode).catch(() => []),
    ]);

    // Need at least the main response for required fields.
    if (!main || !main.productName) {
      return {
        productCode,
        success: false,
        error: "getProductMain returned null or missing productName",
      };
    }

    // Pull a few denormalized fields from rawProductJson in the
    // supplierProducts row that the sync service already wrote. We
    // don't have a direct dependency on supplierProducts here — the
    // info we need from the list-API row (destinationName,
    // departCityName, tempImageUrl) is duplicated in the per-product
    // detail call, so re-derive instead.
    const productMain = main as UvProductMain & {
      destinationName?: string;
      departCityName?: string;
      tempImageUrl?: string;
      tripDay?: number;
      nightDay?: number;
      groupLatelyPrice?: number;
    };

    const destinationName = productMain.destinationName || "";
    const departureCity = productMain.departCityName || "Los Angeles";
    const days = productMain.tripDay ?? 0;
    const nights = productMain.nightDay ?? Math.max(0, days - 1);

    // Most-recent groupLatelyPrice as the headline price; fallback to
    // the first adult-price slot in the departures we pulled.
    const headlinePrice =
      productMain.groupLatelyPrice ||
      departures[0]?.groupPrice?.find((p) => p.priceType === 3)?.groupPrice ||
      departures[0]?.groupPrice?.[0]?.groupPrice ||
      0;

    const destinationCountry = inferDestinationCountry(destinationName);

    // Pack a JSON blob of raw UV detail into the dailyItinerary field
    // as a stop-gap; the LLM rewrite pass will replace this with
    // properly structured day-by-day content.
    const rawItineraryBlob = travelDetail
      ? JSON.stringify({
          productTravel: (travelDetail as UvProductTravelDetail).productTravel,
          productNotice: (travelDetail as UvProductTravelDetail).productNotice,
          productCost: (travelDetail as UvProductTravelDetail).productCost,
          productShop: (travelDetail as UvProductTravelDetail).productShop,
        })
      : null;

    const tourRecord = {
      title: productMain.productName.slice(0, 200),
      description: "", // empty until LLM rewrite — keeps draft visibly unfinished
      productCode: productCode.slice(0, 100),
      departureCountry: "美國",
      departureCity,
      departureAirportCode: deriveAirportCode(departureCity),
      destinationCountry,
      destinationCity: destinationName || destinationCountry,
      duration: days,
      nights,
      price: Math.round(Number(headlinePrice) || 0),
      priceCurrency: "USD",
      heroImage: productMain.tempImageUrl,
      imageUrl: productMain.tempImageUrl,
      status: "draft" as const,
      isFeatured: false,
      qaStatus: "needs_review",
      qaScore: 0,
      qaIssues: JSON.stringify([
        {
          type: "info",
          message: "從 UV Bookings 整批匯入 — 需要 LLM 升級為 PACK&GO 風格",
        },
      ]),
      sourceUrl: `https://uvbookings.toursbms.com/en/product/detail/${productCode}`,
      sourceProvider: "uvbookings",
      dailyItinerary: rawItineraryBlob,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const tour = await createTour(tourRecord);

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
        const adult = dep.groupPrice?.find((p) => p.priceType === 3);
        const adultPrice = Math.round(
          adult?.groupPrice ?? dep.groupPrice?.[0]?.groupPrice ?? 0
        );
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
      title: productMain.productName,
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
    console.error(
      `[uvBulkImport] importOneUvProduct ${productCode} failed:`,
      fullMessage
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
}): Promise<UvBulkImportBatchResult> {
  const start = Date.now();
  const codes = input.productCodes;
  if (codes.length === 0) {
    return { total: 0, imported: 0, failed: 0, durationMs: 0, results: [] };
  }
  const concurrency = 4;
  const results: UvBulkImportResult[] = [];
  for (let i = 0; i < codes.length; i += concurrency) {
    const batch = codes.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(importOneUvProduct));
    results.push(...batchResults);
  }
  const imported = results.filter((r) => r.success).length;
  const failed = results.length - imported;
  const durationMs = Date.now() - start;
  console.log(
    `[uvBulkImport] Imported ${imported}/${results.length} tours in ${durationMs}ms` +
      (failed ? ` (${failed} failed)` : "")
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
        },
        { jobId: requestId }
      );
      queued++;
    } catch (err) {
      console.warn(
        `[uvBulkImport] Failed to queue rewrite for tour ${tourId}:`,
        err
      );
    }
  }
  return { queued };
}
