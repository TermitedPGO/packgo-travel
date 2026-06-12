/**
 * agent.* central inbox sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers Jeff's global inbox surface (cross-agent
 * agentMessages list with unread badge + reply), and the internal
 * postMessage entry agents use to leave him notes.
 *
 * Procedures (4):
 *   - listMessages
 *   - unreadMessageCount
 *   - replyToMessage
 *   - postMessage
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { agentMessages } from "../../../drizzle/schema";
import { AGENT_NAMES } from "./_shared";

export const inboxRouter = router({
  /**
   * List messages addressed to Jeff. Filter by readByJeff/agentName.
   * Default: unread first, then last 50 of all.
   */
  listMessages: adminProcedure
    .input(
      z
        .object({
          onlyUnread: z.boolean().default(false),
          // "ops" is the interactive chat channel — it writes agentMessages
          // rows directly (varchar column) but was never in AGENT_NAMES, so
          // this read filter rejected it with BAD_REQUEST and the chat page
          // could never load its own history (v690 UAT B-02). Widened here
          // only; the shared AGENT_NAMES enum (policies etc.) is unchanged.
          agentName: z.enum([...AGENT_NAMES, "ops"]).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const args = input ?? { onlyUnread: false, limit: 50 };
      const conds = [];
      if (args.onlyUnread) conds.push(eq(agentMessages.readByJeff, 0));
      if (args.agentName) conds.push(eq(agentMessages.agentName, args.agentName));
      const query = db
        .select()
        .from(agentMessages)
        .orderBy(desc(agentMessages.priority), desc(agentMessages.createdAt))
        .limit(args.limit);
      const result =
        conds.length > 0 ? await query.where(and(...conds)) : await query;
      return result;
    }),

  /** Unread message count, plus per-priority breakdown for badge UI. */
  unreadMessageCount: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, critical: 0, high: 0, normal: 0, low: 0 };
    const rows = await db
      .select({
        priority: agentMessages.priority,
        c: sql<number>`COUNT(*)`,
      })
      .from(agentMessages)
      .where(eq(agentMessages.readByJeff, 0))
      .groupBy(agentMessages.priority);
    const result = { total: 0, critical: 0, high: 0, normal: 0, low: 0 };
    for (const r of rows) {
      const n = Number(r.c ?? 0);
      result.total += n;
      result[r.priority as keyof typeof result] = n;
    }
    return result;
  }),

  /** Jeff replies to / acknowledges a message. */
  replyToMessage: adminProcedure
    .input(
      z.object({
        messageId: z.number().int(),
        response: z.string().max(5000).optional(),
        markRead: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, unknown> = {};
      if (input.markRead) {
        updates.readByJeff = 1;
        updates.readAt = new Date();
      }
      if (input.response) updates.jeffResponse = input.response;
      await db
        .update(agentMessages)
        .set(updates)
        .where(eq(agentMessages.id, input.messageId));
      return { ok: true };
    }),

  /** Internal: agent posts a message to Jeff. Used by future cron jobs / self-retrospective. */
  postMessage: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        messageType: z.enum([
          "proposal",
          "observation",
          "question",
          "alert",
          "digest",
          "escalation",
        ]),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000),
        context: z.string().max(20_000).optional(),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        relatedOutcomeId: z.number().int().optional(),
        relatedInteractionId: z.number().int().optional(),
        relatedCustomerProfileId: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const ins = await db.insert(agentMessages).values(input);
      return { messageId: Number((ins as any)[0]?.insertId ?? 0) };
    }),
});
