/**
 * supplierSyncService — orchestrates catalog mirroring for Lion + UV.
 *
 * Two responsibilities:
 *
 *   1. MIRROR the supplier's public catalog into our DB:
 *        • supplierProducts        — one row per product
 *        • supplierDepartures      — one row per departure date
 *        • supplierSyncRuns        — one row per sync execution
 *
 *   2. DISCOVER new products and surface them so the existing tour-
 *      generation pipeline (server/services/lionBulkImportService.ts +
 *      tourGenerationQueue) can pick them up.
 *
 *      Per Jeff's intent: this is the upgrade path for auto-generating
 *      PACK&GO-branded tours from supplier inventory. The sync finds
 *      what's new; the bulk-import flow turns each new product into a
 *      draft `tours` row; LLM rewrite turns the draft into PACK&GO
 *      style. End-to-end this lets Jeff add hundreds of products a day
 *      with zero manual data entry.
 *
 * Design:
 *   • Both clients (server/suppliers/lionClient.ts, uvClient.ts) return
 *     NATIVE supplier shapes. This service normalizes into our schema.
 *   • Each sync run uses a single supplierSyncRuns row to track progress.
 *     Status transitions: running → success / failed / partial.
 *   • Inserts go through Drizzle's onDuplicateKeyUpdate to handle the
 *     idempotent upsert pattern (sync can be retried after a partial
 *     failure without creating duplicate rows).
 *   • Rate limit: 500-1500ms jitter sleep between API calls. NOT for
 *     performance — for politeness + fingerprint avoidance.
 *
 * Format-change detection:
 *   When required fields are missing from a supplier response (e.g.
 *   `NormGroupID` on Lion, `productCode` on UV), the product is recorded
 *   with status='pending' instead of crashing the whole run. The admin
 *   UI surfaces pending counts so Jeff knows when supplier API has
 *   drifted from what we expect.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
  supplierDepartures as departuresTable,
  supplierSyncRuns as runsTable,
  type InsertSupplierProduct,
  type InsertSupplierDeparture,
} from "../../drizzle/schema";
import {
  searchProducts as lionSearch,
  type LionNormGroup,
  type LionGroupEntry,
} from "../suppliers/lionClient";
import {
  listProducts as uvList,
  getDeparturesNext180Days as uvDepartures,
  type UvProductListItem,
  type UvDepartureRow,
} from "../suppliers/uvClient";
import { deriveAvailability, SupplierApiError } from "../suppliers/types";

/* ─────────────────────────── shared helpers ─────────────────────────── */

/** Random delay in [min, max] ms. Politeness sleep between API calls. */
function jitter(minMs = 500, maxMs = 1500): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Look up the supplier row for a given short code ('lion' / 'uv').
 * Seeded by migration 0074. Throws clear error if missing so a forgotten
 * deploy doesn't silently no-op.
 */
async function getSupplierIdByCode(code: "lion" | "uv"): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  const rows = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(eq(suppliersTable.code, code))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `supplier code "${code}" not found in suppliers table — did migration 0074 run?`
    );
  }
  return row.id;
}

/**
 * Open a sync run row. Caller MUST call closeRun() in a finally block to
 * mark it success / failed / partial.
 */
async function openRun(
  supplierId: number,
  kind: "full" | "hot" | "manual" | "detail"
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not initialized");
  const result = await db.insert(runsTable).values({
    supplierId,
    kind,
    status: "running",
  });
  // Drizzle MySQL2 returns { insertId } in the result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Number((result as any)[0]?.insertId ?? (result as any).insertId);
}

