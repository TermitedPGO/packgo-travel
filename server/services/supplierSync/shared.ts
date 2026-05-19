/**
 * supplierSync/shared — common helpers + types used by both Lion and UV
 * sync flows. Extracted from the original monolithic
 * server/services/supplierSyncService.ts during Phase 5A.
 *
 * Public-facing contents are re-exported through ./index.ts so callers
 * outside this directory don't need to know about the split.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  suppliers as suppliersTable,
  supplierSyncRuns as runsTable,
} from "../../../drizzle/schema";

/* ─────────────────────────── shared helpers ─────────────────────────── */

/** Random delay in [min, max] ms. Politeness sleep between API calls. */
export function jitter(minMs = 500, maxMs = 1500): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Look up the supplier row for a given short code ('lion' / 'uv').
 * Seeded by migration 0074. Throws clear error if missing so a forgotten
 * deploy doesn't silently no-op.
 */
export async function getSupplierIdByCode(
  code: "lion" | "uv"
): Promise<number> {
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
export async function openRun(
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

export async function closeRun(
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
  /**
   * External codes of products that appear in our DB for the FIRST time
   * during this run. Caller can pass these to the bulk-import flow to
   * auto-generate PACK&GO tours.
   */
  newProductCodes: string[];
  status: "success" | "failed" | "partial";
  errorMessage?: string;
}
