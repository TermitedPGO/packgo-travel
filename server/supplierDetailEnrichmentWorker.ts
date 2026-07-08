/**
 * Supplier detail enrichment worker — 2026-05-24, Stage 1 of supplier
 * deep sync.
 *
 * Pulls Lion + UV detail endpoints per product, parses to normalized
 * shapes, upserts into supplierProductDetails table.
 *
 * Modes (based on job.data.triggeredBy):
 *
 *   - "backfill"   : one-off pass. Called by scripts/backfill-supplier-
 *                    details.ts which enqueues one job per active product
 *                    that has no detail row (or row is > 7 days stale).
 *
 *   - "daily-cron" : scheduled job sentinel. The worker finds products
 *                    that need a refresh (new today, changed today,
 *                    > 30 days stale) and enqueues per-product jobs.
 *
 *   - "manual"     : triggered by admin "Re-enrich" button in
 *                    SupplierEnrichmentTab (M8). Same as backfill but
 *                    typically scoped to one supplier or one product.
 *
 * Concurrency 5. Rate-limit + retry are inside enrichLionProduct /
 * enrichUvProduct (sharedDetail.ts).
 */

import { Worker } from "bullmq";
import { and, eq, lt, sql } from "drizzle-orm";
import { redisBullMQ } from "./redis";
import {
  supplierDetailEnrichmentQueue,
  type SupplierEnrichmentJobData,
  type SupplierEnrichmentJobResult,
} from "./queue";
import { getDb } from "./db";
import {
  supplierProductDetails,
  supplierProducts as productsTable,
  suppliers as suppliersTable,
} from "../drizzle/schema";
import { enrichLionProduct } from "./services/supplierSync/lionDetail";
import { enrichUvProduct } from "./services/supplierSync/uvDetail";
import { upsertProductDetail } from "./services/supplierSync/sharedDetail";
import { createChildLogger } from "./_core/logger";
import { wireWorkerFunnel } from "./_core/errorFunnel";

const log = createChildLogger({ module: "supplierDetailEnrichmentWorker" });

const supplierDetailEnrichmentWorker = new Worker<SupplierEnrichmentJobData, SupplierEnrichmentJobResult>(
  "supplier-detail-enrichment",
  async (job) => {
    // Daily-cron sentinel → discover products needing enrichment and enqueue
    if (job.data.triggeredBy === "daily-cron" && job.data.supplierProductId === 0) {
      const enqueued = await discoverAndEnqueue();
      log.info({ enqueued }, "[supplier-detail] daily-cron discover done");
      return {
        itineraryStatus: "scheduled",
        priceTermsStatus: "scheduled",
        noticesStatus: "scheduled",
        optionalStatus: "scheduled",
        tourInfoStatus: "scheduled",
      };
    }

    const { supplierProductId, supplierCode, externalProductCode } = job.data;

    log.info(
      { jobId: job.id, supplierProductId, supplierCode },
      "[supplier-detail] enriching",
    );

    let enrichment;
    if (supplierCode === "lion") {
      enrichment = await enrichLionProduct(supplierProductId, externalProductCode);
    } else if (supplierCode === "uv") {
      enrichment = await enrichUvProduct(supplierProductId, externalProductCode);
    } else {
      throw new Error(`Unknown supplierCode: ${supplierCode}`);
    }

    // Look up supplierId for the upsert (denormalized in detail table)
    const supplierId = await resolveSupplierId(supplierCode);
    if (!supplierId) {
      throw new Error(`Supplier not found for code: ${supplierCode}`);
    }

    await upsertProductDetail(supplierProductId, supplierId, enrichment);

    return {
      itineraryStatus: enrichment.itinerary.status,
      priceTermsStatus: enrichment.priceTerms.status,
      noticesStatus: enrichment.notices.status,
      optionalStatus: enrichment.optional.status,
      tourInfoStatus: enrichment.tourInfo.status,
    };
  },
  { connection: redisBullMQ, concurrency: 5 },
);

wireWorkerFunnel(supplierDetailEnrichmentWorker, "supplier-detail-enrichment");

async function resolveSupplierId(code: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: suppliersTable.id })
    .from(suppliersTable)
    .where(eq(suppliersTable.code, code))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Daily-cron discovery. Finds active products that need enrichment:
 *   - never enriched (no row in supplierProductDetails)
 *   - row > 30 days stale (refresh)
 *   - product updated since last enrichment
 *
 * Enqueues per-product jobs. Returns count.
 */
async function discoverAndEnqueue(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Products with no detail row yet
  const missing = await db
    .select({
      id: productsTable.id,
      supplierId: productsTable.supplierId,
      externalCode: productsTable.externalProductCode,
    })
    .from(productsTable)
    .leftJoin(
      supplierProductDetails,
      eq(productsTable.id, supplierProductDetails.supplierProductId),
    )
    .where(
      and(
        eq(productsTable.status, "active"),
        sql`${supplierProductDetails.id} IS NULL`,
      ),
    )
    .limit(2000);

  // Stale rows (> 30 days old or product changed since last enrichment)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({
      id: productsTable.id,
      supplierId: productsTable.supplierId,
      externalCode: productsTable.externalProductCode,
    })
    .from(productsTable)
    .innerJoin(
      supplierProductDetails,
      eq(productsTable.id, supplierProductDetails.supplierProductId),
    )
    .where(
      and(
        eq(productsTable.status, "active"),
        sql`(${supplierProductDetails.lastEnrichedAt} < ${thirtyDaysAgo} OR ${productsTable.updatedAt} > ${supplierProductDetails.lastEnrichedAt})`,
      ),
    )
    .limit(500);

  // Build supplierId → code map
  const supplierMap = new Map<number, string>();
  const suppliers = await db.select({ id: suppliersTable.id, code: suppliersTable.code }).from(suppliersTable);
  suppliers.forEach((s) => supplierMap.set(s.id, s.code));

  const allRows = [...missing, ...stale];
  let enqueued = 0;
  for (const row of allRows) {
    const code = supplierMap.get(row.supplierId);
    if (code !== "lion" && code !== "uv") continue;
    await supplierDetailEnrichmentQueue.add(
      `enrich-${code}-${row.id}`,
      {
        supplierProductId: row.id,
        supplierCode: code as "lion" | "uv",
        externalProductCode: row.externalCode,
        triggeredBy: "daily-cron",
      },
      { jobId: `enrich-${code}-${row.id}-${Date.now()}` },
    );
    enqueued++;
  }
  return enqueued;
}

// Keep the queue export alive so BullMQ doesn't dead-code-eliminate.
void supplierDetailEnrichmentQueue;
console.log("✅ Supplier detail enrichment worker initialized");
