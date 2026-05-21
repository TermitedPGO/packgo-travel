/**
 * agent.* outcome tracking sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers Layer-0 outcome plumbing: per-action
 * record/update plus aggregate snapshot used by the admin dashboard
 * top card.
 *
 * Procedures (4):
 *   - recordAction
 *   - updateOutcome
 *   - recentOutcomes
 *   - snapshot
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, sql } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { interactionOutcomes } from "../../../drizzle/schema";
import { AGENT_NAMES } from "./_shared";

export const outcomesRouter = router({
  /**
   * Record an outcome the moment an agent acts. Most fields are filled
   * later via measureOutcomes (cron job). The initial record captures
   * which decision was made + the policy version + AI confidence.
   */
  recordAction: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        interactionId: z.number().int(),
        customerProfileId: z.number().int().optional(),
        actionTaken: z.string().max(50),
        confidence: z.number().int().min(0).max(100).optional(),
        policyVersion: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const result = await db.insert(interactionOutcomes).values({
        agentName: input.agentName,
        interactionId: input.interactionId,
        customerProfileId: input.customerProfileId,
        actionTaken: input.actionTaken,
        confidence: input.confidence,
        policyVersion: input.policyVersion,
      });
      return { outcomeId: Number((result as any)[0]?.insertId ?? 0) };
    }),

  /**
   * Update outcome with downstream observations. Called by background
   * jobs that detect customer reply / booking / review / refund events.
   */
  updateOutcome: adminProcedure
    .input(
      z.object({
        outcomeId: z.number().int(),
        customerReplied: z.boolean().optional(),
        customerReplyTimeMs: z.number().int().optional(),
        customerSentiment: z
          .enum(["positive", "neutral", "negative"])
          .optional(),
        customerBooked: z.boolean().optional(),
        bookedAmount: z.number().int().optional(),
        customerOptedOut: z.boolean().optional(),
        reviewSubmitted: z.boolean().optional(),
        reviewRating: z.number().int().min(1).max(5).optional(),
        refundRequested: z.boolean().optional(),
        jeffOverride: z.boolean().optional(),
        jeffOverrideReason: z.string().max(500).optional(),
        outcomeFinalized: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { outcomeId, ...fields } = input;
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        if (typeof v === "boolean") updates[k] = v ? 1 : 0;
        else updates[k] = v;
      }
      if (Object.keys(updates).length === 0) return { updated: false };
      await db
        .update(interactionOutcomes)
        .set(updates)
        .where(eq(interactionOutcomes.id, outcomeId));
      return { updated: true };
    }),

  /**
   * Read recent outcomes for an agent — used by self-retrospective +
   * admin dashboard.
   */
  recentOutcomes: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(input.limit);
    }),

  /**
   * Aggregate snapshot for the admin dashboard top card. Returns counts
   * per agent over the last 7 days.
   */
  snapshot: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        agentName: interactionOutcomes.agentName,
        total: sql<number>`COUNT(*)`,
        autoActions: sql<number>`SUM(CASE WHEN actionTaken NOT IN ('escalated', 'manual') THEN 1 ELSE 0 END)`,
        escalated: sql<number>`SUM(CASE WHEN actionTaken = 'escalated' THEN 1 ELSE 0 END)`,
        overrides: sql<number>`SUM(jeffOverride)`,
        avgConfidence: sql<number>`AVG(confidence)`,
      })
      .from(interactionOutcomes)
      .where(sql`createdAt >= ${sevenDaysAgo}`)
      .groupBy(interactionOutcomes.agentName);
    return rows;
  }),
});
