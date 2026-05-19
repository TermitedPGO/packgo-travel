/**
 * Ops router — admin one-shot operational scripts (translations re-run, digest).
 *
 * Extracted from server/routers.ts (Phase 4E · sub-PR 5 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1). Source range
 * (verbatim from origin): L4395-4501.
 *
 * Procedures (2):
 *   - rerunAllTourTranslations  – v78p: flush translation cache + requeue
 *   - sendDailyDigestNow        – v78m: manual trigger for daily digest job
 */

import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const opsRouter = router({
    /**
     * v78p: Flush translation cache + re-translate all active tours.
     * Use after fixing translator bugs (e.g. maxTokens too low). One-shot
     * script — safe to call multiple times, queue dedup handles concurrency.
     *
     * Returns: { flushedCacheKeys, translationsDeleted, queuedJobs, tourIds }
     */
    rerunAllTourTranslations: adminProcedure.mutation(async ({ ctx }) => {
      const { redis } = await import("../redis");
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Flush all translation:* cache keys (forces fresh LLM calls)
      let flushedCount = 0;
      try {
        // SCAN through the keyspace, deleting in batches
        let cursor = "0";
        do {
          const reply = await (redis as any).scan(cursor, "MATCH", "translate:*", "COUNT", 500);
          cursor = reply[0];
          const keys = reply[1] || [];
          if (keys.length > 0) {
            await (redis as any).del(...keys);
            flushedCount += keys.length;
          }
        } while (cursor !== "0");
      } catch (err) {
        console.warn("[rerunTranslations] cache flush failed (non-fatal):", (err as Error).message);
      }

      // 2. Delete existing translation rows for active tours so the worker re-saves fresh ones
      const { tours, translations } = await import("../../drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const activeTours = await drizzleDb
        .select({ id: tours.id })
        .from(tours)
        .where(eq(tours.status, "active" as any));
      const ids = activeTours.map((t: any) => t.id);
      let deleted = 0;
      if (ids.length > 0) {
        const r = await drizzleDb
          .delete(translations)
          .where(and(eq(translations.entityType, "tour"), inArray(translations.entityId, ids)));
        deleted = (r as any).affectedRows ?? 0;
      }

      // 3. Queue re-translation jobs (sequential, not parallel — Anthropic rate limits)
      const { addTourTranslationJob } = await import("../queue");
      const queued: number[] = [];
      for (const id of ids) {
        try {
          await addTourTranslationJob({
            tourId: id,
            targetLanguages: ["en"],
            sourceLanguage: "zh-TW",
            userId: ctx.user?.id || 1,
          });
          queued.push(id);
        } catch (err) {
          console.warn(`[rerunTranslations] queue failed for tour ${id}:`, (err as Error).message);
        }
      }

      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "ops.translations.rerunAll",
        targetType: "system",
        targetId: 0,
        changes: { flushedCacheKeys: flushedCount, translationsDeleted: deleted, queuedJobs: queued.length },
      });

      return {
        flushedCacheKeys: flushedCount,
        translationsDeleted: deleted,
        queuedJobs: queued.length,
        tourIds: queued,
      };
    }),

    sendDailyDigestNow: adminProcedure.mutation(async ({ ctx }) => {
      const { runDailyDigestJob } = await import("../services/dailyDigestService");
      const result = await runDailyDigestJob();
      const { audit } = await import("../_core/auditLog");
      audit({
        ctx,
        action: "ops.dailyDigest.manualTrigger",
        targetType: "system",
        targetId: 0,
        changes: { sent: result.sent },
      });
      return {
        sent: result.sent,
        summary: result.data
          ? {
              pendingWechat: result.data.pendingWechat.length,
              quotesToFollowUp: result.data.newQuotesToFollowUp.length,
              newInquiries: result.data.newInquiries,
              newQuotes24h: result.data.newQuotesCount,
              newBookings24h: result.data.newBookingsCount,
              revenue24h: result.data.revenue24h,
            }
          : null,
      };
    }),
  });
