/**
 * Backfill supplier detail enrichment — 2026-05-24, Stage 1.
 *
 * One-off script to enqueue per-product enrichment jobs for all active
 * Lion + UV products that don't yet have a detail row (or > 7 days
 * stale). The worker (server/supplierDetailEnrichmentWorker.ts)
 * consumes the queue with concurrency 5.
 *
 * Run:
 *   fly ssh console -a packgo-travel \
 *     -C 'node --experimental-strip-types server/scripts/backfill-supplier-details.ts'
 *
 * Or locally:
 *   pnpm tsx server/scripts/backfill-supplier-details.ts
 *
 * Output:
 *   - Enqueued count per supplier
 *   - ETA (based on 2 sec/call avg × 5 concurrent workers)
 *   - Progress every 500 jobs queued
 *
 * Idempotent: skips products already enriched within last 7 days.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { supplierDetailEnrichmentQueue } from "../queue";
import {
  supplierProducts,
  supplierProductDetails,
  suppliers as suppliersTable,
} from "../../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌ No DB connection");
    process.exit(1);
  }

  console.log("🔍 Finding active products needing enrichment...");

  // Per-supplier breakdown
  const allSuppliers = await db
    .select({ id: suppliersTable.id, code: suppliersTable.code })
    .from(suppliersTable);
  const supplierMap = new Map<number, string>();
  allSuppliers.forEach((s) => supplierMap.set(s.id, s.code));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Active products WHERE no detail row OR detail > 7 days stale
  const rows = await db
    .select({
      id: supplierProducts.id,
      supplierId: supplierProducts.supplierId,
      externalCode: supplierProducts.externalProductCode,
      lastEnriched: supplierProductDetails.lastEnrichedAt,
    })
    .from(supplierProducts)
    .leftJoin(
      supplierProductDetails,
      eq(supplierProducts.id, supplierProductDetails.supplierProductId),
    )
    .where(
      and(
        eq(supplierProducts.status, "active"),
        or(
          isNull(supplierProductDetails.id),
          lt(supplierProductDetails.lastEnrichedAt, sevenDaysAgo),
        ),
      ),
    );

  // Group by supplier
  const bySupplier = new Map<string, typeof rows>();
  for (const row of rows) {
    const code = supplierMap.get(row.supplierId);
    if (code !== "lion" && code !== "uv") continue;
    if (!bySupplier.has(code)) bySupplier.set(code, []);
    bySupplier.get(code)!.push(row);
  }

  console.log("\n📊 Per-supplier breakdown:");
  for (const [code, list] of bySupplier) {
    console.log(`  ${code}: ${list.length} products`);
  }

  const total = rows.length;
  // ETA: 2 sec/call avg × 5 endpoints (Lion) or 2 endpoints (UV) per product / 5 workers
  const avgCallsPerProduct = 4; // weighted average across Lion(5) + UV(2)
  const totalCalls = total * avgCallsPerProduct;
  const etaSeconds = (totalCalls * 2) / 5;
  const etaMin = Math.ceil(etaSeconds / 60);
  console.log(`\n⏱️  Estimated time: ~${etaMin} min (${total} products × ${avgCallsPerProduct} avg calls / 5 workers)`);

  console.log("\n🚀 Enqueueing jobs...");
  let enqueued = 0;
  for (const [code, list] of bySupplier) {
    for (const row of list) {
      await supplierDetailEnrichmentQueue.add(
        `enrich-${code}-${row.id}`,
        {
          supplierProductId: row.id,
          supplierCode: code as "lion" | "uv",
          externalProductCode: row.externalCode,
          triggeredBy: "backfill",
        },
        {
          jobId: `backfill-${code}-${row.id}`,
        },
      );
      enqueued++;
      if (enqueued % 500 === 0) {
        console.log(`  ${enqueued} / ${total} queued...`);
      }
    }
  }

  console.log(`\n✅ Done. ${enqueued} jobs enqueued. Worker (concurrency 5) will process.`);
  console.log(`📈 Monitor: queue depth via supplierDetailEnrichmentQueue.getJobCounts() or bull-board`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
