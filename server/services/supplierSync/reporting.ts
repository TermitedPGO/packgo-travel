/**
 * supplierSync/reporting — read-only queries powering the admin
 * dashboard. Extracted from server/services/supplierSyncService.ts
 * during Phase 5A.
 *
 * `getRecentSyncRuns` — last N supplierSyncRuns rows, joined with the
 *   supplier display name.
 * `getSuppliersOverview` — registry of all suppliers + per-supplier
 *   product counts bucketed by status / hidden flag.
 */

import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
  supplierSyncRuns as runsTable,
} from "../../../drizzle/schema";

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
