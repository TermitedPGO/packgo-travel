/**
 * supplierSync/lion — Lion Travel-specific mirror logic.
 *
 * Extracted from server/services/supplierSyncService.ts during Phase 5A.
 * Behavior IDENTICAL to pre-split — this is structural-only.
 *
 * Maps Lion's native `search/grouplistinfojson` response into our DB
 * schema (supplierProducts / supplierDepartures) + records progress
 * in supplierSyncRuns via shared.openRun / shared.closeRun.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
  supplierDepartures as departuresTable,
  type InsertSupplierProduct,
  type InsertSupplierDeparture,
} from "../../../drizzle/schema";
import {
  searchProducts as lionSearch,
  type LionNormGroup,
  type LionGroupEntry,
} from "../../suppliers/lionClient";
import { SupplierApiError } from "../../suppliers/types";
import {
  jitter,
  getSupplierIdByCode,
  openRun,
  closeRun,
  type SyncResult,
} from "./shared";

/**
 * Map a Lion search result row into our normalized shape. Returns null
 * if required fields are missing (e.g. NormGroupID absent) so the
 * caller can flag it as a format-change pending row.
 */
export function lionToProductInsert(
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

export function lionGroupToDeparture(
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
    // ────────────────────────────────────────────────────────────────────
    // DATE-HANDLING (locked in by Phase 5A · audit P1-10):
    //
    // `supplierDepartures.departureDate` is Drizzle's `date()` column.
    // At the wire level this is `YYYY-MM-DD` STRING. Drizzle's default
    // type-inference picks `Date` for `.$inferInsert`, but **passing a
    // JS Date object here would introduce Asia/Taipei↔UTC timezone drift
    // on production calendar dates** (a date silently becomes a
    // wall-clock-midnight UTC timestamp that shifts ±1 day for
    // non-UTC servers).
    //
    // Therefore we KEEP THE ISO STRING. The `as unknown as Date` cast is
    // the Phase 1 Option C resolution; the long-term fix is to declare
    // the column with `mode: "string"` and align the inferred type
    // (deferred to Phase 5B+).
    //
    // DO NOT wrap with `new Date(dateStr)`. Regression-anchored by the
    // DST tests in ./lion.test.ts + ./uv.test.ts.
    // ────────────────────────────────────────────────────────────────────
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
