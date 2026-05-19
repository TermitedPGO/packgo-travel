/**
 * supplierSync/uv — UV Bookings-specific mirror logic.
 *
 * Extracted from server/services/supplierSyncService.ts during Phase 5A.
 * Behavior IDENTICAL to pre-split — this is structural-only.
 *
 * Maps UV Bookings' native `getPagerProductTemp` + `getProductGroup`
 * responses into our DB schema (supplierProducts / supplierDepartures).
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
  listProducts as uvList,
  getDeparturesNext180Days as uvDepartures,
  type UvProductListItem,
  type UvDepartureRow,
} from "../../suppliers/uvClient";
import { deriveAvailability, SupplierApiError } from "../../suppliers/types";
import {
  jitter,
  getSupplierIdByCode,
  openRun,
  closeRun,
  type SyncResult,
} from "./shared";

export function uvToProductInsert(
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

export function uvRowToDeparture(
  row: UvDepartureRow,
  productCode: string,
  productId: number,
  supplierId: number
): InsertSupplierDeparture | null {
  if (!row.groupDate) return null;
  // UV's groupDate may arrive in any of these shapes (observed in prod):
  //   "YYYY-MM-DD"
  //   "YYYY-MM-DDTHH:mm:ss" (ISO datetime)
  //   "YYYY-MM-DD HH:mm:ss" (datetime with space separator)
  //   "YYYY-MM-DD+08:00" (date with timezone offset)
  // `.slice(0, 10)` extracts the calendar-date prefix for ALL forms.
  // We intentionally do NOT parse + reformat — keeping the string raw
  // preserves the supplier's published calendar day with no timezone
  // drift. See lion.ts for the full date-handling rationale.
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
    // DST / year-boundary / leap-year tests in ./uv.test.ts.
    // ────────────────────────────────────────────────────────────────────
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
