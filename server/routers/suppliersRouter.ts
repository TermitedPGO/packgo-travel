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
import {
  hydrateTourFromParsed,
  safeParseJson,
} from "../services/supplierSync/hydration";
import type {
  NormalizedItinerary,
  NormalizedPriceTerms,
  NormalizedNotices,
  NormalizedOptional,
  NormalizedTourInfo,
} from "../services/supplierSync/types";

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
        // 2026-05-25 chunking — 45s renderer timeout can't process 4000+
        // rewrites in one call. Caller loops offset 0,200,400,... until
        // returned `processed` < limit.
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(200),
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
        .where(supplierFilter)
        .orderBy(toursTable.id)
        .limit(input.limit)
        .offset(input.offset);

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
          processed: tours.length,
          wouldUpdate: tours.length - skipped,
          skipped,
          offset: input.offset,
        };
      }
      return {
        dryRun: false,
        processed: tours.length,
        updated,
        skipped,
        errors: errors.length,
        errorSamples: errors.slice(0, 5),
        offset: input.offset,
      };
    }),

  /**
   * 2026-05-25 — hydrate rich-content tour columns from
   * supplierProductDetails parsed JSON. Zero LLM cost — pure
   * transformation. Closes the gap discovered in the completeness audit:
   * 4057/4191 (96.8%) active tours had no dailyItinerary / hotels /
   * meals / attractions / etc., even though supplierProductDetails has
   * 99.9% itinerary parsed coverage. Root cause: rewriteAllImportedTours
   * only updated 9 basic fields; never copied parsed JSON into the
   * tour's rich-content columns.
   *
   * Field mapping (see services/supplierSync/hydration.ts):
   *   itineraryParsed   → dailyItinerary, itineraryDetailed, hotels[],
   *                       meals[], attractions[], flights
   *   tourInfoParsed    → highlights[], keyFeatures[], extractedDepartures
   *   priceTermsParsed  → costExplanation
   *   noticesParsed     → noticeDetailed
   *   optionalParsed    → optionalTours[]
   *
   * Skips tours where `dailyItinerary` is already set (the 134 fully
   * AI-enriched tours keep their existing rich shape). Only touches
   * shallow supplier-imported tours.
   *
   * Idempotent — re-run safely after a fresh enrich.
   */
  hydrateFromParsed: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
        dryRun: z.boolean().default(true),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(200),
        /** Only touch tours where dailyItinerary IS NULL (default true). */
        onlyShallow: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const supplierFilter =
        input.supplierCode === "all"
          ? or(
              like(toursTable.sourceUrl, "%liontravel.com%"),
              like(toursTable.sourceUrl, "%uvbookings.com%"),
            )
          : input.supplierCode === "lion"
            ? like(toursTable.sourceUrl, "%liontravel.com%")
            : like(toursTable.sourceUrl, "%uvbookings.com%");

      // status='active' filter is essential — inactive tours often have
      // legacy short product codes (e.g. "MNKIXOWL05") that don't match
      // supplierProducts.externalProductCode (UUIDs). Without this, the
      // first batch returns inactive tours with broken codes and skips
      // 100% of them, hiding real hydration progress.
      const activeFilter = eq(toursTable.status, "active");

      // Chunk of tours to hydrate. JOIN to supplierProductDetails by
      // resolving productCode → supplierProduct.id → details.
      const rows = await db2
        .select({
          tourId: toursTable.id,
          productCode: toursTable.productCode,
          dailyItineraryExisting: toursTable.dailyItinerary,
          supplierTitle: productsTable.title,
          days: productsTable.days,
          destinationCountry: productsTable.destinationCountry,
          itineraryParsed: supplierProductDetails.itineraryParsed,
          priceTermsParsed: supplierProductDetails.priceTermsParsed,
          noticesParsed: supplierProductDetails.noticesParsed,
          optionalParsed: supplierProductDetails.optionalParsed,
          tourInfoParsed: supplierProductDetails.tourInfoParsed,
        })
        .from(toursTable)
        .leftJoin(
          productsTable,
          eq(productsTable.externalProductCode, toursTable.productCode),
        )
        .leftJoin(
          supplierProductDetails,
          eq(supplierProductDetails.supplierProductId, productsTable.id),
        )
        .where(
          input.onlyShallow
            ? and(activeFilter, supplierFilter, isNull(toursTable.dailyItinerary))
            : and(activeFilter, supplierFilter),
        )
        .orderBy(toursTable.id)
        .limit(input.limit)
        .offset(input.offset);

      let updated = 0;
      let skipped = 0;
      const fieldCounts: Record<string, number> = {};
      const errors: Array<{ id: number; err: string }> = [];

      for (const r of rows) {
        // Skip if there's no detail row (mass-import-only, never enriched).
        if (!r.itineraryParsed && !r.tourInfoParsed && !r.priceTermsParsed) {
          skipped++;
          continue;
        }

        const hydrated = hydrateTourFromParsed({
          itinerary: safeParseJson<NormalizedItinerary>(r.itineraryParsed),
          priceTerms: safeParseJson<NormalizedPriceTerms>(r.priceTermsParsed),
          notices: safeParseJson<NormalizedNotices>(r.noticesParsed),
          optional: safeParseJson<NormalizedOptional>(r.optionalParsed),
          tourInfo: safeParseJson<NormalizedTourInfo>(r.tourInfoParsed),
          supplierTitle: r.supplierTitle ?? undefined,
          days: r.days ?? undefined,
          destinationCountry: r.destinationCountry ?? undefined,
        });

        const keys = Object.keys(hydrated) as Array<keyof typeof hydrated>;
        if (keys.length === 0) {
          skipped++;
          continue;
        }

        for (const k of keys) fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;

        if (input.dryRun) continue;

        try {
          await db2
            .update(toursTable)
            .set({ ...hydrated, updatedAt: new Date() } as never)
            .where(eq(toursTable.id, r.tourId));
          updated++;
        } catch (err) {
          errors.push({
            id: r.tourId,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }

      return {
        dryRun: input.dryRun,
        processed: rows.length,
        updated: input.dryRun ? rows.length - skipped : updated,
        skipped,
        offset: input.offset,
        fieldCounts,
        errors: errors.length,
        errorSamples: errors.slice(0, 5),
      };
    }),

  /**
   * Backfill destinationCountry on supplierProducts from title regex.
   * 2026-05-25: Lion's GroupInfo.Country is the DEPARTURE country (always
   * "TW" since Lion is a Taiwanese travel agency), not destination.
   * Extract real destination from product title using keyword regex.
   *
   * Coverage target: 90%+ of products via comprehensive keyword map.
   * Remaining 10% get LLM extract later (out of scope for this pass).
   */
  backfillCountryFromTitle: adminProcedure
    .input(
      z.object({
        supplierCode: z.enum(["lion", "uv", "all"]).default("all"),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Comprehensive keyword → country map. Order matters — more specific
      // patterns first (e.g. "澳門" before "中國").
      const COUNTRY_PATTERNS: Array<{ re: RegExp; country: string }> = [
        // Cruise — highest priority. "郵輪" overrides region detection.
        { re: /郵輪|遊輪|cruise|Cruise|麗星郵輪|皇家加勒比|公主郵輪|歌詩達|嘉年華郵輪|挪威郵輪|愛達郵輪|MSC|海洋航跡|地中海郵輪/, country: "郵輪" },
        // Pacific island destinations (specific before generic)
        { re: /帛琉|Palau/, country: "帛琉" },
        { re: /關島|塞班島|塞班|Guam|Saipan/, country: "美國" },
        { re: /斐濟|Fiji/, country: "斐濟" },
        { re: /大溪地|Tahiti|Bora Bora|玻里尼西亞/, country: "大溪地" },
        { re: /馬爾地夫|Maldives/, country: "馬爾地夫" },
        { re: /模里西斯|Mauritius/, country: "模里西斯" },
        { re: /賽舌爾|Seychelles/, country: "賽舌爾" },
        // Macau / Hong Kong (specific before China)
        { re: /澳門/, country: "澳門" },
        { re: /香港/, country: "香港" },
        // Japan — region names + cities (most common for Lion)
        { re: /日本|北海道|沖繩|九州|本州|四國|關西|關東|北陸|東北|信州|中部|京阪神|東京|大阪|京都|奈良|神戶|名古屋|福岡|札幌|函館|仙台|富士|箱根|立山黑部|白川鄉|合掌村|上高地|飛驒|金澤|高山|輕井澤|箱根|草津|別府|長崎|鹿兒島|熊本|宮崎|沖繩|石垣|宮古|那霸|首里|岡山|廣島|姬路|倉敷|出雲|松山|高松|岩手|青森|秋田|山形|宮城|福島|新潟|長野|靜岡|岐阜|三重|和歌山|滋賀|京阪|阪神/, country: "日本" },
        // Korea
        { re: /韓國|首爾|釜山|濟州|江原道|大邱|仁川|慶州/, country: "韓國" },
        // Thailand
        { re: /泰國|曼谷|清邁|普吉|芭達雅|清萊|蘇梅島|華欣|大城/, country: "泰國" },
        // Vietnam
        { re: /越南|河內|胡志明|峴港|下龍灣|順化|會安|芽莊|沙壩/, country: "越南" },
        // Malaysia / Singapore
        { re: /馬來西亞|吉隆坡|檳城|沙巴|蘭卡威|新山/, country: "馬來西亞" },
        { re: /新加坡|聖淘沙|濱海灣/, country: "新加坡" },
        // Indonesia / Philippines / Cambodia
        { re: /印尼|峇里|巴里島|雅加達|日惹|龍目島/, country: "印尼" },
        { re: /菲律賓|長灘島|宿霧|馬尼拉|薄荷島|巴拉望/, country: "菲律賓" },
        { re: /柬埔寨|金邊|吳哥/, country: "柬埔寨" },
        // China
        { re: /中國|北京|上海|廣州|深圳|杭州|西安|成都|重慶|蘇州|無錫|南京|張家界|九寨溝|黃山|桂林|雲南|麗江|昆明|敦煌|新疆|西藏|拉薩|內蒙古|江南|徽州|烏鎮|周庄|普陀山|青島|大連|哈爾濱|長江|三峽|武漢|長沙|福州|廈門/, country: "中國" },
        // Central Asia
        { re: /中亞|哈薩克|吉爾吉斯|烏茲別克|塔吉克|土庫曼|Kazakhstan|Uzbekistan|Kyrgyzstan/, country: "中亞" },
        // Balkans
        { re: /克羅埃西亞|波士尼亞|蒙特內哥羅|塞爾維亞|斯洛維尼亞|阿爾巴尼亞|科托|杜布羅尼克|十六湖|波蒙|波斯尼亞|巴爾幹/, country: "巴爾幹" },
        // Taiwan (Lion has many domestic Taiwan products)
        { re: /台灣|台北|新北|桃園|高雄|台中|台南|花蓮|台東|花東|宜蘭|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|基隆|澎湖|金門|馬祖|綠島|蘭嶼|小琉球|龜山島|阿里山|日月潭|墾丁|九份|淡水|烏來|淡江|漁人碼頭|觀音山|高鐵|台鐵|太魯閣|清境|合歡山|雪霸|雙北|奮起湖|集集|大溪老街|金針花海|象山|陽明山|北投/, country: "台灣" },
        // Europe
        { re: /義大利|羅馬|威尼斯|佛羅倫斯|米蘭|那不勒斯|西西里|龐貝|阿瑪菲/, country: "義大利" },
        { re: /法國|巴黎|尼斯|馬賽|普羅旺斯|波爾多|里昂|聖米歇爾/, country: "法國" },
        { re: /英國|倫敦|愛丁堡|曼徹斯特|蘇格蘭|湖區|牛津|劍橋/, country: "英國" },
        { re: /德國|柏林|慕尼黑|科隆|法蘭克福|海德堡|羅曼蒂克大道/, country: "德國" },
        { re: /西班牙|巴塞隆納|馬德里|塞維亞|格拉納達/, country: "西班牙" },
        { re: /瑞士|蘇黎世|日內瓦|盧森|少女峰|馬特洪|因特拉肯/, country: "瑞士" },
        { re: /奧地利|維也納|薩爾斯堡|因斯布魯克|哈爾施塔特/, country: "奧地利" },
        { re: /荷蘭|阿姆斯特丹|庫肯霍夫|風車村/, country: "荷蘭" },
        { re: /希臘|雅典|聖托里尼|米克諾斯/, country: "希臘" },
        { re: /葡萄牙|里斯本|波多/, country: "葡萄牙" },
        { re: /捷克|布拉格|庫倫洛夫/, country: "捷克" },
        { re: /匈牙利|布達佩斯/, country: "匈牙利" },
        { re: /北歐|挪威|瑞典|丹麥|芬蘭|冰島|赫爾辛基|斯德哥爾摩|奧斯陸|哥本哈根|雷克雅維克/, country: "北歐" },
        { re: /東歐|波蘭|斯洛伐克|斯洛維尼亞|克羅埃西亞|塞爾維亞|保加利亞|羅馬尼亞/, country: "東歐" },
        { re: /俄羅斯|莫斯科|聖彼得堡|貝加爾湖/, country: "俄羅斯" },
        { re: /土耳其|伊斯坦堡|卡帕多奇亞|棉堡|安塔利亞/, country: "土耳其" },
        // Americas (Chinese + English city/state/landmark names for UV catalog)
        { re: /美國|美西|美東|紐約|洛杉磯|舊金山|拉斯維加斯|夏威夷|阿拉斯加|黃石|大峽谷|波士頓|華盛頓|邁阿密|奧蘭多|西雅圖|芝加哥|New York|NYC|Los Angeles|LA tour|Las Vegas|San Francisco|Hawaii|Alaska|Yellowstone|Grand Canyon|Boston|Washington|Miami|Orlando|Seattle|Chicago|California|Texas|Florida|Virginia|Nevada|Arizona|Utah|Colorado|Oregon|Wyoming|Sedona|Monument Valley|Bryce|Zion|Yosemite|Tahoe|Snoqualmie|Leavenworth|Key West|Shenandoah|Philadelphia|Atlantic City|Antelope|Horseshoe|Death Valley|Lake Powell|Salt Lake|Reno|Denver|Aspen|Portland|Honolulu|Maui|Big Island|Kauai|Oahu|Cape Cod|Acadia|Smoky Mountain|New Orleans|Nashville|Memphis|Austin|San Diego|Anaheim|Disneyland|Universal|Napa|Sonoma|Carmel|Monterey|San Antonio|Houston|Dallas|Phoenix|Tucson|Albuquerque|Santa Fe|Mount Rushmore|Glacier|Rocky Mountain|Sequoia|Joshua Tree|Niagara|Mount Rainier|Thousand Islands|Cornell|17 Miles|17-Miles|Pebble Beach|Valley of Fire|Walt Disney World|Sea World|Catalina|Yosemite|Olympic National/, country: "美國" },
        { re: /加拿大|溫哥華|多倫多|蒙特婁|渥太華|魁北克|班夫|落磯山|尼加拉|Vancouver|Toronto|Montreal|Ottawa|Quebec|Banff|Rocky|Whistler|Jasper|Calgary|Edmonton|Victoria|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|Newfoundland|Yukon|Halifax|Winnipeg|Saskatoon|Regina|Mississauga|Brampton|Markham|Burnaby|Surrey|Squamish|Tofino|Okanagan|Kelowna|Kamloops|Nanaimo|PEI|Prince Edward/, country: "加拿大" },
        { re: /墨西哥|坎昆|墨西哥城|Mexico|Cancun|Tulum|Playa del Carmen|Cabo|Riviera Maya/, country: "墨西哥" },
        // Oceania
        { re: /澳洲|澳大利亞|雪梨|墨爾本|布里斯本|黃金海岸|凱恩斯|大堡礁|烏魯魯/, country: "澳洲" },
        { re: /紐西蘭|奧克蘭|皇后鎮|基督城|羅托魯瓦/, country: "紐西蘭" },
        // Middle East / Africa
        { re: /杜拜|阿聯|阿布達比|沙烏地/, country: "阿聯" },
        { re: /埃及|開羅|金字塔|尼羅河/, country: "埃及" },
        { re: /南非|開普敦|約翰尼斯堡|克魯格/, country: "南非" },
        { re: /摩洛哥|馬拉喀什/, country: "摩洛哥" },
        // South Asia
        { re: /印度|新德里|孟買|齋浦爾|阿格拉|泰姬陵|喀什米爾/, country: "印度" },
        { re: /斯里蘭卡|可倫坡|加勒|錫吉里亞/, country: "斯里蘭卡" },
        { re: /尼泊爾|加德滿都|波卡拉|安納普爾納|喜馬拉雅/, country: "尼泊爾" },
        { re: /不丹|廷布|帕羅/, country: "不丹" },
        // South America (Chinese + English)
        { re: /秘魯|庫斯科|馬丘比丘|利馬|Peru|Lima|Machu Picchu|Cusco|Sacred Valley/, country: "秘魯" },
        { re: /阿根廷|布宜諾斯艾利斯|巴塔哥尼亞|Argentina|Buenos Aires|Patagonia/, country: "阿根廷" },
        { re: /巴西|里約|聖保羅|伊瓜蘇|Brazil|Rio de Janeiro|São Paulo|Sao Paulo|Iguazu|Catedral Metropolitana|Brasil/, country: "巴西" },
        { re: /智利|聖地牙哥.*智利|復活節島|Chile|Easter Island/, country: "智利" },
        { re: /哥倫比亞|麥德林|Colombia|Bogotá|Bogota/, country: "哥倫比亞" },
        // Europe catch-all (after all specific Euro countries) — for
        // multi-country tours like "歐洲十國 14 日" that don't single out
        // one destination.
        { re: /歐洲|歐多國|歐洲多國/, country: "歐洲" },
      ];

      function countryFromTitle(title: string | null | undefined): string | null {
        if (!title) return null;
        for (const { re, country } of COUNTRY_PATTERNS) {
          if (re.test(title)) return country;
        }
        return null;
      }

      const allSuppliers = await db2
        .select({ id: suppliersTable.id, code: suppliersTable.code })
        .from(suppliersTable);
      const codeToId = new Map<string, number>();
      allSuppliers.forEach((s) => codeToId.set(s.code, s.id));

      const conditions = [eq(productsTable.status, "active")];
      if (input.supplierCode !== "all") {
        const sid = codeToId.get(input.supplierCode);
        if (sid !== undefined) conditions.push(eq(productsTable.supplierId, sid));
      }

      const rows = await db2
        .select({
          id: productsTable.id,
          title: productsTable.title,
          currentCountry: productsTable.destinationCountry,
        })
        .from(productsTable)
        .where(and(...conditions));

      const toUpdate: Array<{ id: number; newCountry: string; title: string }> = [];
      const noMatch: string[] = [];
      const byCountry: Record<string, number> = {};
      for (const r of rows) {
        const matched = countryFromTitle(r.title);
        if (!matched) {
          if (noMatch.length < 20) noMatch.push(r.title?.slice(0, 60) ?? "");
          continue;
        }
        byCountry[matched] = (byCountry[matched] || 0) + 1;
        if (r.currentCountry !== matched) {
          toUpdate.push({ id: r.id, newCountry: matched, title: r.title.slice(0, 60) });
        }
      }

      if (input.dryRun) {
        return {
          dryRun: true,
          totalProducts: rows.length,
          wouldUpdate: toUpdate.length,
          noMatchCount: rows.length - toUpdate.length - Object.values(byCountry).reduce((s, n) => s + n, 0) + toUpdate.length,
          countryDistribution: byCountry,
          noMatchSamples: noMatch.slice(0, 10),
          updateSamples: toUpdate.slice(0, 5),
        };
      }

      let updated = 0;
      for (const u of toUpdate) {
        try {
          await db2
            .update(productsTable)
            .set({ destinationCountry: u.newCountry })
            .where(eq(productsTable.id, u.id));
          updated++;
        } catch {
          // continue
        }
      }
      return {
        dryRun: false,
        updated,
        countryDistribution: byCountry,
        noMatchCount: noMatch.length,
        noMatchSamples: noMatch.slice(0, 10),
      };
    }),

  /**
   * Trigger LLM rewrite for a SINGLE tour (manual featured-only flow).
   * 2026-05-25: After deep sync ships, supplier shells render fine via
   * M6 SupplierDetailSection. LLM rewrite is now a curatorial decision
   * for featured/招牌團 tours — costs ~$0.20/tour × 4191 = $1250 if
   * mass-applied, so we restrict to manual trigger.
   *
   * Budget check: refuses if current month LLM spend > $40 (10% safety
   * margin under the $50/mo scaling guardrail).
   *
   * Dispatches to existing tourGenerationQueue → masterAgent pipeline.
   * On success, masterAgent creates a NEW tour row + flips the source
   * draft to status='inactive' (per existing worker.ts logic).
   */
  rewriteTourWithLLM: adminProcedure
    .input(z.object({ tourId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [tour] = await db2
        .select({ id: toursTable.id, sourceUrl: toursTable.sourceUrl, title: toursTable.title })
        .from(toursTable)
        .where(eq(toursTable.id, input.tourId))
        .limit(1);
      if (!tour) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
      }
      if (!tour.sourceUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tour has no sourceUrl — cannot rewrite via supplier pipeline",
        });
      }

      // Budget check — refuse if monthly LLM spend > $40
      const { llmUsageLogs } = await import("../../drizzle/schema");
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [costRow] = await db2
        .select({
          total: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, monthStart));
      const monthSpendUsd = parseFloat(costRow?.total ?? "0");
      const BUDGET_CAP = 40;
      if (monthSpendUsd >= BUDGET_CAP) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `LLM budget reached ($${monthSpendUsd.toFixed(2)}/$${BUDGET_CAP}). Wait until next month or raise cap.`,
        });
      }

      // Fire rewrite via existing queue helper
      const { queueRewriteForImportedTours } = await import(
        "../services/lionBulkImportService"
      );
      const result = await queueRewriteForImportedTours([input.tourId], {
        userId: ctx.user.id,
      });
      if (result.queued === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Queue add failed (sourceUrl resolution or BullMQ error)",
        });
      }
      return {
        queued: result.queued,
        tourTitle: tour.title.slice(0, 80),
        monthSpendUsd: monthSpendUsd.toFixed(2),
        budgetCap: BUDGET_CAP,
        budgetRemainingUsd: (BUDGET_CAP - monthSpendUsd).toFixed(2),
        estimatedCostUsd: "0.15-0.30",
        estimatedTimeMin: "2-3",
      };
    }),

  /**
   * Queue LLM rewrite for top-priority tours. 2026-05-25: with $50/mo
   * budget cap, ~250 tours/month max. Pick the most strategically
   * important by score:
   *   +20 isFeatured
   *   +10 PACK&GO core destinations (美西/紐約/夏威夷/中國簽證)
   *   +8  日本 (largest bucket, hot market)
   *   +5  Other mainstream Asia (韓國/泰國/越南/中國)
   *   +5  Has parsed itinerary (LLM has rich source data)
   *   +3  Has heroImage filled (better visual)
   *   +1  Reasonable price (TWD 20000-100000 / USD 500-3000 range)
   *
   * Hard budget guard: refuses if estimated cost > remaining budget.
   * Sequential queue add — 1 BullMQ job per tour. Worker concurrency 1
   * (heavy LLM task per the existing config). ~3 min/tour throughput.
   *
   * dryRun=true returns top N scored tours without queueing.
   */
  queuePriorityRewrites: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db2 = await getDb();
      if (!db2) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Budget check
      const { llmUsageLogs } = await import("../../drizzle/schema");
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [costRow] = await db2
        .select({
          total: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, monthStart));
      const monthSpendUsd = parseFloat(costRow?.total ?? "0");
      const BUDGET_CAP = 40;
      const COST_PER_TOUR = 0.2;
      const budgetRemaining = BUDGET_CAP - monthSpendUsd;
      const maxByBudget = Math.floor(budgetRemaining / COST_PER_TOUR);
      const actualLimit = Math.min(input.limit, Math.max(0, maxByBudget));

      if (actualLimit === 0 && !input.dryRun) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Budget exhausted: $${monthSpendUsd.toFixed(2)}/$${BUDGET_CAP}. Wait until next month.`,
        });
      }

      // 2. Fetch candidate tours (active supplier-imported + not already
      // rewritten — heuristic: empty description = supplier shell)
      const rows = await db2
        .select({
          id: toursTable.id,
          title: toursTable.title,
          destinationCountry: toursTable.destinationCountry,
          price: toursTable.price,
          priceCurrency: toursTable.priceCurrency,
          heroImage: toursTable.heroImage,
          featured: toursTable.featured,
          description: toursTable.description,
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
            // Skip already-rewritten (has real description)
            or(
              isNull(toursTable.description),
              sql`LENGTH(${toursTable.description}) < 100`,
            ),
          ),
        );

      // 3. Score each candidate
      const CORE_DESTS = new Set(["美國", "夏威夷", "中國"]);
      const TIER2_DESTS = new Set(["日本"]);
      const TIER3_DESTS = new Set(["韓國", "泰國", "越南"]);

      const scored = rows.map((t) => {
        let score = 0;
        if (t.featured) score += 20;
        const country = t.destinationCountry ?? "";
        if (CORE_DESTS.has(country)) score += 10;
        else if (TIER2_DESTS.has(country)) score += 8;
        else if (TIER3_DESTS.has(country)) score += 5;
        if (t.heroImage) score += 3;
        const price = t.price ?? 0;
        const cur = t.priceCurrency ?? "TWD";
        const inRange =
          (cur === "TWD" && price >= 20000 && price <= 100000) ||
          (cur === "USD" && price >= 500 && price <= 3000);
        if (inRange) score += 1;
        return { ...t, score };
      });

      // 4. Sort by score desc + take top N
      scored.sort((a, b) => b.score - a.score);
      const picked = scored.slice(0, actualLimit);

      if (input.dryRun) {
        return {
          dryRun: true,
          monthSpendUsd: monthSpendUsd.toFixed(2),
          budgetCap: BUDGET_CAP,
          budgetRemainingUsd: budgetRemaining.toFixed(2),
          maxByBudget,
          requested: input.limit,
          actualLimit,
          candidatePool: scored.length,
          estimatedCostUsd: (actualLimit * COST_PER_TOUR).toFixed(2),
          estimatedTotalMin: actualLimit * 3,
          scoreDistribution: {
            score20Plus: scored.filter((s) => s.score >= 20).length,
            score10to19: scored.filter((s) => s.score >= 10 && s.score < 20).length,
            score5to9: scored.filter((s) => s.score >= 5 && s.score < 10).length,
            scoreBelow5: scored.filter((s) => s.score < 5).length,
          },
          topSamples: picked.slice(0, 10).map((t) => ({
            id: t.id,
            score: t.score,
            country: t.destinationCountry,
            title: t.title?.slice(0, 60) ?? "",
          })),
        };
      }

      // 5. Real queue — fire rewrite for each
      const { queueRewriteForImportedTours } = await import(
        "../services/lionBulkImportService"
      );
      const result = await queueRewriteForImportedTours(
        picked.map((p) => p.id),
        { userId: ctx.user.id },
      );
      return {
        dryRun: false,
        queued: result.queued,
        budgetSpentThisCallUsd: (result.queued * COST_PER_TOUR).toFixed(2),
        budgetRemainingAfterUsd: (
          budgetRemaining -
          result.queued * COST_PER_TOUR
        ).toFixed(2),
        estimatedTotalMin: result.queued * 3,
        topSamples: picked.slice(0, 5).map((t) => ({
          id: t.id,
          score: t.score,
          country: t.destinationCountry,
          title: t.title?.slice(0, 60) ?? "",
        })),
      };
    }),

  /**
   * Manual trigger for the monthly priority-rewrite cron. Useful when Jeff
   * tops up Anthropic credit mid-month and wants to start the next batch
   * immediately instead of waiting for the 1st-of-month cron. Same budget
   * checks apply.
   */
  triggerPriorityRewriteCron: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { runPriorityRewriteCron } = await import(
        "../queues/priorityRewriteCron"
      );
      return runPriorityRewriteCron("manual", { limit: input.limit });
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

