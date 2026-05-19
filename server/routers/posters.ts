/**
 * Posters router — Round 80.22 Phase H2: supplier poster distribution.
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (7):
 *   - create           – kick off processing of an uploaded raw poster
 *   - list             – paginated list with status filter
 *   - get              – one poster + its 7 platform copies
 *   - updateCopy       – edit single platform copy
 *   - regenerateImage  – queue re-generation
 *   - archive          – archive poster
 *   - approve          – promote draft copies to approved
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const postersRouter = router({
    /**
     * Admin: kick off processing on a freshly-uploaded raw poster.
     * Caller must have ALREADY uploaded the image to S3 via /api/upload/image
     * and obtained the URL (same flow as other admin image uploads).
     */
    create: adminProcedure
      .input(
        z.object({
          originalImageUrl: z.string().url().max(1024),
          originalCopyText: z.string().max(10_000).optional(),
          // Session B simplification: vendor + audience are rarely supplied
          // by Jeff — the AI infers them from the poster. Defaults let the
          // composer ship just (image, copy) without forcing dropdowns.
          sourceVendor: z
            .enum(["lion", "zongheng", "house", "other"])
            .default("other"),
          targetAudience: z
            .enum(["family", "honeymoon", "parent_child", "business", "senior", "general"])
            .default("general"),
          title: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../../drizzle/schema");

        const result = await drizzleDb.insert(posterAssets).values({
          sourceVendor: input.sourceVendor,
          targetAudience: input.targetAudience,
          originalImageUrl: input.originalImageUrl,
          originalCopyText: input.originalCopyText ?? null,
          title: input.title ?? null,
          status: "uploaded",
          createdBy: ctx.user.id,
        });
        const posterAssetId = (result as any)[0]?.insertId ?? 0;

        // Enqueue async processing (returns immediately, ~30s in background)
        try {
          const { enqueuePosterProcessing } = await import(
            "../queues/posterProcessingQueue"
          );
          await enqueuePosterProcessing(posterAssetId);
        } catch (err) {
          console.error("[posters.create] Failed to enqueue:", err);
          // Mark failed so admin knows
          const { eq } = await import("drizzle-orm");
          await drizzleDb
            .update(posterAssets)
            .set({ status: "failed", notes: "Failed to enqueue processing" })
            .where(eq(posterAssets.id, posterAssetId));
        }

        return { id: posterAssetId };
      }),

    /** Admin: list posters (most recent first) with status filter. */
    list: adminProcedure
      .input(
        z.object({
          status: z
            .enum([
              "uploaded",
              "processing",
              "ready",
              "approved",
              "distributed",
              "archived",
              "failed",
              "all",
            ])
            .default("all"),
          limit: z.number().int().positive().max(100).default(30),
          cursor: z.number().int().optional(),
        })
      )
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { items: [], nextCursor: null };
        const { posterAssets } = await import("../../drizzle/schema");
        const { eq, and, lt, desc } = await import("drizzle-orm");
        const filters = [];
        if (input.status !== "all") filters.push(eq(posterAssets.status, input.status));
        if (input.cursor) filters.push(lt(posterAssets.id, input.cursor));
        const whereClause = filters.length ? and(...filters) : undefined;
        const rows = await drizzleDb
          .select()
          .from(posterAssets)
          .where(whereClause)
          .orderBy(desc(posterAssets.id))
          .limit(input.limit + 1);
        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
      }),

    /** Admin: get one poster + its 7 platform copies. Used for review page. */
    get: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return null;
        const { posterAssets, posterPlatformCopies } = await import(
          "../../drizzle/schema"
        );
        const { eq } = await import("drizzle-orm");
        const [poster] = await drizzleDb
          .select()
          .from(posterAssets)
          .where(eq(posterAssets.id, input.id))
          .limit(1);
        if (!poster) return null;
        const copies = await drizzleDb
          .select()
          .from(posterPlatformCopies)
          .where(eq(posterPlatformCopies.posterAssetId, input.id));
        return { poster, copies };
      }),

    /** Admin: update a single platform copy (edit text or hashtags). */
    updateCopy: adminProcedure
      .input(
        z.object({
          copyId: z.number().int().positive(),
          copyText: z.string().max(10_000).optional(),
          hashtags: z.string().max(2000).nullable().optional(),
          status: z.enum(["draft", "approved", "posted", "skipped"]).optional(),
          postedUrl: z.string().max(1024).nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterPlatformCopies } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const updates: any = {};
        if (input.copyText !== undefined) updates.copyText = input.copyText;
        if (input.hashtags !== undefined) updates.hashtags = input.hashtags;
        if (input.status !== undefined) {
          updates.status = input.status;
          if (input.status === "posted") updates.postedAt = new Date();
        }
        if (input.postedUrl !== undefined) updates.postedUrl = input.postedUrl;
        if (input.notes !== undefined) updates.notes = input.notes;
        await drizzleDb
          .update(posterPlatformCopies)
          .set(updates)
          .where(eq(posterPlatformCopies.id, input.copyId));
        return { ok: true };
      }),

    /** Admin: regenerate the AI poster image (call gpt-image-2 again). */
    regenerateImage: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(posterAssets)
          .set({ status: "processing" })
          .where(eq(posterAssets.id, input.id));
        const { enqueuePosterProcessing } = await import(
          "../queues/posterProcessingQueue"
        );
        await enqueuePosterProcessing(input.id);
        return { ok: true };
      }),

    /** Admin: archive a poster (no longer surface in active queue). */
    archive: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await drizzleDb
          .update(posterAssets)
          .set({ status: "archived" })
          .where(eq(posterAssets.id, input.id));
        return { ok: true };
      }),

    /** Admin: mark whole poster as approved (all copies considered ready). */
    approve: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const { posterAssets, posterPlatformCopies } = await import(
          "../../drizzle/schema"
        );
        const { eq, and } = await import("drizzle-orm");
        await drizzleDb.transaction(async (tx) => {
          await tx
            .update(posterAssets)
            .set({ status: "approved" })
            .where(eq(posterAssets.id, input.id));
          // Promote all draft copies to approved (skip ones already 'posted'/'skipped')
          await tx
            .update(posterPlatformCopies)
            .set({ status: "approved" })
            .where(
              and(
                eq(posterPlatformCopies.posterAssetId, input.id),
                eq(posterPlatformCopies.status, "draft")
              )
            );
        });
        return { ok: true };
      }),
  });
