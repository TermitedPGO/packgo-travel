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

      for (const row of rows) {
        const code = supplierMap.get(row.supplierId);
        if (code !== "lion" && code !== "uv") continue;
        if (input.supplierCode !== "all" && input.supplierCode !== code) continue;

        await supplierDetailEnrichmentQueue.add(
          `enrich-${code}-${row.id}`,
          {
            supplierProductId: row.id,
            supplierCode: code as "lion" | "uv",
            externalProductCode: row.externalCode,
            triggeredBy: "manual",
          },
          { jobId: `backfill-${code}-${row.id}` },
        );
        enqueueCounts[code]++;
      }

      return {
        enqueued: enqueueCounts,
        total: enqueueCounts.lion + enqueueCounts.uv,
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

