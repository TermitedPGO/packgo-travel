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
import { and, desc, eq, gte, like, lte, ne, sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  suppliers as suppliersTable,
  supplierProducts as productsTable,
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
        // LEFT JOIN to tours.productCode is the obvious SQL move but
        // Drizzle's pre-SQL builder doesn't compose that cleanly with
        // pagination — use a NOT IN subquery for clarity.
        const imported = db
          .select({ code: toursTable.productCode })
          .from(toursTable)
          .where(ne(toursTable.productCode, ""));
        conditions.push(
          sql`${productsTable.externalProductCode} NOT IN (${imported})`
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
      const conditions = [
        eq(productsTable.supplierId, supRow[0].id),
        eq(productsTable.status, "active"),
        eq(productsTable.isHiddenByAdmin, false),
        sql`${productsTable.externalProductCode} NOT IN (${db
          .select({ code: toursTable.productCode })
          .from(toursTable)
          .where(ne(toursTable.productCode, ""))})`,
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