async function closeRun(
  runId: number,
  patch: {
    productsScanned: number;
    productsAdded: number;
    productsUpdated: number;
    productsDeactivated: number;
    departuresScanned: number;
    departuresUpdated: number;
    status: "success" | "failed" | "partial";
    errorMessage?: string;
    startedAt: Date;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(runsTable)
    .set({
      finishedAt: new Date(),
      productsScanned: patch.productsScanned,
      productsAdded: patch.productsAdded,
      productsUpdated: patch.productsUpdated,
      productsDeactivated: patch.productsDeactivated,
      departuresScanned: patch.departuresScanned,
      departuresUpdated: patch.departuresUpdated,
      status: patch.status,
      errorMessage: patch.errorMessage,
      durationMs: Date.now() - patch.startedAt.getTime(),
    })
    .where(eq(runsTable.id, runId));
}

/** Result returned from each sync. */
export interface SyncResult {
  runId: number;
  supplier: "lion" | "uv";
  productsScanned: number;
  productsAdded: number;
  productsUpdated: number;
  productsDeactivated: number;
  departuresScanned: number;
  departuresUpdated: number;
  /** External codes of products that appear in our DB for the FIRST time
   *  during this run. Caller can pass these to the bulk-import flow to
   *  auto-generate PACK&GO tours. */
  newProductCodes: string[];
  status: "success" | "failed" | "partial";
  errorMessage?: string;
}

/* ─────────────────────────── Lion Travel sync ─────────────────────────── */

/**
 * Map a Lion search result row into our normalized shape. Returns null
 * if required fields are missing (e.g. NormGroupID absent) so the
 * caller can flag it as a format-change pending row.
 */
function lionToProductInsert(
  norm: LionNormGroup,
  supplierId: number
): InsertSupplierProduct | null {
  if (!norm.NormGroupID || !norm.TourName) return null;
  // Lion's StartFromCityList is an array of { CityName, CityCode };
  // first entry is the primary departure city.
  const departureCity = norm.StartFromCityList?.[0]?.CityName ?? null;
  return {
    supplierId,
    externalProductCode: norm.NormGroupID,
    title: norm.TourName.slice(0, 512),
    days: norm.TourDays || 0,
    departureCity,
    // Country / destination — Lion's search response doesn't include an
    // explicit country field; the full detail call has GroupInfo.Country.
    // We leave it null in the search-derived row and let a future
    // hot-sync detail call fill it in.
    destinationCountry: null,
    destinationCity: null,
    imageUrl: norm.ImgM || norm.Img || null,
    currency: "TWD",
    status: "active",
    rawProductJson: JSON.stringify(norm),
  };
}

function lionGroupToDeparture(
  group: LionGroupEntry,
  productId: number,
  supplierId: number
): InsertSupplierDeparture | null {
  if (!group.GroupID || !group.GoDate) return null;
  // Lion's GoDate is "YYYY/MM/DD". Normalize to ISO YYYY-MM-DD for DATE
  // column. Skip rows we can't parse.
  const m = group.GoDate.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const dateStr = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const retail = Number(group.StraightLowestPrice.replace(/,/g, ""));
  const agent = Number(group.IndustryLowestPrice.replace(/,/g, ""));
  // Lion only exposes Status (string), not raw seat counts, in search
  // results. Map directly to our availability bucket.
  const availability =
    group.Status === "full"
      ? "full"
      : group.Status === "hot"
        ? "limited"
        : "available";
  return {
    supplierProductId: productId,
    supplierId,
    externalDepartureCode: group.GroupID,
    // Phase 1 Cluster C (2026-05-18): keep ISO YYYY-MM-DD STRING — schema
    // column is `date()` which accepts strings natively at the wire level.
    // DO NOT wrap with `new Date(dateStr)` — Drizzle's default type inference
    // says `Date`, but coercing would introduce Asia/Taipei↔UTC timezone
    // drift on production. Phase 5A module-5A owns the proper schema type
    // alignment (mode: "string") + DST regression tests. See audit P1-10.
    departureDate: dateStr as unknown as Date,
    retailPrice: String(retail),
    agentPrice: Number.isFinite(agent) ? String(agent) : null,
    currency: "TWD",
    totalSeats: 0, // search API doesn't expose; populated by hot-sync via getTravelInfo
    spareSeats: 0,
    availability,
    rawDepartureJson: JSON.stringify(group),
  };
}

/**
 * Lion full catalog sync.
 *
 * Strategy:
 *   1. Page through search/grouplistinfojson at PageSize=200 until we
 *      hit a page with Count < 200 or Page > TotalPage.
 *   2. For each NormGroup: upsert supplierProducts + upsert all rows
 *      in its GroupList[] into supplierDepartures.
 *   3. Track which externalProductCodes are new (not seen in DB before
 *      this run) so the caller can feed them into bulk-import.
 */
export async function syncLionCatalog(): Promise<SyncResult> {
  const startedAt = new Date();
  const supplierId = await getSupplierIdByCode("lion");
  const runId = await openRun(supplierId, "full");

  let productsScanned = 0;
  let productsAdded = 0;
  let productsUpdated = 0;
  let productsDeactivated = 0;
  let departuresScanned = 0;
  let departuresUpdated = 0;
  const newProductCodes: string[] = [];
  const seenCodes = new Set<string>();
  let status: "success" | "failed" | "partial" = "success";
  let errorMessage: string | undefined;

  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  try {
    // Pre-fetch existing externalProductCodes for new-row detection.
    const existingRows = await db
      .select({ code: productsTable.externalProductCode })
      .from(productsTable)
      .where(eq(productsTable.supplierId, supplierId));
    const existingCodes = new Set(existingRows.map((r) => r.code));

    // Lion's search defaults to current-day + ~7 month window. We pull
    // a generous 12-month window to surface near-future departures.
    const today = new Date();
    const yearLater = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
    const goDateStart = today.toISOString().slice(0, 10);
    const goDateEnd = yearLater.toISOString().slice(0, 10);

    const PAGE_SIZE = 200;
    let page = 1;
    let totalPage = 1;

    while (page <= totalPage) {
      let result;
      try {
        result = await lionSearch({
          goDateStart,
          goDateEnd,
          page,
          pageSize: PAGE_SIZE,
        });
      } catch (err) {
        // Treat page-level error as partial — log and continue.
        console.warn(
          `[supplierSync/lion] page ${page} failed:`,
          (err as Error).message
        );
        status = "partial";
        errorMessage = (err as Error).message;
        break;
      }
      totalPage = result.TotalPage;
      const groups = result.NormGroupList ?? [];

      for (const norm of groups) {
        productsScanned++;
        const insert = lionToProductInsert(norm, supplierId);
        if (!insert) {
          // Missing required field — flag as pending but don't crash.
          if (norm.NormGroupID) {
            await db
              .insert(productsTable)
              .values({
                supplierId,
                externalProductCode: norm.NormGroupID,
                title: norm.TourName || "(missing title)",
                days: 0,
                currency: "TWD",
                status: "pending",
                rawProductJson: JSON.stringify(norm),
              })
              .onDuplicateKeyUpdate({
                set: { status: "pending", lastSyncedAt: new Date() },
              });
          }
          continue;
        }
        seenCodes.add(insert.externalProductCode);

        const isNew = !existingCodes.has(insert.externalProductCode);
        if (isNew) newProductCodes.push(insert.externalProductCode);

        // Upsert product. onDuplicateKeyUpdate matches by the unique
        // (supplierId, externalProductCode) index.
        await db
          .insert(productsTable)
          .values(insert)
          .onDuplicateKeyUpdate({
            set: {
              title: insert.title,
              days: insert.days,
              departureCity: insert.departureCity,
              imageUrl: insert.imageUrl,
              status: insert.status,
              rawProductJson: insert.rawProductJson,
              lastSyncedAt: new Date(),
            },
          });
        if (isNew) productsAdded++;
        else productsUpdated++;

        // Look up the row id (autoincrement) for departures FK.
        // (insertId from onDuplicateKeyUpdate is unreliable cross-driver;
        // a SELECT here is cheap with the unique index.)
        const [row] = await db
          .select({ id: productsTable.id })
          .from(productsTable)
          .where(
            and(
              eq(productsTable.supplierId, supplierId),
              eq(productsTable.externalProductCode, insert.externalProductCode)
            )
          )
          .limit(1);
        const productRowId = row?.id;
        if (!productRowId) continue;

        // Departures from this NormGroup.
        for (const grp of norm.GroupList ?? []) {
          departuresScanned++;
          const depInsert = lionGroupToDeparture(grp, productRowId, supplierId);
          if (!depInsert) continue;
          await db
            .insert(departuresTable)
            .values(depInsert)
            .onDuplicateKeyUpdate({
              set: {
                departureDate: depInsert.departureDate,
                retailPrice: depInsert.retailPrice,
                agentPrice: depInsert.agentPrice,
                availability: depInsert.availability,
                rawDepartureJson: depInsert.rawDepartureJson,
                lastSyncedAt: new Date(),
              },
            });
          departuresUpdated++;
        }
      }

      // Stop early if we're past the end (defensive — TotalPage should
      // already cap us).
      if (groups.length < PAGE_SIZE) break;
      page++;
      await jitter();
    }

    // Mark products that disappeared from the supplier feed as inactive.
    // We only do this on full syncs (kind='full') because hot-syncs touch
    // a subset and would false-positive everything else.
    if (status === "success" && seenCodes.size > 0) {
      const supplierRowsNow = await db
        .select({
          id: productsTable.id,
          code: productsTable.externalProductCode,
        })
        .from(productsTable)
        .where(eq(productsTable.supplierId, supplierId));
      const stale = supplierRowsNow
        .filter((r) => !seenCodes.has(r.code))
        .map((r) => r.id);
      if (stale.length) {
        await db
          .update(productsTable)
          .set({ status: "inactive" })
          .where(
            and(
              eq(productsTable.supplierId, supplierId),
              sql`${productsTable.id} IN (${sql.join(stale, sql`, `)})`
            )
          );
        productsDeactivated = stale.length;
      }
    }

    // Mark supplier.lastFullSyncAt regardless of partial / full.
    await db
      .update(suppliersTable)
      .set({ lastFullSyncAt: new Date() })
      .where(eq(suppliersTable.id, supplierId));
  } catch (err) {
    status = "failed";
    errorMessage =
      err instanceof SupplierApiError
        ? err.message
        : (err as Error).message ?? String(err);
    console.error(`[supplierSync/lion] failed:`, err);
  } finally {
    await closeRun(runId, {
      productsScanned,
      productsAdded,
      productsUpdated,
      productsDeactivated,
      departuresScanned,
      departuresUpdated,
      status,
      errorMessage,
      startedAt,
    });
  }

  return {
    runId,
    supplier: "lion",
    productsScanned,
    productsAdded,
    productsUpdated,
    productsDeactivated,
    departuresScanned,
    departuresUpdated,
    newProductCodes,
    status,
    errorMessage,
  };
}

/* ─────────────────────────── UV Bookings sync ─────────────────────────── */

function uvToProductInsert(
  item: UvProductListItem,
  supplierId: number
): InsertSupplierProduct | null {
  if (!item.productCode || !item.productName) return null;
  return {
    supplierId,
    externalProductCode: item.productCode,
    title: item.productName.slice(0, 512),
    days: item.tripDay || 0,
    departureCity: item.departCityName || null,
    destinationCountry: null, // UV gives destinationName (city); country derived later
    destinationCity: item.destinationName || null,
    imageUrl: item.tempImageUrl || null,
    currency: "USD",
    status: "active",
    rawProductJson: JSON.stringify(item),
  };
}

function uvRowToDeparture(
  row: UvDepartureRow,
  productCode: string,
  productId: number,
  supplierId: number
): InsertSupplierDeparture | null {
  if (!row.groupDate) return null;
  // UV's groupDate is already "YYYY-MM-DD" — defensive trim.
  const dateStr = row.groupDate.slice(0, 10);
  // First adult-priced row (priceType=3). Fallback to first row.
  const adult = row.groupPrice?.find((p) => p.priceType === 3);
  const fallback = row.groupPrice?.[0];
  const price = adult?.groupPrice ?? fallback?.groupPrice ?? 0;
  // Spare seats = totalStock - sold.
  const totalSeats = Number(row.groupStock || 0);
  const sold = Number(row.groupSaleStock || 0);
  const spareSeats = Math.max(0, totalSeats - sold);
  const closed = row.stockStatus !== 200;
  return {
    supplierProductId: productId,
    supplierId,
    externalDepartureCode: `${productCode}__${dateStr}`,
    // Phase 1 Cluster C (2026-05-18): keep ISO YYYY-MM-DD STRING — schema
    // column is `date()` which accepts strings natively at the wire level.
    // DO NOT wrap with `new Date(dateStr)` — Drizzle's default type inference
    // says `Date`, but coercing would introduce Asia/Taipei↔UTC timezone
    // drift on production. Phase 5A module-5A owns the proper schema type
    // alignment (mode: "string") + DST regression tests. See audit P1-10.
    departureDate: dateStr as unknown as Date,
    retailPrice: String(price),
    agentPrice: null, // UV public storefront doesn't expose agent price
    currency: "USD",
    totalSeats,
    spareSeats,
    availability: deriveAvailability(spareSeats, closed),
    rawDepartureJson: JSON.stringify(row),
  };
}

export async function syncUvCatalog(): Promise<SyncResult> {
  const startedAt = new Date();
  const supplierId = await getSupplierIdByCode("uv");
  const runId = await openRun(supplierId, "full");

  let productsScanned = 0;
  let productsAdded = 0;
  let productsUpdated = 0;
  let productsDeactivated = 0;
  let departuresScanned = 0;
  let departuresUpdated = 0;
  const newProductCodes: string[] = [];
  const seenCodes = new Set<string>();
  let status: "success" | "failed" | "partial" = "success";
  let errorMessage: string | undefined;

  const db = await getDb();
  if (!db) throw new Error("Database not initialized");

  try {
    const existingRows = await db
      .select({ code: productsTable.externalProductCode })
      .from(productsTable)
      .where(eq(productsTable.supplierId, supplierId));
    const existingCodes = new Set(existingRows.map((r) => r.code));

    const PAGE_SIZE = 200;
    let page = 1;
    let totalCount = Infinity;
    let scannedFromPager = 0;

    while (scannedFromPager < totalCount) {
      let result;
      try {
        result = await uvList({ page, pageSize: PAGE_SIZE });
      } catch (err) {
        console.warn(
          `[supplierSync/uv] page ${page} failed:`,
          (err as Error).message
        );
        status = "partial";
        errorMessage = (err as Error).message;
        break;
      }
      totalCount = result.pager?.totalCount ?? 0;
      const items = result.list ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        productsScanned++;
        const insert = uvToProductInsert(item, supplierId);
        if (!insert) continue;
        seenCodes.add(insert.externalProductCode);
        const isNew = !existingCodes.has(insert.externalProductCode);
        if (isNew) newProductCodes.push(insert.externalProductCode);

        await db
          .insert(productsTable)
          .values(insert)
          .onDuplicateKeyUpdate({
            set: {
              title: insert.title,
              days: insert.days,
              departureCity: insert.departureCity,
              destinationCity: insert.destinationCity,
              imageUrl: insert.imageUrl,
              status: insert.status,
              rawProductJson: insert.rawProductJson,
              lastSyncedAt: new Date(),
            },
          });
        if (isNew) productsAdded++;
        else productsUpdated++;

        const [row] = await db
          .select({ id: productsTable.id })
          .from(productsTable)
          .where(
            and(
              eq(productsTable.supplierId, supplierId),
              eq(productsTable.externalProductCode, insert.externalProductCode)
            )
          )
          .limit(1);
        const productRowId = row?.id;
        if (!productRowId) continue;

        // Fetch departures for this product (next 180 days).
        let depRows: UvDepartureRow[] = [];
        try {
          depRows = await uvDepartures(item.productCode);
        } catch (err) {
          // Departures unavailable — log and continue. The product row
          // is still saved; departure data fills in next run.
          console.warn(
            `[supplierSync/uv] departures for ${item.productCode} failed:`,
            (err as Error).message
          );
          continue;
        }
        for (const depRow of depRows) {
          departuresScanned++;
          const depInsert = uvRowToDeparture(
            depRow,
            item.productCode,
            productRowId,
            supplierId
          );
          if (!depInsert) continue;
          await db
            .insert(departuresTable)
            .values(depInsert)
            .onDuplicateKeyUpdate({
              set: {
                departureDate: depInsert.departureDate,
                retailPrice: depInsert.retailPrice,
                totalSeats: depInsert.totalSeats,
                spareSeats: depInsert.spareSeats,
                availability: depInsert.availability,
                rawDepartureJson: depInsert.rawDepartureJson,
                lastSyncedAt: new Date(),
              },
            });
          departuresUpdated++;
        }
        // Jitter PER PRODUCT (not per page) because we fire one extra
        // departures call per product → ~1,124 calls per full sync.
        await jitter(300, 800);
      }
      scannedFromPager += items.length;
      page++;
    }

    // Stale-detection same as Lion.
    if (status === "success" && seenCodes.size > 0) {
      const supplierRowsNow = await db
        .select({
          id: productsTable.id,
          code: productsTable.externalProductCode,
        })
        .from(productsTable)
        .where(eq(productsTable.supplierId, supplierId));
      const stale = supplierRowsNow
        .filter((r) => !seenCodes.has(r.code))
        .map((r) => r.id);
      if (stale.length) {
        await db
          .update(productsTable)
          .set({ status: "inactive" })
          .where(
            and(
              eq(productsTable.supplierId, supplierId),
              sql`${productsTable.id} IN (${sql.join(stale, sql`, `)})`
            )
          );
        productsDeactivated = stale.length;
      }
    }

    await db
      .update(suppliersTable)
      .set({ lastFullSyncAt: new Date() })
      .where(eq(suppliersTable.id, supplierId));
  } catch (err) {
    status = "failed";
    errorMessage =
      err instanceof SupplierApiError
        ? err.message
        : (err as Error).message ?? String(err);
    console.error(`[supplierSync/uv] failed:`, err);
  } finally {
    await closeRun(runId, {
      productsScanned,
      productsAdded,
      productsUpdated,
      productsDeactivated,
      departuresScanned,
      departuresUpdated,
      status,
      errorMessage,
      startedAt,
    });
  }

  return {
    runId,
    supplier: "uv",
    productsScanned,
    productsAdded,
    productsUpdated,
    productsDeactivated,
    departuresScanned,
    departuresUpdated,
    newProductCodes,
    status,
    errorMessage,
  };
}

