/**
 * Poster generation router — admin AI poster composer (v78z-z3).
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1).
 *
 * Procedures (6):
 *   - uploadReference   – persist reference asset to marketingAssets
 *   - listReferences    – list reference assets with signed URLs
 *   - deleteReference   – delete a reference asset row
 *   - generate          – gpt-image-2 generate OR edit (with parent)
 *   - listIterations    – chronological iteration list per projectKey
 *   - getCostStatus     – daily/monthly spend totals + recent logs
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const posterGenRouter = router({
    /**
     * Upload a reference asset (logo / photo / past poster / scene ref) to
     * the marketingAssets library. Asset is base64-encoded in the request
     * for simplicity (max ~5 MB; chunked upload is Phase B).
     */
    uploadReference: adminProcedure
      .input(
        z.object({
          kind: z.enum(["logo", "photo", "past_poster", "scene_ref"]),
          label: z.string().min(1).max(200),
          mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          base64Data: z.string().max(7_500_000), // ~5MB after base64 expansion
          notes: z.string().max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { storagePut } = await import("../storage");
        const { marketingAssets } = await import("../../drizzle/schema");
        const sharpMod = (await import("sharp")).default;
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        const buf = Buffer.from(input.base64Data, "base64");
        const meta = await sharpMod(buf).metadata();

        const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
        const ts = Date.now();
        const safeLabel = input.label.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 40);
        const key = `marketing-assets/${input.kind}/${ts}-${safeLabel}.${ext}`;
        await storagePut(key, buf, input.mimeType);

        const [insertResult] = await drizzleDb.insert(marketingAssets).values({
          ownerId: ctx.user?.id ?? null,
          kind: input.kind,
          label: input.label,
          storageKey: key,
          width: meta.width ?? null,
          height: meta.height ?? null,
          fileSize: buf.length,
          mimeType: input.mimeType,
          notes: input.notes ?? null,
        } as any) as any;

        return {
          id: Number(insertResult?.insertId ?? 0),
          storageKey: key,
        };
      }),

    /** List reference assets, optionally filtered by kind. */
    listReferences: adminProcedure
      .input(z.object({ kind: z.enum(["logo", "photo", "past_poster", "scene_ref", "all"]).default("all") }))
      .query(async ({ input }) => {
        const { marketingAssets } = await import("../../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const { storageGet } = await import("../storage");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        let rows;
        if (input.kind === "all") {
          rows = await drizzleDb.select().from(marketingAssets).orderBy(desc(marketingAssets.createdAt)).limit(100);
        } else {
          rows = await drizzleDb
            .select()
            .from(marketingAssets)
            .where(eq(marketingAssets.kind, input.kind))
            .orderBy(desc(marketingAssets.createdAt))
            .limit(100);
        }
        // Surface signed URLs for previewing in admin
        return Promise.all(
          rows.map(async (r: any) => ({
            id: r.id,
            kind: r.kind,
            label: r.label,
            width: r.width,
            height: r.height,
            mimeType: r.mimeType,
            createdAt: r.createdAt,
            url: (await storageGet(r.storageKey)).url,
          }))
        );
      }),

    /** Delete a reference asset (R2 file kept; can be GC'd later). */
    deleteReference: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const { marketingAssets } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { ok: false };
        await drizzleDb.delete(marketingAssets).where(eq(marketingAssets.id, input.id));
        return { ok: true };
      }),

    /**
     * Generate or iterate. Two modes:
     *
     * generate (no parentIterationId):
     *   prompt → gpt-image-2 generate → optional Sharp lock → R2 → DB
     *
     * edit (with parentIterationId):
     *   load parent's image from R2 → gpt-image-2 edit with prompt → ...
     */
    generate: adminProcedure
      .input(
        z.object({
          projectKey: z.string().min(1).max(64),
          prompt: z.string().min(10).max(4000),
          quality: z.enum(["low", "medium", "high"]).default("medium"),
          size: z.enum(["1024x1024", "1024x1792", "1792x1024", "2048x2048"]).default("1024x1792"),
          parentIterationId: z.number().int().positive().optional(),
          referenceAssetIds: z.array(z.number().int().positive()).max(8).default([]),
          lockBranding: z.boolean().default(true),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { composePoster } = await import("../services/posterCompositeService");
        const { posterIterations } = await import("../../drizzle/schema");
        const { eq, gte, sql, and } = await import("drizzle-orm");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        // Soft daily budget guard: refuse if today's spend > $10 (raised from
        // v0's $5 since high quality + iteration burns more)
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const [todaySpendRow] = await drizzleDb
          .select({ total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)` })
          .from(posterIterations)
          .where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfToday)));
        const todaySpend = Number(todaySpendRow?.total ?? 0);
        if (todaySpend > 10.0) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Daily image-gen budget exceeded ($${todaySpend.toFixed(2)} / $10.00). Try again tomorrow.`,
          });
        }

        // If iterating, load the parent iteration to get its base image key
        let baseImageKey: string | undefined;
        if (input.parentIterationId) {
          const [parent] = await drizzleDb
            .select()
            .from(posterIterations)
            .where(eq(posterIterations.id, input.parentIterationId))
            .limit(1);
          if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Parent iteration not found" });
          baseImageKey = (parent as any).storageKey;
          if (!baseImageKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Parent iteration has no image" });
        }

        try {
          const result = await composePoster({
            prompt: input.prompt,
            size: input.size,
            quality: input.quality,
            lockBranding: input.lockBranding,
            baseImageKey,
          });

          const [insertResult] = (await drizzleDb.insert(posterIterations).values({
            projectKey: input.projectKey,
            parentIterationId: input.parentIterationId ?? null,
            ownerId: ctx.user?.id ?? null,
            prompt: input.prompt,
            mode: result.mode,
            size: input.size,
            quality: input.quality,
            costUsd: result.cost.toFixed(4),
            durationMs: result.durationMs,
            storageKey: result.storageKey,
            status: "success",
            referenceAssetIds: JSON.stringify(input.referenceAssetIds),
          } as any)) as any;

          return {
            iterationId: Number(insertResult?.insertId ?? 0),
            posterUrl: result.posterUrl,
            storageKey: result.storageKey,
            costUsd: result.cost,
            durationMs: result.durationMs,
            mode: result.mode,
          };
        } catch (err) {
          await drizzleDb.insert(posterIterations).values({
            projectKey: input.projectKey,
            parentIterationId: input.parentIterationId ?? null,
            ownerId: ctx.user?.id ?? null,
            prompt: input.prompt,
            mode: input.parentIterationId ? "edit" : "generate",
            size: input.size,
            quality: input.quality,
            costUsd: "0",
            durationMs: 0,
            status: "errored",
            errorMessage: (err as Error).message?.slice(0, 1000) || "Unknown error",
            referenceAssetIds: JSON.stringify(input.referenceAssetIds),
          } as any);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Poster compose failed: ${(err as Error).message}`,
          });
        }
      }),

    /** List iterations for a given project, ordered chronologically. */
    listIterations: adminProcedure
      .input(z.object({ projectKey: z.string().min(1).max(64) }))
      .query(async ({ input }) => {
        const { posterIterations } = await import("../../drizzle/schema");
        const { eq, asc } = await import("drizzle-orm");
        const { storageGet } = await import("../storage");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const rows = await drizzleDb
          .select()
          .from(posterIterations)
          .where(eq(posterIterations.projectKey, input.projectKey))
          .orderBy(asc(posterIterations.createdAt));
        return Promise.all(
          rows.map(async (r: any) => ({
            id: r.id,
            parentIterationId: r.parentIterationId,
            prompt: r.prompt,
            mode: r.mode,
            quality: r.quality,
            size: r.size,
            costUsd: Number(r.costUsd),
            durationMs: r.durationMs,
            status: r.status,
            errorMessage: r.errorMessage,
            createdAt: r.createdAt,
            url: r.storageKey ? (await storageGet(r.storageKey)).url : null,
          }))
        );
      }),

    /** Cost surface — combines v0 posterGenLogs + v1 posterIterations. */
    getCostStatus: adminProcedure.query(async () => {
      const { posterIterations } = await import("../../drizzle/schema");
      const { sql, gte, eq, and, desc } = await import("drizzle-orm");
      const drizzleDb = await db.getDb();
      if (!drizzleDb) return { todaySpend: 0, monthSpend: 0, todayCount: 0, monthCount: 0, dailyBudget: 10, monthlyBudget: 100, recentLogs: [] };
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const [today] = await drizzleDb.select({
        total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)`,
        n: sql<string>`COUNT(*)`,
      }).from(posterIterations).where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfToday)));
      const [month] = await drizzleDb.select({
        total: sql<string>`COALESCE(SUM(CAST(${posterIterations.costUsd} AS DECIMAL(10,4))), 0)`,
        n: sql<string>`COUNT(*)`,
      }).from(posterIterations).where(and(eq(posterIterations.status, "success"), gte(posterIterations.createdAt, startOfMonth)));
      const recent = await drizzleDb.select().from(posterIterations).orderBy(desc(posterIterations.createdAt)).limit(10);
      return {
        todaySpend: Number(today?.total ?? 0),
        todayCount: Number(today?.n ?? 0),
        monthSpend: Number(month?.total ?? 0),
        monthCount: Number(month?.n ?? 0),
        dailyBudget: 10.0,
        monthlyBudget: 100.0,
        recentLogs: recent.map((r: any) => ({
          id: r.id,
          projectKey: r.projectKey,
          mode: r.mode,
          quality: r.quality,
          costUsd: Number(r.costUsd),
          status: r.status,
          createdAt: r.createdAt,
        })),
      };
    }),
  });
