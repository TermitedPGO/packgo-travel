/**
 * supplierSync/sharedDetail — rate-limit + retry + upsert helpers used
 * by lionDetail.ts and uvDetail.ts. Stage 1 of supplier deep sync
 * (migration 0083, design.md §3.1).
 *
 * Why separate from `shared.ts`?
 *   - `shared.ts` covers the existing list-sync flow (search/list APIs)
 *   - `sharedDetail.ts` covers the new per-product detail-fetch flow
 *   - Keeping them apart means changing rate-limit behavior for detail
 *     fetches (which hit 5+ endpoints per product) doesn't affect the
 *     cheap once-a-day list pulls.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  supplierProductDetails as detailsTable,
  type InsertSupplierProductDetail,
} from "../../../drizzle/schema";
import { jitter } from "./shared";
import type {
  DetailKind,
  EnrichmentResult,
  ParseStatus,
  ProductEnrichment,
} from "./types";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "supplierSync/sharedDetail" });

/* ─────────────────── Rate-limit + retry ─────────────────── */

/**
 * Wrap a single supplier API call with politeness sleep BEFORE the call
 * and a label for log/observability. The sleep prevents detail-fetch
 * bursts from triggering supplier rate-limiters.
 *
 * Defaults match design.md §8 D3: 2 sec/call avg, with ±500ms jitter.
 */
export async function rateLimitedCall<T>(
  fn: () => Promise<T>,
  label: string,
  minMs = 1500,
  maxMs = 2500
): Promise<T> {
  await jitter(minMs, maxMs);
  log.debug({ label }, "rate-limited call");
  return fn();
}

/**
 * Retry a function with exponential backoff. Used for transient errors
 * (network blips, 5xx). Bails immediately on 4xx (caller's fault, won't
 * fix itself).
 *
 * @param fn       The async fn to retry.
 * @param maxAttempts Total attempts including first (default 3 = 1 + 2 retries).
 * @param baseMs   First retry delay (doubles each attempt).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseMs = 1000
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // If it looks like a 4xx (caller error), don't retry
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b4\d\d\b/.test(msg) && !/\b408\b|\b429\b/.test(msg)) {
        log.warn({ msg, attempt }, "non-retriable error, giving up");
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = baseMs * Math.pow(2, attempt - 1);
        log.warn(
          { msg, attempt, nextDelayMs: delay },
          "transient error, retrying"
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/* ─────────────────── Result helpers ─────────────────── */

/** Build a successful result. */
export function ok(
  kind: DetailKind,
  raw: unknown,
  parsed: EnrichmentResult["parsed"]
): EnrichmentResult {
  return {
    kind,
    raw: raw == null ? null : JSON.stringify(raw),
    parsed,
    status: parsed == null ? "parse_failed" : "parsed",
    fetchedAt: new Date(),
  };
}

/** Build a failed-fetch result (API call threw). */
export function fail(kind: DetailKind, err: unknown): EnrichmentResult {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    kind,
    raw: null,
    parsed: null,
    status: "parse_failed",
    fetchedAt: new Date(),
    errorMessage: msg.slice(0, 500),
  };
}

/** Build a missing result (supplier has no equivalent endpoint). */
export function missing(kind: DetailKind): EnrichmentResult {
  return {
    kind,
    raw: null,
    parsed: null,
    status: "missing",
    fetchedAt: new Date(),
  };
}

/* ─────────────────── Upsert ─────────────────── */

/**
 * Upsert one `supplierProductDetails` row with all 5 enrichment results.
 * Idempotent: rerunning with newer data updates raw/parsed/status; never
 * inserts duplicates (UNIQUE on supplierProductId).
 */
export async function upsertProductDetail(
  supplierProductId: number,
  supplierId: number,
  enrichment: ProductEnrichment
): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.error("upsertProductDetail: no DB connection");
    return;
  }

  const row: InsertSupplierProductDetail = {
    supplierProductId,
    supplierId,

    itineraryRaw: enrichment.itinerary.raw,
    itineraryParsed: enrichment.itinerary.parsed
      ? JSON.stringify(enrichment.itinerary.parsed)
      : null,
    itineraryFetchedAt: enrichment.itinerary.fetchedAt,
    itineraryParseStatus: enrichment.itinerary.status,

    priceTermsRaw: enrichment.priceTerms.raw,
    priceTermsParsed: enrichment.priceTerms.parsed
      ? JSON.stringify(enrichment.priceTerms.parsed)
      : null,
    priceTermsFetchedAt: enrichment.priceTerms.fetchedAt,
    priceTermsParseStatus: enrichment.priceTerms.status,

    noticesRaw: enrichment.notices.raw,
    noticesParsed: enrichment.notices.parsed
      ? JSON.stringify(enrichment.notices.parsed)
      : null,
    noticesFetchedAt: enrichment.notices.fetchedAt,
    noticesParseStatus: enrichment.notices.status,

    optionalRaw: enrichment.optional.raw,
    optionalParsed: enrichment.optional.parsed
      ? JSON.stringify(enrichment.optional.parsed)
      : null,
    optionalFetchedAt: enrichment.optional.fetchedAt,
    optionalParseStatus: enrichment.optional.status,

    tourInfoRaw: enrichment.tourInfo.raw,
    tourInfoParsed: enrichment.tourInfo.parsed
      ? JSON.stringify(enrichment.tourInfo.parsed)
      : null,
    tourInfoFetchedAt: enrichment.tourInfo.fetchedAt,
    tourInfoParseStatus: enrichment.tourInfo.status,

    lastEnrichedAt: new Date(),
  };

  await db
    .insert(detailsTable)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        itineraryRaw: row.itineraryRaw,
        itineraryParsed: row.itineraryParsed,
        itineraryFetchedAt: row.itineraryFetchedAt,
        itineraryParseStatus: row.itineraryParseStatus,

        priceTermsRaw: row.priceTermsRaw,
        priceTermsParsed: row.priceTermsParsed,
        priceTermsFetchedAt: row.priceTermsFetchedAt,
        priceTermsParseStatus: row.priceTermsParseStatus,

        noticesRaw: row.noticesRaw,
        noticesParsed: row.noticesParsed,
        noticesFetchedAt: row.noticesFetchedAt,
        noticesParseStatus: row.noticesParseStatus,

        optionalRaw: row.optionalRaw,
        optionalParsed: row.optionalParsed,
        optionalFetchedAt: row.optionalFetchedAt,
        optionalParseStatus: row.optionalParseStatus,

        tourInfoRaw: row.tourInfoRaw,
        tourInfoParsed: row.tourInfoParsed,
        tourInfoFetchedAt: row.tourInfoFetchedAt,
        tourInfoParseStatus: row.tourInfoParseStatus,

        lastEnrichedAt: row.lastEnrichedAt,
        enrichmentRunCount: sql`${detailsTable.enrichmentRunCount} + 1`,
      },
    });

  log.info(
    {
      supplierProductId,
      supplierId,
      itinerary: enrichment.itinerary.status,
      priceTerms: enrichment.priceTerms.status,
      notices: enrichment.notices.status,
      optional: enrichment.optional.status,
      tourInfo: enrichment.tourInfo.status,
    },
    "upserted product detail"
  );
}