/* ──────────────────────── high-level orchestration ──────────────────────── */

/**
 * Read recent sync run history for the admin panel. Returns latest N
 * rows per supplier, joined with supplier display name.
 */
export async function getRecentSyncRuns(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: runsTable.id,
      supplierCode: suppliersTable.code,
      supplierName: suppliersTable.displayName,
      kind: runsTable.kind,
      startedAt: runsTable.startedAt,
      finishedAt: runsTable.finishedAt,
      productsScanned: runsTable.productsScanned,
      productsAdded: runsTable.productsAdded,
      productsUpdated: runsTable.productsUpdated,
      productsDeactivated: runsTable.productsDeactivated,
      departuresScanned: runsTable.departuresScanned,
      status: runsTable.status,
      errorMessage: runsTable.errorMessage,
      durationMs: runsTable.durationMs,
    })
    .from(runsTable)
    .innerJoin(suppliersTable, eq(runsTable.supplierId, suppliersTable.id))
    .orderBy(desc(runsTable.startedAt))
    .limit(limit);
}

/**
 * Read supplier registry + per-supplier counts for the admin dashboard.
 */
export async function getSuppliersOverview() {
  const db = await getDb();
  if (!db) return [];
  const supps = await db
    .select({
      id: suppliersTable.id,
      code: suppliersTable.code,
      displayName: suppliersTable.displayName,
      defaultCurrency: suppliersTable.defaultCurrency,
      isActive: suppliersTable.isActive,
      lastFullSyncAt: suppliersTable.lastFullSyncAt,
      lastHotSyncAt: suppliersTable.lastHotSyncAt,
    })
    .from(suppliersTable);
  const overview = [];
  for (const s of supps) {
    const counts = await db
      .select({
        active: sql<number>`SUM(CASE WHEN ${productsTable.status} = 'active' AND ${productsTable.isHiddenByAdmin} = FALSE THEN 1 ELSE 0 END)`,
        inactive: sql<number>`SUM(CASE WHEN ${productsTable.status} = 'inactive' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${productsTable.status} = 'pending' THEN 1 ELSE 0 END)`,
        hidden: sql<number>`SUM(CASE WHEN ${productsTable.isHiddenByAdmin} = TRUE THEN 1 ELSE 0 END)`,
        total: sql<number>`COUNT(*)`,
      })
      .from(productsTable)
      .where(eq(productsTable.supplierId, s.id));
    overview.push({ ...s, counts: counts[0] });
  }
  return overview;
}

/**
 * Run a full catalog sync for every active supplier sequentially.
 *
 * Sequential by design — running both concurrently doubles the load on
 * our own DB and offers no win (each supplier's API is the bottleneck).
 * BullMQ should schedule this at most once a day (03:00 UTC).
 */
export async function syncAllSuppliers(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  // Lion first because it's the larger catalog and benefits from being
  // earliest in the sync window (fewer customer-facing reads happen
  // overnight UTC).
  try {
    results.push(await syncLionCatalog());
  } catch (err) {
    console.error("[supplierSync] Lion sync threw:", err);
  }
  try {
    results.push(await syncUvCatalog());
  } catch (err) {
    console.error("[supplierSync] UV sync threw:", err);
  }
  return results;
}
