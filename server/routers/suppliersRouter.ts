/**
 * suppliersRouter — admin tRPC for the supplier-sync subsystem.
 *
 * Phase 1E + 1F. Powers the admin dashboard panel (forthcoming React
 * tab in client/src/components/admin/SuppliersTab.tsx), the "Sync now"
 * button, and the catalog-browse + bulk-import flow.
 *
 * All procedures are `adminProcedure` — no customer-facing reads here.
 * The customer-facing /catalog page reads supplierProducts directly
 * through publicProcedure queries in a separate router (deferred).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
  supplierProductDetails,
  tours as toursTable,
} from "../../drizzle/schema";
import {
  getRecentSyncRuns,
  getSuppliersOverview,
} from "../services/supplierSyncService";
import { triggerManualSync } from "../queues/supplierSyncQueue";
import {
  bulkImportFromLion,
  queueRewriteForImportedTours,
} from "../services/lionBulkImportService";
import {
  bulkImportFromUv,
  queueRewriteForImportedUvTours,
} from "../services/uvBulkImportService";
import { supplierDetailEnrichmentQueue } from "../queue";

export const suppliersRouter = router({
  /* ───────────────────────── overview + history ───────────────────────── */

  overview: adminProcedure.query(async () => {
    return getSuppliersOverview();
  }),

  recentRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(({ input }) => getRecentSyncRuns(input.limit)),

  /* ───────────────────────── manual sync trigger ──────────────────────── */

  triggerSync: adminProcedure
    .input(
      z.object({
        kind: z.enum(["full", "lion-only", "uv-only"]).default("full"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await triggerManualSync({
          kind: input.kind,
          adminUserId: ctx.user.id,
        });
        return { jobId };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to enqueue sync job: ${(err as Error).message}`,
        });
      }
    }),

  /* ──────────────────── browse mirrored supplier catalog ──────────────── */

  /**
   * Paginated, filterable browse of supplierProducts. The admin panel
   * uses this to pick a subset for bulk-import. Filters mirror the
   * common dimensions Jeff would slice by (country, days, currency).
   *
   * `notYetImported` filters out products whose productCode already
   * appears in tours.productCode — prevents accidental double-imports.
   * The match is exact, not substring, because supplierProducts.code
   * is stable (Lion NormGroupID UUID / UV productCode "P00008687").
   */
  listProducts: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv"]).optional(),
        destinationCountry: z.string().max(64).optional(),
        keyword: z.string().max(64).optional(),
        daysMin: z.number().int().min(1).max(60).optional(),
        daysMax: z.number().int().min(1).max(60).optional(),
        notYetImported: z.boolean().default(false),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conditions = [
        eq(productsTable.status, "active"),
        eq(productsTable.isHiddenByAdmin, false),
      ];

      if (input.supplierCode) {
        const supRow = await db
          .select({ id: suppliersTable.id })
          .from(suppliersTable)
          .where(eq(suppliersTable.code, input.supplierCode))
          .limit(1);
        if (supRow[0]) {
          conditions.push(eq(productsTable.supplierId, supRow[0].id));
        }
      }
      if (input.destinationCountry) {
        conditions.push(
          eq(productsTable.destinationCountry, input.destinationCountry)
        );
      }
      if (input.keyword) {
        conditions.push(like(productsTable.title, `%${input.keyword}%`));
      }
      if (input.daysMin !== undefined) {
        conditions.push(gte(productsTable.days, input.daysMin));
      }
      if (input.daysMax !== undefined) {
        conditions.push(lte(productsTable.days, input.daysMax));
      }
      if (input.notYetImported) {
        // 2026-05-16 bug fix: original code compared
        //   supplierProducts.externalProductCode (Lion NormGroupID UUID
        //   or UV productCode) NOT IN (SELECT tours.productCode)
        // But tours.productCode stores Lion's `tourId` (e.g. 26AK516NCL-T)
        // not NormGroupID, so the two columns NEVER match → filter is a
        // no-op and the same supplier product can be imported infinitely.
        //
        // Real identifier comparison: tours.sourceUrl encodes the
        // external code via either ?NormGroupID=<uuid> (Lion) or
        // /product/detail/<productCode> (UV). Use LIKE-match against
        // the externalProductCode embedded in sourceUrl.
        conditions.push(
          sql`NOT EXISTS (
            SELECT 1 FROM ${toursTable}
            WHERE ${toursTable.sourceUrl} LIKE CONCAT('%NormGroupID=', ${productsTable.externalProductCode}, '%')
               OR ${toursTable.sourceUrl} LIKE CONCAT('%/product/detail/', ${productsTable.externalProductCode}, '%')
          )`
        );
      }

      const offset = (input.page - 1) * input.pageSize;

      const [rows, countRow] = await Promise.all([
        db
          .select({
            id: productsTable.id,
            externalProductCode: productsTable.externalProductCode,
            supplierId: productsTable.supplierId,
            title: productsTable.title,
            days: productsTable.days,
            departureCity: productsTable.departureCity,
            destinationCountry: productsTable.destinationCountry,
            destinationCity: productsTable.destinationCity,
            imageUrl: productsTable.imageUrl,
            currency: productsTable.currency,
            status: productsTable.status,
            lastSyncedAt: productsTable.lastSyncedAt,
          })
          .from(productsTable)
          .where(and(...conditions))
          .orderBy(desc(productsTable.lastSyncedAt))
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(productsTable)
          .where(and(...conditions)),
      ]);

      return {
        rows,
        totalCount: Number(countRow[0]?.count ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /* ───────────────────── single-product import + rewrite ──────────────── */

  /**
   * Import ONE supplier product as a draft `tours` row + queue an LLM
   * rewrite job. The product is identified by its external code +
   * supplier; we dispatch to lionBulkImportService or
   * uvBulkImportService based on supplier.
   *
   * Returns the new tour id (so the UI can deep-link the admin to the
   * draft for review) and the rewrite request id (for status polling).
   */
  importProduct: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv"]),
        externalProductCode: z.string().min(1).max(128),
        queueRewrite: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let tourId: number | undefined;
      let title: string | undefined;
      if (input.supplierCode === "lion") {
        const result = await bulkImportFromLion({
          ids: [input.externalProductCode],
          userId: ctx.user.id,
        });
        const first = result.results[0];
        if (!first?.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: first?.error || "Lion import failed (no result)",
          });
        }
        tourId = first.tourId;
        title = first.title;
      } else {
        const result = await bulkImportFromUv({
          productCodes: [input.externalProductCode],
          userId: ctx.user.id,
        });
        const first = result.results[0];
        if (!first?.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: first?.error || "UV import failed (no result)",
          });
        }
        tourId = first.tourId;
        title = first.title;
      }

      if (!tourId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Import succeeded but no tourId returned",
        });
      }

      let queueResult: { queued: number } = { queued: 0 };
      if (input.queueRewrite) {
        const fn =
          input.supplierCode === "lion"
            ? queueRewriteForImportedTours
            : queueRewriteForImportedUvTours;
        queueResult = await fn([tourId], { userId: ctx.user.id });
      }

      return {
        tourId,
        title,
        rewriteQueued: queueResult.queued > 0,
      };
    }),

  /* ────────────────────────── bulk-import flow ────────────────────────── */

  /**
   * Bulk-import a filtered slice of mirrored products into draft tours
   * and queue LLM rewrites for all of them.
   *
   * Same filters as listProducts. Hard-capped at 200 per call to avoid
   * accidentally importing the entire 5,554-product catalog in one
   * click; Jeff can run it twice for larger batches.
   *
   * Concurrency happens INSIDE bulkImportFromLion / bulkImportFromUv
   * (batches of 5 / 4 respectively). This procedure waits for the
   * whole batch to finish before returning — Jeff sees the result
   * count in the UI in 1-3 minutes for typical 50-100 row batches.
   */
  bulkImport: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv"]),
        destinationCountry: z.string().max(64).optional(),
        keyword: z.string().max(64).optional(),
        daysMin: z.number().int().min(1).max(60).optional(),
        daysMax: z.number().int().min(1).max(60).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        queueRewrite: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Find the supplier id.
      const supRow = await db
        .select({ id: suppliersTable.id })
        .from(suppliersTable)
        .where(eq(suppliersTable.code, input.supplierCode))
        .limit(1);
      if (!supRow[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Supplier ${input.supplierCode} not found`,
        });
      }

      // Build the filter set — same as listProducts but ALWAYS
      // notYetImported=true (don't re-import existing).
      // Same notYetImported dedup as listProducts above — compare via
      // tours.sourceUrl LIKE not tours.productCode.
      const conditions = [
        eq(productsTable.supplierId, supRow[0].id),
        eq(productsTable.status, "active"),
        eq(productsTable.isHiddenByAdmin, false),
        sql`NOT EXISTS (
          SELECT 1 FROM ${toursTable}
          WHERE ${toursTable.sourceUrl} LIKE CONCAT('%NormGroupID=', ${productsTable.externalProductCode}, '%')
             OR ${toursTable.sourceUrl} LIKE CONCAT('%/product/detail/', ${productsTable.externalProductCode}, '%')
        )`,
      ];
      if (input.destinationCountry) {
        conditions.push(
          eq(productsTable.destinationCountry, input.destinationCountry)
        );
      }
      if (input.keyword) {
        conditions.push(like(productsTable.title, `%${input.keyword}%`));
      }
      if (input.daysMin !== undefined) {
        conditions.push(gte(productsTable.days, input.daysMin));
      }
      if (input.daysMax !== undefined) {
        conditions.push(lte(productsTable.days, input.daysMax));
      }

      const rows = await db
        .select({ code: productsTable.externalProductCode })
        .from(productsTable)
        .where(and(...conditions))
        .orderBy(desc(productsTable.lastSyncedAt))
        .limit(input.limit);

      const codes = rows.map((r) => r.code);
      if (codes.length === 0) {
        return {
          requested: 0,
          imported: 0,
          failed: 0,
          rewriteQueued: 0,
          durationMs: 0,
        };
      }

      const batchResult =
        input.supplierCode === "lion"
          ? await bulkImportFromLion({ ids: codes, userId: ctx.user.id })
          : await bulkImportFromUv({
              productCodes: codes,
              userId: ctx.user.id,
            });

      const newTourIds = batchResult.results
        .filter((r) => r.success && r.tourId)
        .map((r) => r.tourId as number);

      let rewriteQueued = 0;
      if (input.queueRewrite && newTourIds.length > 0) {
        const fn =
          input.supplierCode === "lion"
            ? queueRewriteForImportedTours
            : queueRewriteForImportedUvTours;
        const q = await fn(newTourIds, { userId: ctx.user.id });
        rewriteQueued = q.queued;
      }

      return {
        requested: codes.length,
        imported: batchResult.imported,
        failed: batchResult.failed,
        rewriteQueued,
        durationMs: batchResult.durationMs,
      };
    }),

  /* ────────────────────────── detail enrichment ──────────────────────── */

  /**
   * Detail enrichment status — count of active products with each
   * parseStatus, per supplier. Powers admin observability tab (M8).
   * 2026-05-24: Stage 1 of supplier deep sync.
   */
  enrichmentOverview: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const allSuppliers = await db
      .select({ id: suppliersTable.id, code: suppliersTable.code, name: suppliersTable.displayName })
      .from(suppliersTable)
      .where(eq(suppliersTable.isActive, true));

    const results: Array<{
      code: string;
      name: string;
      total: number;
      itineraryParsed: number;
      itineraryParseFailed: number;
      itineraryMissing: number;
      lastEnrichedAt: Date | null;
    }> = [];

    for (const sup of allSuppliers) {
      const [totalRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(productsTable)
        .where(and(eq(productsTable.supplierId, sup.id), eq(productsTable.status, "active")));

      const [parsedRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(supplierProductDetails)
        .where(
          and(
            eq(supplierProductDetails.supplierId, sup.id),
            eq(supplierProductDetails.itineraryParseStatus, "parsed"),
          ),
        );

      const [failedRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(supplierProductDetails)
        .where(
          and(
            eq(supplierProductDetails.supplierId, sup.id),
            eq(supplierProductDetails.itineraryParseStatus, "parse_failed"),
          ),
        );

      const [lastRow] = await db
        .select({ ts: sql<Date | null>`MAX(${supplierProductDetails.lastEnrichedAt})` })
        .from(supplierProductDetails)
        .where(eq(supplierProductDetails.supplierId, sup.id));

      const total = Number(totalRow?.c ?? 0);
      const parsed = Number(parsedRow?.c ?? 0);
      const failed = Number(failedRow?.c ?? 0);

      results.push({
        code: sup.code,
        name: sup.name,
        total,
        itineraryParsed: parsed,
        itineraryParseFailed: failed,
        itineraryMissing: Math.max(0, total - parsed - failed),
        lastEnrichedAt: lastRow?.ts ?? null,
      });
    }

    return results;
  }),

  /**
   * Trigger full backfill — enqueues per-product enrichment jobs for
   * all active products that have no detail row OR > 7 days stale.
   *
   * Replaces the `scripts/backfill-supplier-details.ts` CLI which is
   * not bundled into the prod container. Caller flow:
   *   1. Admin clicks "Re-enrich now" (M8 button)
   *   2. This procedure queries products needing enrichment
   *   3. Enqueues one BullMQ job per product
   *   4. Worker (concurrency 5) consumes them over 1-2 hours
   *
   * Returns enqueued count per supplier. Idempotent: if a job with
   * the same jobId is already queued, BullMQ silently dedups.
   */
  triggerFullBackfill: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const allSuppliers = await db
        .select({ id: suppliersTable.id, code: suppliersTable.code })
        .from(suppliersTable);
      const supplierMap = new Map<number, string>();
      allSuppliers.forEach((s) => supplierMap.set(s.id, s.code));

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const rows = await db
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
            or(
              isNull(supplierProductDetails.id),
              lt(supplierProductDetails.lastEnrichedAt, sevenDaysAgo),
            ),
          ),
        );

      const enqueueCounts: Record<string, number> = { lion: 0, uv: 0 };

      // 2026-05-25 fix UV starvation: interleave by supplier instead of
      // processing one supplier's entire queue first. With FIFO + 5
      // concurrent workers and 4590 Lion vs 1138 UV, Lion was monopolizing
      // workers for ~2.5 hours before UV got attention. Round-robin
      // ensures both suppliers progress in parallel.
      const lionRows: typeof rows = [];
      const uvRows: typeof rows = [];
      for (const row of rows) {
        const code = supplierMap.get(row.supplierId);
        if (code !== "lion" && code !== "uv") continue;
        if (input.supplierCode !== "all" && input.supplierCode !== code) continue;
        if (code === "lion") lionRows.push(row);
        else uvRows.push(row);
      }

      const maxLen = Math.max(lionRows.length, uvRows.length);
      // 2026-05-25 bug fix: BullMQ dedups by jobId. Previous run used
      // `backfill-${code}-${id}` which kept completed jobs around for
      // 7 days (removeOnComplete.age=604800) — re-triggering silently
      // dropped them all. Add timestamp to keep IDs unique per trigger.
      const stamp = Date.now();
      for (let i = 0; i < maxLen; i++) {
        for (const [code, list] of [
          ["lion", lionRows] as const,
          ["uv", uvRows] as const,
        ]) {
          const row = list[i];
          if (!row) continue;
          await supplierDetailEnrichmentQueue.add(
            `enrich-${code}-${row.id}`,
            {
              supplierProductId: row.id,
              supplierCode: code,
              externalProductCode: row.externalCode,
              triggeredBy: "manual",
            },
            { jobId: `backfill-${code}-${row.id}-${stamp}` },
          );
          enqueueCounts[code]++;
        }
      }

      return {
        enqueued: enqueueCounts,
        total: enqueueCounts.lion + enqueueCounts.uv,
      };
    }),

  /* ────────────────────── mass import + cleanup (2026-05-25) ─────────── */

  /**
   * Preview mass import — counts eligible supplierProducts + empty drafts
   * that would be cleaned up. Use this BEFORE pulling the trigger on
   * massImportFromMirror or cleanupFailedDrafts.
   *
   * "Eligible" = supplierProducts that:
   *   1. status='active' AND isHiddenByAdmin=false
   *   2. Have a supplierProductDetails row with itineraryParseStatus='parsed'
   *      (= deep sync has processed them; their TourDetail page will
   *      render rich content via SupplierDetailSection)
   *   3. Have NO existing tour pointing at their externalProductCode
   *      (sourceUrl LIKE match — same logic as legacy bulkImport)
   *
   * "Failed drafts" = tours where:
   *   1. status='draft'
   *   2. description IS NULL or length < 30 (LLM rewrite never completed)
   *   3. createdAt > 1 hour ago (avoid in-flight imports)
   *   4. No supplier link in supplierProducts (truly dead — even M6
   *      can't save them)
   */
  previewMassImport: adminProcedure.query(async () => {
    const db2 = await getDb();
    if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Eligible per supplier
    const eligibleRows = await db2
      .select({
        supplierId: productsTable.supplierId,
        c: sql<number>`COUNT(*)`,
      })
      .from(productsTable)
      .innerJoin(
        supplierProductDetails,
        eq(supplierProductDetails.supplierProductId, productsTable.id),
      )
      .where(
        and(
          eq(productsTable.status, "active"),
          eq(productsTable.isHiddenByAdmin, false),
          eq(supplierProductDetails.itineraryParseStatus, "parsed"),
          sql`NOT EXISTS (
            SELECT 1 FROM ${toursTable}
            WHERE ${toursTable.sourceUrl} LIKE CONCAT('%NormGroupID=', ${productsTable.externalProductCode}, '%')
               OR ${toursTable.sourceUrl} LIKE CONCAT('%/product/detail/', ${productsTable.externalProductCode}, '%')
          )`,
        ),
      )
      .groupBy(productsTable.supplierId);

    const supplierMap = new Map<number, string>();
    const allSuppliers = await db2
      .select({ id: suppliersTable.id, code: suppliersTable.code })
      .from(suppliersTable);
    allSuppliers.forEach((s) => supplierMap.set(s.id, s.code));

    const eligibleBySupplier: Record<string, number> = { lion: 0, uv: 0 };
    for (const row of eligibleRows) {
      const code = supplierMap.get(row.supplierId);
      if (code === "lion" || code === "uv") {
        eligibleBySupplier[code] = Number(row.c);
      }
    }

    // Failed drafts
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const failedDrafts = await db2
      .select({ c: sql<number>`COUNT(*)` })
      .from(toursTable)
      .where(
        and(
          eq(toursTable.status, "draft"),
          sql`(${toursTable.description} IS NULL OR LENGTH(${toursTable.description}) < 30)`,
          lt(toursTable.createdAt, oneHourAgo),
        ),
      );

    return {
      eligibleToImport: eligibleBySupplier,
      eligibleTotal: eligibleBySupplier.lion + eligibleBySupplier.uv,
      failedDrafts: Number(failedDrafts[0]?.c ?? 0),
    };
  }),

  /**
   * Cleanup mutation — hard-deletes empty draft tours that have been
   * sitting > 1 hour with no description (= failed LLM rewrite from old
   * import flow). Uses existing batchDelete which respects booking
   * attachments (skips rather than orphan booked tours).
   */
  cleanupFailedDrafts: adminProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const rows = await db2
        .select({ id: toursTable.id, title: toursTable.title })
        .from(toursTable)
        .where(
          and(
            eq(toursTable.status, "draft"),
            sql`(${toursTable.description} IS NULL OR LENGTH(${toursTable.description}) < 30)`,
            lt(toursTable.createdAt, oneHourAgo),
          ),
        );

      if (input.dryRun) {
        return {
          dryRun: true,
          wouldDelete: rows.length,
          samples: rows.slice(0, 5).map((r) => ({
            id: r.id,
            title: r.title?.slice(0, 60) ?? "",
          })),
        };
      }

      // Real delete via existing batchDeleteTours (handles bookings safely)
      const { batchDeleteTours } = await import("../db");
      const result = await batchDeleteTours(rows.map((r) => r.id));
      return {
        dryRun: false,
        deleted: result.deleted,
        skipped: result.skipped.length,
        skippedSamples: result.skipped.slice(0, 5),
      };
    }),

  /**
   * Mass import from supplier mirror. Reads supplierProducts (no external
   * API call), creates lightweight tour rows with status='active'. Content
   * is provided by SupplierDetailSection (M6) reading supplierProductDetails.
   *
   * No LLM rewrite — that path is the OLD design pre-Stage 1. With
   * supplierProductDetails populated, tours don't need synthesized content.
   *
   * Speed: ~10ms per tour (DB INSERT only). 5728 in ~60 sec total.
   *
   * Only imports products with itineraryParseStatus='parsed' so customer-
   * facing pages always have rich content.
   */
  massImportFromMirror: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
        limit: z.number().int().min(1).max(10_000).default(10_000),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Find supplier ids
      const allSuppliers = await db2
        .select({ id: suppliersTable.id, code: suppliersTable.code })
        .from(suppliersTable);
      const codeToId = new Map<string, number>();
      const idToCode = new Map<number, string>();
      allSuppliers.forEach((s) => {
        codeToId.set(s.code, s.id);
        idToCode.set(s.id, s.code);
      });

      // Get eligible rows
      const supplierFilter =
        input.supplierCode === "all"
          ? undefined
          : (() => {
              const sid = codeToId.get(input.supplierCode);
              return sid !== undefined
                ? eq(productsTable.supplierId, sid)
                : undefined;
            })();

      const conditions = [
        eq(productsTable.status, "active"),
        eq(productsTable.isHiddenByAdmin, false),
        eq(supplierProductDetails.itineraryParseStatus, "parsed"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${toursTable}
          WHERE ${toursTable.sourceUrl} LIKE CONCAT('%NormGroupID=', ${productsTable.externalProductCode}, '%')
             OR ${toursTable.sourceUrl} LIKE CONCAT('%/product/detail/', ${productsTable.externalProductCode}, '%')
        )`,
      ];
      if (supplierFilter) conditions.push(supplierFilter);

      const eligible = await db2
        .select({
          id: productsTable.id,
          supplierId: productsTable.supplierId,
          externalCode: productsTable.externalProductCode,
          title: productsTable.title,
          days: productsTable.days,
          departureCity: productsTable.departureCity,
          destinationCountry: productsTable.destinationCountry,
          destinationCity: productsTable.destinationCity,
          imageUrl: productsTable.imageUrl,
          currency: productsTable.currency,
        })
        .from(productsTable)
        .innerJoin(
          supplierProductDetails,
          eq(supplierProductDetails.supplierProductId, productsTable.id),
        )
        .where(and(...conditions))
        .limit(input.limit);

      if (input.dryRun) {
        return {
          dryRun: true,
          wouldImport: eligible.length,
          byCsupplier: eligible.reduce<Record<string, number>>((acc, r) => {
            const code = idToCode.get(r.supplierId) ?? "?";
            acc[code] = (acc[code] || 0) + 1;
            return acc;
          }, {}),
          samples: eligible.slice(0, 5).map((r) => ({
            id: r.id,
            code: idToCode.get(r.supplierId) ?? "?",
            title: r.title?.slice(0, 60) ?? "",
          })),
        };
      }

      // Real import — fetch min retailPrice per product from supplierDepartures
      // for proper tour.price.
      const { supplierDepartures } = await import("../../drizzle/schema");
      const { createTour } = await import("../db");

      let imported = 0;
      const errors: Array<{ supplierProductId: number; err: string }> = [];

      for (const row of eligible) {
        try {
          const code = idToCode.get(row.supplierId);
          if (code !== "lion" && code !== "uv") continue;

          const [priceRow] = await db2
            .select({
              minPrice: sql<string>`MIN(${supplierDepartures.retailPrice})`,
            })
            .from(supplierDepartures)
            .where(eq(supplierDepartures.supplierProductId, row.id));
          const price = Math.round(Number(priceRow?.minPrice ?? 0));

          const sourceUrl =
            code === "lion"
              ? `https://travel.liontravel.com/detail?NormGroupID=${row.externalCode}`
              : `https://www.uvbookings.com/product/detail/${row.externalCode}`;

          await createTour({
            title: row.title.slice(0, 200),
            description: "",
            productCode: row.externalCode.slice(0, 100),
            destinationCountry: row.destinationCountry ?? "",
            destinationCity: row.destinationCity ?? row.destinationCountry ?? "",
            departureCity: row.departureCity ?? "",
            days: row.days,
            nights: Math.max(0, row.days - 1),
            duration: row.days,
            price,
            priceCurrency: row.currency,
            heroImage: row.imageUrl ?? "",
            imageUrl: row.imageUrl ?? "",
            status: "active",
            sourceUrl,
            sourceProvider: code === "lion" ? "liontravel" : "uvbookings",
            createdBy: ctx.user.id,
          } as never);
          imported++;
        } catch (err) {
          errors.push({
            supplierProductId: row.id,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }

      return {
        dryRun: false,
        imported,
        errors: errors.length,
        errorSamples: errors.slice(0, 5),
      };
    }),

  /**
   * Audit every imported tour for data quality. 2026-05-25 added after
   * Jeff's "全部上架後 去每個都檢查" — programmatic verification across
   * 4000+ tours since manual check isn't feasible.
   *
   * Checks (all must pass for "healthy"):
   *   1. status='active' (else hidden from public)
   *   2. title non-empty
   *   3. price > 0
   *   4. heroImage OR imageUrl set
   *   5. sourceUrl set (else SupplierDetailSection can't resolve)
   *   6. Linked supplierProduct exists in supplierProducts table
   *   7. Linked supplierProductDetails exists with at least itinerary parsed
   *
   * Returns: total, healthy count, problems by category with sample IDs.
   * Read-only — never modifies data.
   */
  auditAllImportedTours: adminProcedure.query(async () => {
    const db2 = await getDb();
    if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Get all tours that came from supplier import — filter by sourceUrl
    // pattern since `sourceProvider` field isn't in the tours schema.
    const rows = await db2
      .select({
        id: toursTable.id,
        title: toursTable.title,
        status: toursTable.status,
        price: toursTable.price,
        sourceUrl: toursTable.sourceUrl,
        heroImage: toursTable.heroImage,
        imageUrl: toursTable.imageUrl,
      })
      .from(toursTable)
      .where(
        or(
          like(toursTable.sourceUrl, "%liontravel.com%"),
          like(toursTable.sourceUrl, "%uvbookings.com%"),
        ),
      );

    const problems = {
      notActive: [] as Array<{ id: number; title: string; status: string }>,
      emptyTitle: [] as Array<{ id: number }>,
      zeroPrice: [] as Array<{ id: number; title: string }>,
      noImage: [] as Array<{ id: number; title: string }>,
      noSourceUrl: [] as Array<{ id: number; title: string }>,
      noSupplierLink: [] as Array<{ id: number; title: string; sourceUrl: string }>,
      noSupplierDetail: [] as Array<{ id: number; title: string }>,
      noItineraryParsed: [] as Array<{
        id: number;
        title: string;
        status: string;
      }>,
    };

    // Build supplier code lookup
    const allSupplierProductCodes = new Set<string>();
    const detailsByCode = new Map<string, string>(); // code → parseStatus
    const allProducts = await db2
      .select({
        code: productsTable.externalProductCode,
        id: productsTable.id,
      })
      .from(productsTable);
    allProducts.forEach((p) => allSupplierProductCodes.add(p.code));

    const allDetails = await db2
      .select({
        supplierProductId: supplierProductDetails.supplierProductId,
        itineraryParseStatus: supplierProductDetails.itineraryParseStatus,
      })
      .from(supplierProductDetails);
    const productIdToStatus = new Map<number, string>();
    allDetails.forEach((d) =>
      productIdToStatus.set(d.supplierProductId, d.itineraryParseStatus),
    );
    const productIdByCode = new Map<string, number>();
    allProducts.forEach((p) => productIdByCode.set(p.code, p.id));

    let healthy = 0;
    for (const t of rows) {
      let isHealthy = true;
      const title = t.title?.slice(0, 60) ?? "";

      if (t.status !== "active") {
        problems.notActive.push({ id: t.id, title, status: t.status });
        isHealthy = false;
      }
      if (!t.title || t.title.trim() === "") {
        problems.emptyTitle.push({ id: t.id });
        isHealthy = false;
      }
      if (!t.price || t.price <= 0) {
        problems.zeroPrice.push({ id: t.id, title });
        isHealthy = false;
      }
      if (!t.heroImage && !t.imageUrl) {
        problems.noImage.push({ id: t.id, title });
        isHealthy = false;
      }
      if (!t.sourceUrl) {
        problems.noSourceUrl.push({ id: t.id, title });
        isHealthy = false;
      } else {
        // Extract external code
        const lionMatch = t.sourceUrl.match(/[?&]NormGroupID=([^&]+)/);
        const uvMatch = t.sourceUrl.match(/\/product\/detail\/([^/?#]+)/);
        const code = lionMatch?.[1] || uvMatch?.[1];
        if (!code || !allSupplierProductCodes.has(code)) {
          problems.noSupplierLink.push({
            id: t.id,
            title,
            sourceUrl: t.sourceUrl.slice(0, 80),
          });
          isHealthy = false;
        } else {
          const productId = productIdByCode.get(code);
          if (productId === undefined) {
            problems.noSupplierDetail.push({ id: t.id, title });
            isHealthy = false;
          } else {
            const detailStatus = productIdToStatus.get(productId);
            if (!detailStatus) {
              problems.noSupplierDetail.push({ id: t.id, title });
              isHealthy = false;
            } else if (detailStatus !== "parsed") {
              problems.noItineraryParsed.push({
                id: t.id,
                title,
                status: detailStatus,
              });
              isHealthy = false;
            }
          }
        }
      }

      if (isHealthy) healthy++;
    }

    return {
      totalAudited: rows.length,
      healthy,
      unhealthy: rows.length - healthy,
      problemCounts: {
        notActive: problems.notActive.length,
        emptyTitle: problems.emptyTitle.length,
        zeroPrice: problems.zeroPrice.length,
        noImage: problems.noImage.length,
        noSourceUrl: problems.noSourceUrl.length,
        noSupplierLink: problems.noSupplierLink.length,
        noSupplierDetail: problems.noSupplierDetail.length,
        noItineraryParsed: problems.noItineraryParsed.length,
      },
      samples: {
        notActive: problems.notActive.slice(0, 5),
        zeroPrice: problems.zeroPrice.slice(0, 5),
        noImage: problems.noImage.slice(0, 5),
        noSupplierLink: problems.noSupplierLink.slice(0, 5),
        noSupplierDetail: problems.noSupplierDetail.slice(0, 5),
        noItineraryParsed: problems.noItineraryParsed.slice(0, 5),
      },
    };
  }),

  /**
   * Deactivate zero-price tours. 2026-05-25: UV products without
   * supplierDepartures.retailPrice end up with price=0. Hide them from
   * customers (status=inactive) until prices are available.
   */
  deactivateZeroPriceTours: adminProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db2
        .select({ id: toursTable.id, title: toursTable.title })
        .from(toursTable)
        .where(
          and(
            eq(toursTable.status, "active"),
            or(
              like(toursTable.sourceUrl, "%liontravel.com%"),
              like(toursTable.sourceUrl, "%uvbookings.com%"),
            ),
            or(
              sql`${toursTable.price} = 0`,
              sql`${toursTable.price} IS NULL`,
            ),
          ),
        );

      if (input.dryRun) {
        return {
          dryRun: true,
          wouldDeactivate: rows.length,
          samples: rows.slice(0, 5).map((r) => ({
            id: r.id,
            title: r.title?.slice(0, 60) ?? "",
          })),
        };
      }

      // Real deactivate — batch update
      let deactivated = 0;
      for (const r of rows) {
        try {
          await db2
            .update(toursTable)
            .set({ status: "inactive", updatedAt: new Date() })
            .where(eq(toursTable.id, r.id));
          deactivated++;
        } catch {
          // continue on error
        }
      }
      return { dryRun: false, deactivated };
    }),

  /**
   * Deactivate residual unhealthy tours after mass import + audit.
   * 2026-05-25: hides the ~95 active tours that have data-quality
   * issues (no image / no supplier detail / parse_failed). Customer
   * UX > catalog count.
   *
   * Three conditions, ANY triggers deactivation:
   *   1. Active + no heroImage AND no imageUrl (supplier source had
   *      no image — page Hero would render blank)
   *   2. Active + linked supplierProduct exists but supplierProductDetails
   *      row missing (deep sync never reached this product → no rich
   *      content for TourDetail)
   *   3. Active + supplierProductDetails exists but itineraryParseStatus
   *      != 'parsed' (parser couldn't extract — no day-by-day to show)
   */
  deactivateResidualUnhealthy: adminProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Pull all supplier-imported active tours + side-load supplier mirror
      const rows = await db2
        .select({
          id: toursTable.id,
          title: toursTable.title,
          heroImage: toursTable.heroImage,
          imageUrl: toursTable.imageUrl,
          sourceUrl: toursTable.sourceUrl,
        })
        .from(toursTable)
        .where(
          and(
            eq(toursTable.status, "active"),
            or(
              like(toursTable.sourceUrl, "%liontravel.com%"),
              like(toursTable.sourceUrl, "%uvbookings.com%"),
            ),
          ),
        );

      // Build code → productId / detail-status maps once
      const allProducts = await db2
        .select({
          id: productsTable.id,
          code: productsTable.externalProductCode,
        })
        .from(productsTable);
      const codeToProductId = new Map<string, number>();
      allProducts.forEach((p) => codeToProductId.set(p.code, p.id));

      const allDetails = await db2
        .select({
          supplierProductId: supplierProductDetails.supplierProductId,
          itineraryParseStatus: supplierProductDetails.itineraryParseStatus,
        })
        .from(supplierProductDetails);
      const productIdToStatus = new Map<number, string>();
      allDetails.forEach((d) =>
        productIdToStatus.set(d.supplierProductId, d.itineraryParseStatus),
      );

      const toDeactivate: Array<{
        id: number;
        title: string;
        reason: string;
      }> = [];

      for (const t of rows) {
        const reasons: string[] = [];
        if (!t.heroImage && !t.imageUrl) reasons.push("noImage");

        const code =
          t.sourceUrl?.match(/[?&]NormGroupID=([^&]+)/)?.[1] ||
          t.sourceUrl?.match(/\/product\/detail\/([^/?#]+)/)?.[1];
        if (code) {
          const productId = codeToProductId.get(code);
          if (productId === undefined) {
            // No mirror — that's actually noSupplierLink (already 0 per audit)
          } else {
            const status = productIdToStatus.get(productId);
            if (!status) reasons.push("noSupplierDetail");
            else if (status !== "parsed") reasons.push("itineraryNotParsed");
          }
        }

        if (reasons.length > 0) {
          toDeactivate.push({
            id: t.id,
            title: t.title?.slice(0, 60) ?? "",
            reason: reasons.join(","),
          });
        }
      }

      if (input.dryRun) {
        return {
          dryRun: true,
          wouldDeactivate: toDeactivate.length,
          byReason: toDeactivate.reduce<Record<string, number>>((acc, t) => {
            acc[t.reason] = (acc[t.reason] || 0) + 1;
            return acc;
          }, {}),
          samples: toDeactivate.slice(0, 5),
        };
      }

      let deactivated = 0;
      for (const t of toDeactivate) {
        try {
          await db2
            .update(toursTable)
            .set({ status: "inactive", updatedAt: new Date() })
            .where(eq(toursTable.id, t.id));
          deactivated++;
        } catch {
          // continue
        }
      }
      return { dryRun: false, deactivated };
    }),

  /**
   * Deep accuracy audit — beyond structural completeness. Checks:
   *   1. days field matches itinerary.days.length (if parsed)
   *   2. title length sane (10-300 chars, no placeholder words)
   *   3. price in reasonable range per currency (TWD 3000-500000, USD 100-30000)
   *   4. destinationCountry not empty
   *   5. currency in known ISO list
   *   6. duration/nights/days mutually consistent
   *   7. Distribution stats: price/days/country breakdowns + outliers
   *
   * Runs only on ACTIVE tours from supplier import.
   */
  deepAccuracyAudit: adminProcedure.query(async () => {
    const db2 = await getDb();
    if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const rows = await db2
      .select({
        id: toursTable.id,
        title: toursTable.title,
        price: toursTable.price,
        priceCurrency: toursTable.priceCurrency,
        duration: toursTable.duration,
        nights: toursTable.nights,
        destinationCountry: toursTable.destinationCountry,
        destinationCity: toursTable.destinationCity,
        departureCity: toursTable.departureCity,
        sourceUrl: toursTable.sourceUrl,
      })
      .from(toursTable)
      .where(
        and(
          eq(toursTable.status, "active"),
          or(
            like(toursTable.sourceUrl, "%liontravel.com%"),
            like(toursTable.sourceUrl, "%uvbookings.com%"),
          ),
        ),
      );

    // Pre-fetch all supplier detail itinerary day-counts for cross-check
    const allProducts = await db2
      .select({
        id: productsTable.id,
        code: productsTable.externalProductCode,
      })
      .from(productsTable);
    const codeToProductId = new Map<string, number>();
    allProducts.forEach((p) => codeToProductId.set(p.code, p.id));

    const allDetails = await db2
      .select({
        supplierProductId: supplierProductDetails.supplierProductId,
        itineraryParsed: supplierProductDetails.itineraryParsed,
      })
      .from(supplierProductDetails);
    const productIdToItineraryDays = new Map<number, number>();
    for (const d of allDetails) {
      if (!d.itineraryParsed) continue;
      try {
        const parsed = JSON.parse(d.itineraryParsed);
        if (parsed?.days?.length !== undefined) {
          productIdToItineraryDays.set(d.supplierProductId, parsed.days.length);
        }
      } catch {
        // skip
      }
    }

    const PLACEHOLDER_RE = /\b(TODO|test|測試|placeholder|XXX|新行程)\b/i;
    const VALID_CURRENCIES = new Set([
      "TWD", "USD", "CAD", "HKD", "CNY", "JPY", "KRW", "EUR", "GBP", "AUD",
    ]);
    const PRICE_RANGES: Record<string, { min: number; max: number }> = {
      TWD: { min: 3000, max: 500_000 },
      USD: { min: 100, max: 30_000 },
      CAD: { min: 100, max: 30_000 },
      HKD: { min: 800, max: 200_000 },
      CNY: { min: 600, max: 200_000 },
      JPY: { min: 10_000, max: 3_000_000 },
      EUR: { min: 90, max: 25_000 },
    };

    const problems = {
      daysMismatch: [] as Array<{
        id: number;
        title: string;
        tourDays: number;
        itineraryDays: number;
      }>,
      shortTitle: [] as Array<{ id: number; title: string }>,
      placeholderTitle: [] as Array<{ id: number; title: string }>,
      priceTooLow: [] as Array<{
        id: number;
        title: string;
        price: number;
        currency: string;
      }>,
      priceTooHigh: [] as Array<{
        id: number;
        title: string;
        price: number;
        currency: string;
      }>,
      unknownCurrency: [] as Array<{
        id: number;
        title: string;
        currency: string;
      }>,
      noDestinationCountry: [] as Array<{ id: number; title: string }>,
      durationMismatch: [] as Array<{
        id: number;
        title: string;
        duration: number;
        nights: number;
      }>,
    };

    // Distribution stats
    const priceBuckets: Record<string, number[]> = {};
    const dayBuckets: Record<number, number> = {};
    const countryBuckets: Record<string, number> = {};

    for (const t of rows) {
      const title = t.title?.slice(0, 60) ?? "";

      // 1. Title checks
      if (!t.title || t.title.length < 10) {
        problems.shortTitle.push({ id: t.id, title });
      }
      if (t.title && PLACEHOLDER_RE.test(t.title)) {
        problems.placeholderTitle.push({ id: t.id, title });
      }

      // 2. Currency check
      const currency = t.priceCurrency ?? "?";
      if (!VALID_CURRENCIES.has(currency)) {
        problems.unknownCurrency.push({ id: t.id, title, currency });
      }

      // 3. Price range
      const range = PRICE_RANGES[currency];
      const priceNum = t.price ?? 0;
      if (range && priceNum > 0) {
        if (priceNum < range.min) {
          problems.priceTooLow.push({
            id: t.id,
            title,
            price: priceNum,
            currency,
          });
        } else if (priceNum > range.max) {
          problems.priceTooHigh.push({
            id: t.id,
            title,
            price: priceNum,
            currency,
          });
        }
      }

      // 4. Destination country
      if (!t.destinationCountry || t.destinationCountry.trim() === "") {
        problems.noDestinationCountry.push({ id: t.id, title });
      }

      // 5. Duration / nights consistency
      // For domestic 1-day trips nights=0 is fine; otherwise nights should equal duration-1
      const nightsNum = t.nights ?? 0;
      if (t.duration > 1 && nightsNum !== t.duration - 1) {
        problems.durationMismatch.push({
          id: t.id,
          title,
          duration: t.duration,
          nights: nightsNum,
        });
      }

      // 6. Days vs itinerary cross-check
      const code =
        t.sourceUrl?.match(/[?&]NormGroupID=([^&]+)/)?.[1] ||
        t.sourceUrl?.match(/\/product\/detail\/([^/?#]+)/)?.[1];
      if (code) {
        const productId = codeToProductId.get(code);
        const itineraryDays = productId !== undefined
          ? productIdToItineraryDays.get(productId)
          : undefined;
        if (
          itineraryDays !== undefined &&
          itineraryDays > 0 &&
          Math.abs(itineraryDays - t.duration) > 1
        ) {
          problems.daysMismatch.push({
            id: t.id,
            title,
            tourDays: t.duration,
            itineraryDays,
          });
        }
      }

      // Stats
      if (currency && priceNum > 0) {
        priceBuckets[currency] = priceBuckets[currency] || [];
        priceBuckets[currency].push(priceNum);
      }
      dayBuckets[t.duration] = (dayBuckets[t.duration] || 0) + 1;
      const ctry = t.destinationCountry || "(unknown)";
      countryBuckets[ctry] = (countryBuckets[ctry] || 0) + 1;
    }

    // Compute stats per currency
    const priceStats: Record<
      string,
      { count: number; min: number; max: number; median: number; avg: number }
    > = {};
    for (const [cur, prices] of Object.entries(priceBuckets)) {
      const sorted = [...prices].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      priceStats[cur] = {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: sorted[Math.floor(sorted.length / 2)],
        avg: Math.round(sum / sorted.length),
      };
    }

    const topCountries = Object.entries(countryBuckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([country, count]) => ({ country, count }));

    return {
      totalAudited: rows.length,
      problemCounts: {
        daysMismatch: problems.daysMismatch.length,
        shortTitle: problems.shortTitle.length,
        placeholderTitle: problems.placeholderTitle.length,
        priceTooLow: problems.priceTooLow.length,
        priceTooHigh: problems.priceTooHigh.length,
        unknownCurrency: problems.unknownCurrency.length,
        noDestinationCountry: problems.noDestinationCountry.length,
        durationMismatch: problems.durationMismatch.length,
      },
      samples: {
        daysMismatch: problems.daysMismatch.slice(0, 5),
        shortTitle: problems.shortTitle.slice(0, 5),
        placeholderTitle: problems.placeholderTitle.slice(0, 5),
        priceTooLow: problems.priceTooLow.slice(0, 5),
        priceTooHigh: problems.priceTooHigh.slice(0, 5),
        unknownCurrency: problems.unknownCurrency.slice(0, 5),
        noDestinationCountry: problems.noDestinationCountry.slice(0, 5),
        durationMismatch: problems.durationMismatch.slice(0, 5),
      },
      stats: {
        priceStats,
        topCountries,
        dayDistribution: Object.entries(dayBuckets)
          .map(([d, c]) => ({ days: Number(d), count: c }))
          .sort((a, b) => a.days - b.days),
      },
    };
  }),

  /**
   * Force re-enrich ALL active products for a supplier, regardless of the
   * 7-day-stale check. Use when:
   *   - Parser code changed (e.g. daytripinfojson added 2026-05-25)
   *   - Need fresh data from supplier
   *
   * Enqueues every active product with timestamp-uniqued jobId so BullMQ
   * doesn't dedupe against previous backfill runs.
   */
  forceReEnrichAll: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
      }),
    )
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const allSuppliers = await db2
        .select({ id: suppliersTable.id, code: suppliersTable.code })
        .from(suppliersTable);
      const codeToId = new Map<string, number>();
      const idToCode = new Map<number, string>();
      allSuppliers.forEach((s) => {
        codeToId.set(s.code, s.id);
        idToCode.set(s.id, s.code);
      });

      const conditions = [eq(productsTable.status, "active")];
      if (input.supplierCode !== "all") {
        const sid = codeToId.get(input.supplierCode);
        if (sid !== undefined) {
          conditions.push(eq(productsTable.supplierId, sid));
        }
      }

      const rows = await db2
        .select({
          id: productsTable.id,
          supplierId: productsTable.supplierId,
          externalCode: productsTable.externalProductCode,
        })
        .from(productsTable)
        .where(and(...conditions));

      // Round-robin interleave (Lion + UV in parallel from worker's view)
      const lionRows: typeof rows = [];
      const uvRows: typeof rows = [];
      for (const row of rows) {
        const code = idToCode.get(row.supplierId);
        if (code === "lion") lionRows.push(row);
        else if (code === "uv") uvRows.push(row);
      }

      const stamp = Date.now();
      const counts: Record<string, number> = { lion: 0, uv: 0 };
      const maxLen = Math.max(lionRows.length, uvRows.length);
      for (let i = 0; i < maxLen; i++) {
        for (const [code, list] of [
          ["lion", lionRows] as const,
          ["uv", uvRows] as const,
        ]) {
          const row = list[i];
          if (!row) continue;
          await supplierDetailEnrichmentQueue.add(
            `force-${code}-${row.id}`,
            {
              supplierProductId: row.id,
              supplierCode: code,
              externalProductCode: row.externalCode,
              triggeredBy: "manual",
            },
            { jobId: `force-${code}-${row.id}-${stamp}` },
          );
          counts[code]++;
        }
      }

      return { enqueued: counts, total: counts.lion + counts.uv };
    }),

  /**
   * Rewrite all existing imported tour rows from the current
   * supplierProducts mirror. Updates fields:
   *   - title (latest supplier title)
   *   - price (latest min retailPrice from supplierDepartures)
   *   - destinationCountry/City (newly backfilled by re-enrichment)
   *   - departureCity, days, duration, nights, imageUrl, heroImage
   *
   * Use after `forceReEnrichAll` finishes to propagate fresh data into
   * customer-facing tour rows. NEVER modifies status (Jeff's manual
   * deactivate decisions are preserved).
   */
  rewriteAllImportedTours: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { supplierDepartures } = await import("../../drizzle/schema");

      // Pull all imported tours + matching supplier products
      const supplierFilter =
        input.supplierCode === "all"
          ? or(
              like(toursTable.sourceUrl, "%liontravel.com%"),
              like(toursTable.sourceUrl, "%uvbookings.com%"),
            )
          : input.supplierCode === "lion"
            ? like(toursTable.sourceUrl, "%liontravel.com%")
            : like(toursTable.sourceUrl, "%uvbookings.com%");

      const tours = await db2
        .select({
          id: toursTable.id,
          sourceUrl: toursTable.sourceUrl,
        })
        .from(toursTable)
        .where(supplierFilter);

      // Build code → supplierProduct lookup
      const allProducts = await db2
        .select({
          id: productsTable.id,
          code: productsTable.externalProductCode,
          title: productsTable.title,
          days: productsTable.days,
          departureCity: productsTable.departureCity,
          destinationCountry: productsTable.destinationCountry,
          destinationCity: productsTable.destinationCity,
          imageUrl: productsTable.imageUrl,
          currency: productsTable.currency,
        })
        .from(productsTable);
      const codeToProduct = new Map<string, (typeof allProducts)[0]>();
      allProducts.forEach((p) => codeToProduct.set(p.code, p));

      let updated = 0;
      let skipped = 0;
      const errors: Array<{ id: number; err: string }> = [];

      for (const t of tours) {
        const code =
          t.sourceUrl?.match(/[?&]NormGroupID=([^&]+)/)?.[1] ||
          t.sourceUrl?.match(/\/product\/detail\/([^/?#]+)/)?.[1];
        if (!code) {
          skipped++;
          continue;
        }
        const product = codeToProduct.get(code);
        if (!product) {
          skipped++;
          continue;
        }

        // Fetch min price from supplierDepartures
        const [priceRow] = await db2
          .select({
            minPrice: sql<string>`MIN(${supplierDepartures.retailPrice})`,
          })
          .from(supplierDepartures)
          .where(eq(supplierDepartures.supplierProductId, product.id));
        const price = Math.round(Number(priceRow?.minPrice ?? 0));

        if (input.dryRun) continue;

        try {
          await db2
            .update(toursTable)
            .set({
              title: product.title.slice(0, 200),
              price: price > 0 ? price : undefined,
              priceCurrency: product.currency,
              destinationCountry: product.destinationCountry ?? "",
              destinationCity:
                product.destinationCity ?? product.destinationCountry ?? "",
              departureCity: product.departureCity ?? "",
              duration: product.days,
              nights: Math.max(0, product.days - 1),
              imageUrl: product.imageUrl ?? "",
              heroImage: product.imageUrl ?? "",
              updatedAt: new Date(),
            } as never)
            .where(eq(toursTable.id, t.id));
          updated++;
        } catch (err) {
          errors.push({
            id: t.id,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }

      if (input.dryRun) {
        return {
          dryRun: true,
          wouldUpdate: tours.length - skipped,
          skipped,
        };
      }
      return {
        dryRun: false,
        updated,
        skipped,
        errors: errors.length,
        errorSamples: errors.slice(0, 5),
      };
    }),

  /* ────────────────────────── visibility toggle ───────────────────────── */

  /**
   * Mark a supplier product as hidden — won't appear in any catalog
   * UI even though it's still mirrored in DB. Useful when a supplier
   * has an inappropriate or brand-mismatched product. Reversible.
   */
  setHidden: adminProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        hidden: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(productsTable)
        .set({ isHiddenByAdmin: input.hidden })
        .where(eq(productsTable.id, input.productId));
      return { ok: true };
    }),
});

