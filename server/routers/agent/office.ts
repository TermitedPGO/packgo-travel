/**
 * agent.* office + admin dashboard sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers the "Jeff's inbox / desk" surface — the
 * per-agent office card, Jeff's acknowledgement actions on outcomes,
 * plus weekly metrics + recent timelines. The global office-overview
 * tree (autonomous + tooling agents in one place) lives in its own
 * sub-router under `./overview.ts` so this file stays under 500 LOC.
 *
 * Procedures (5):
 *   - recentMetrics
 *   - pendingForJeff
 *   - recentActivity
 *   - acknowledge
 *   - agentOffice
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMetrics,
} from "../../../drizzle/schema";
import { AGENT_NAMES } from "./_shared";

export const officeRouter = router({
  /**
   * Read recent weekly metrics for the dashboard. Returns last 12 weeks
   * by default — enough to render a trend chart.
   */
  recentMetrics: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        weeks: z.number().int().min(1).max(52).default(12),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(agentMetrics)
        .where(eq(agentMetrics.agentName, input.agentName))
        .orderBy(desc(agentMetrics.weekStart))
        .limit(input.weeks);
    }),

  /**
   * Items needing Jeff's attention. Returns outcomes that have either:
   *   - actionTaken contains "escalate" (agent explicitly handed off)
   *   - confidence < 70 (agent uncertain, even if it drafted)
   * AND have not yet been ack'd (outcomeFinalized = 0).
   *
   * Joined with customerInteractions for content preview + customerProfiles
   * for sender info — single round trip for the dashboard.
   */
  pendingForJeff: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limit = input?.limit ?? 50;
      const rows = await db
        .select({
          outcomeId: interactionOutcomes.id,
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          createdAt: interactionOutcomes.createdAt,
          interactionId: customerInteractions.id,
          channel: customerInteractions.channel,
          content: customerInteractions.content,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          sentiment: customerInteractions.sentiment,
          urgency: customerInteractions.urgency,
          customerProfileId: customerProfiles.id,
          customerEmail: customerProfiles.email,
        })
        .from(interactionOutcomes)
        .leftJoin(
          customerInteractions,
          eq(interactionOutcomes.interactionId, customerInteractions.id),
        )
        .leftJoin(
          customerProfiles,
          eq(interactionOutcomes.customerProfileId, customerProfiles.id),
        )
        .where(
          and(
            eq(interactionOutcomes.outcomeFinalized, 0),
            or(
              // QA audit 2026-05-11 Phase 8 fix: was LIKE '%escalate%' which
              // forces a leading-wildcard scan that no index can serve.
              // The actual writers store exact values: 'auto_escalate'
              // (gmailPipeline auto-escalation), 'escalated' (selfRetrospective
              // tag), and 'escalate' (policy default in inquiryAgent). IN
              // clause is index-eligible and ~50x faster on 10k+ outcome rows.
              sql`${interactionOutcomes.actionTaken} IN ('auto_escalate', 'escalate', 'escalated')`,
              sql`${interactionOutcomes.confidence} < 70`,
            ),
          ),
        )
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(limit);
      return rows;
    }),

  /**
   * Timeline of every agent action today + yesterday. Used by the
   * "today's office" timeline view. Newest first.
   */
  recentActivity: adminProcedure
    .input(
      z
        .object({
          hours: z.number().int().min(1).max(168).default(48),
          agentName: z.enum(AGENT_NAMES).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const hours = input?.hours ?? 48;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const whereConds = [sql`${interactionOutcomes.createdAt} >= ${since}`];
      if (input?.agentName) {
        whereConds.push(eq(interactionOutcomes.agentName, input.agentName));
      }
      const rows = await db
        .select({
          outcomeId: interactionOutcomes.id,
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          outcomeFinalized: interactionOutcomes.outcomeFinalized,
          jeffOverride: interactionOutcomes.jeffOverride,
          createdAt: interactionOutcomes.createdAt,
          channel: customerInteractions.channel,
          contentSummary: customerInteractions.contentSummary,
          classification: customerInteractions.classification,
          customerEmail: customerProfiles.email,
        })
        .from(interactionOutcomes)
        .leftJoin(
          customerInteractions,
          eq(interactionOutcomes.interactionId, customerInteractions.id),
        )
        .leftJoin(
          customerProfiles,
          eq(interactionOutcomes.customerProfileId, customerProfiles.id),
        )
        .where(and(...whereConds))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(200);
      return rows;
    }),

  /**
   * Jeff acknowledges an outcome:
   *   - "approved" → mark outcomeFinalized=1, no override
   *   - "override" → mark outcomeFinalized=1, jeffOverride=1, save reason
   *   - "needs_change" → keep finalized=0 but log reason (agent will see)
   *
   * Critical to self-retrospective: every weekly retro reads jeffOverride
   * rows to learn what the agent got wrong.
   */
  acknowledge: adminProcedure
    .input(
      z.object({
        outcomeId: z.number().int(),
        verdict: z.enum(["approved", "override", "needs_change"]),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, unknown> = {};
      if (input.verdict === "approved") {
        updates.outcomeFinalized = 1;
      } else if (input.verdict === "override") {
        updates.outcomeFinalized = 1;
        updates.jeffOverride = 1;
        if (input.reason) updates.jeffOverrideReason = input.reason;
      } else if (input.verdict === "needs_change") {
        if (input.reason) updates.jeffOverrideReason = input.reason;
      }
      await db
        .update(interactionOutcomes)
        .set(updates)
        .where(eq(interactionOutcomes.id, input.outcomeId));
      return { ok: true };
    }),

  /**
   * Per-agent office summary used by each "desk" card. Returns:
   *   - today + 7d action counts
   *   - pending count (escalations + low-confidence not ack'd)
   *   - latest action timestamp
   *   - active policy version
   */
  agentOffice: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return {
          todayCount: 0,
          weekCount: 0,
          pendingCount: 0,
          latestAt: null,
          policyVersion: null,
          status: "off" as const,
        };
      }
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [todayCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${startOfDay}`,
          ),
        );

      const [weekCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${weekAgo}`,
          ),
        );

      const [pendingCountRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            eq(interactionOutcomes.outcomeFinalized, 0),
            or(
              sql`${interactionOutcomes.actionTaken} LIKE '%escalate%'`,
              sql`${interactionOutcomes.confidence} < 70`,
            ),
          ),
        );

      const [latest] = await db
        .select({ at: interactionOutcomes.createdAt })
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(1);

      const [policy] = await db
        .select({ version: agentPolicies.version })
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.agentName, input.agentName),
            eq(agentPolicies.active, 1),
          ),
        )
        .limit(1);

      // Status: only "inquiry" is live in demo mode right now. Others are
      // "off" until their Layer 2 build lands. This will change as we
      // ship more agents.
      const status =
        input.agentName === "inquiry"
          ? ("demo" as const)
          : ("off" as const);

      return {
        todayCount: Number(todayCountRow?.c ?? 0),
        weekCount: Number(weekCountRow?.c ?? 0),
        pendingCount: Number(pendingCountRow?.c ?? 0),
        latestAt: latest?.at ?? null,
        policyVersion: policy?.version ?? null,
        status,
      };
    }),
});
