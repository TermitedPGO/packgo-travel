/**
 * supplierSync — public API surface for the supplier-catalog mirror.
 *
 * Two responsibilities (unchanged from the pre-split monolith at
 * server/services/supplierSyncService.ts):
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
 * Phase 5A (audit P1-10) split the 810 LOC monolith into:
 *   - shared.ts     (≈115 LOC) — jitter, getSupplierIdByCode, run helpers
 *   - lion.ts       (≈300 LOC) — Lion catalog sync
 *   - uv.ts         (≈270 LOC) — UV Bookings catalog sync
 *   - reporting.ts  (≈80 LOC)  — admin dashboard queries
 *   - index.ts      (this file) — orchestration + re-exports
 *
 * The original supplierSyncService.ts now re-exports from here so the
 * four pre-existing import sites don't churn.
 */

import { syncLionCatalog } from "./lion";
import { syncUvCatalog } from "./uv";
import type { SyncResult } from "./shared";
import { reportFunnelError } from "../../_core/errorFunnel";

export { syncLionCatalog } from "./lion";
export { syncUvCatalog } from "./uv";
export { getRecentSyncRuns, getSuppliersOverview } from "./reporting";
export type { SyncResult } from "./shared";

// Expose Lion-specific pure helpers + UV-specific pure helpers for tests
// and any future ad-hoc tooling. Internal callers should prefer the
// orchestrators (syncLionCatalog / syncUvCatalog).
export { lionToProductInsert, lionGroupToDeparture } from "./lion";
export { uvToProductInsert, uvRowToDeparture } from "./uv";

/**
 * Run a full catalog sync for every active supplier sequentially.
 *
 * Sequential by design — running both concurrently doubles the load on
 * our own DB and offers no win (each supplier's API is the bottleneck).
 * BullMQ should schedule this at most once a day (03:00 UTC).
 *
 * Behavior: if one supplier's full sync throws (not just returns
 * status="failed"), the OTHER supplier still runs. This is the
 * regression-anchored "Lion's failure doesn't bypass UV" guarantee from
 * Phase 5A · module 5A · orchestration test 1.
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
    reportFunnelError({ source: "fail-open:supplierSync:lionSyncThrew", err }).catch(() => {});
  }
  try {
    results.push(await syncUvCatalog());
  } catch (err) {
    console.error("[supplierSync] UV sync threw:", err);
    reportFunnelError({ source: "fail-open:supplierSync:uvSyncThrew", err }).catch(() => {});
  }
  return results;
}
