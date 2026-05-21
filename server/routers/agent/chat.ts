/**
 * agent.* channel + per-agent chat sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers the #全體 channel (Jeff broadcasts +
 * office-assistant auto-replies), per-agent DM channel reads/writes
 * including the context-injecting sendToAgent that powers the "ask
 * the agent how it's been doing" flow.
 *
 * Procedures (8):
 *   - listGeneralChannel
 *   - postToGeneralChannel
 *   - generalChannelUnread
 *   - markGeneralChannelRead
 *   - markAgentChannelRead
 *   - listConversation
 *   - unreadPerAgent
 *   - sendToAgent
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import {
  customerProfiles,
  customerInteractions,
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../../../drizzle/schema";
import { runAgentChat } from "../../agents/autonomous/agentChat";
import { runOfficeAssistant } from "../../agents/autonomous/officeAssistant";
import { AGENT_NAMES } from "./_shared";

export const chatRouter = router({
  // ─────────────────────────────────────────────────────────────────
  // #全體辦公群 — group channel where agents broadcast + Jeff posts
  // announcements. Stored in agentMessages with agentName='general'.
  // Jeff's posts here DON'T trigger auto-replies (one-way broadcast).
  // ─────────────────────────────────────────────────────────────────

  listGeneralChannel: adminProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).default(80) })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, "general"))
        .orderBy(desc(agentMessages.createdAt))
        .limit(input?.limit ?? 80);
      return rows.reverse();
    }),

  postToGeneralChannel: adminProcedure
    .input(
      z.object({
        body: z.string().min(1).max(10_000),
        title: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Save Jeff's message
      const ins = await db.insert(agentMessages).values({
        agentName: "general",
        senderRole: "jeff",
        messageType: "observation",
        title: input.title ?? input.body.slice(0, 80),
        body: input.body,
        priority: "normal",
        readByJeff: 1,
        readAt: new Date(),
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      // 2. Trigger office assistant reply (best-effort — don't fail the post if it errors)
      let assistantMessageId: number | undefined;
      try {
        const { reply } = await runOfficeAssistant(input.body);
        const assistantIns = await db.insert(agentMessages).values({
          agentName: "general",
          senderRole: "agent",
          messageType: "observation",
          title: reply.slice(0, 80),
          body: reply,
          priority: "normal",
          readByJeff: 1, // counted as read since Jeff is in the channel
          readAt: new Date(),
          context: JSON.stringify({ source: "office_assistant" }),
        });
        assistantMessageId = Number((assistantIns as any)[0]?.insertId ?? 0);
      } catch (err) {
        // Log but don't fail — Jeff's post still went through
        logger.error(
          { err, event: "office_assistant_reply_failed", messageId },
          "office assistant reply failed",
        );
      }

      return { messageId, assistantMessageId };
    }),

  /**
   * Unread count for #general (messages from agents Jeff hasn't ack'd).
   * Separate from per-agent DMs to keep the sidebar badges accurate.
   */
  generalChannelUnread: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.agentName, "general"),
          eq(agentMessages.readByJeff, 0),
          eq(agentMessages.senderRole, "agent"),
        ),
      );
    return Number(row?.c ?? 0);
  }),

  markGeneralChannelRead: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) return { ok: true };
    await db
      .update(agentMessages)
      .set({ readByJeff: 1, readAt: new Date() })
      .where(
        and(
          eq(agentMessages.agentName, "general"),
          eq(agentMessages.readByJeff, 0),
        ),
      );
    return { ok: true };
  }),

  /** Mark all messages from a specific agent as read. */
  markAgentChannelRead: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: true };
      await db
        .update(agentMessages)
        .set({ readByJeff: 1, readAt: new Date() })
        .where(
          and(
            eq(agentMessages.agentName, input.agentName),
            eq(agentMessages.readByJeff, 0),
          ),
        );
      return { ok: true };
    }),

  /** Full conversation between Jeff and a specific agent (newest last). */
  listConversation: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        limit: z.number().int().min(1).max(200).default(80),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(input.limit);
      // Return newest-last for easier chat rendering
      return rows.reverse();
    }),

  /** Unread per-agent counts for the office sidebar. */
  unreadPerAgent: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return {};
    const rows = await db
      .select({
        agentName: agentMessages.agentName,
        c: sql<number>`COUNT(*)`,
      })
      .from(agentMessages)
      .where(and(eq(agentMessages.readByJeff, 0), eq(agentMessages.senderRole, "agent")))
      .groupBy(agentMessages.agentName);
    const result: Record<string, number> = {};
    for (const r of rows) result[r.agentName] = Number(r.c ?? 0);
    return result;
  }),

  /**
   * Jeff sends a message to a specific agent. Saves Jeff's message, then
   * invokes the agent's chat function to generate a reply, saves the reply
   * too. Returns both rows so the UI can append them atomically.
   */
  sendToAgent: adminProcedure
    .input(
      z.object({
        agentName: z.enum(AGENT_NAMES),
        body: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Save Jeff's message
      const jeffIns = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "jeff",
        messageType: "observation",
        title: input.body.slice(0, 80),
        body: input.body,
        priority: "normal",
        readByJeff: 1,
        readAt: new Date(),
      });
      const jeffMessageId = Number((jeffIns as any)[0]?.insertId ?? 0);

      // 2. Pull last 30 messages to feed as history (excluding the one we just inserted)
      const history = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(30);
      const historyAsc = history.reverse();
      // Drop the just-inserted Jeff message from history (we pass it as newJeffMessage)
      const filteredHistory = historyAsc.filter((r) => r.id !== jeffMessageId);

      // 3. Get active policy
      const [policy] = await db
        .select({ rules: agentPolicies.rules })
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);

      // 3b. Gather real-data context (outcomes + interactions + stats) so the
      //     agent can answer "how have you been doing" with actual numbers.
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentOutcomesRaw = await db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(20);

      // Join recent outcomes to interactions for the most-recent 10
      const interactionIds = recentOutcomesRaw
        .map((o) => o.interactionId)
        .filter((id) => id != null && id > 0);
      const recentInteractionsRaw =
        interactionIds.length > 0
          ? await db
              .select({
                channel: customerInteractions.channel,
                classification: customerInteractions.classification,
                sentiment: customerInteractions.sentiment,
                contentSummary: customerInteractions.contentSummary,
                createdAt: customerInteractions.createdAt,
                customerEmail: customerProfiles.email,
              })
              .from(customerInteractions)
              .leftJoin(
                customerProfiles,
                eq(customerInteractions.customerProfileId, customerProfiles.id),
              )
              .where(inArray(customerInteractions.id, interactionIds.slice(0, 10)))
              .orderBy(desc(customerInteractions.createdAt))
              .limit(10)
          : [];

      // Aggregate stats
      const [todayRow] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${startOfDay}`,
          ),
        );
      const [weekRow] = await db
        .select({
          total: sql<number>`COUNT(*)`,
          auto: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} NOT LIKE '%escalate%' THEN 1 ELSE 0 END)`,
          esc: sql<number>`SUM(CASE WHEN ${interactionOutcomes.actionTaken} LIKE '%escalate%' THEN 1 ELSE 0 END)`,
          overrides: sql<number>`SUM(${interactionOutcomes.jeffOverride})`,
          avgConf: sql<number>`AVG(${interactionOutcomes.confidence})`,
        })
        .from(interactionOutcomes)
        .where(
          and(
            eq(interactionOutcomes.agentName, input.agentName),
            sql`${interactionOutcomes.createdAt} >= ${since7d}`,
          ),
        );

      // 4. Run chat — now with context injected
      let reply = "";
      try {
        const out = await runAgentChat({
          agentName: input.agentName,
          history: filteredHistory.map((r) => ({
            senderRole: r.senderRole as "agent" | "jeff",
            body: r.body,
            title: r.title,
            createdAt: r.createdAt,
          })),
          newJeffMessage: input.body,
          activePolicyRules: policy?.rules,
          context: {
            recentOutcomes: recentOutcomesRaw.map((o) => ({
              actionTaken: o.actionTaken,
              confidence: o.confidence,
              customerSentiment: o.customerSentiment,
              customerReplied: o.customerReplied,
              customerBooked: o.customerBooked,
              refundRequested: o.refundRequested,
              jeffOverride: o.jeffOverride,
              jeffOverrideReason: o.jeffOverrideReason,
              outcomeFinalized: o.outcomeFinalized,
              createdAt: o.createdAt,
            })),
            recentInteractions: recentInteractionsRaw.map((i) => ({
              channel: i.channel,
              classification: i.classification,
              sentiment: i.sentiment,
              contentSummary: i.contentSummary,
              createdAt: i.createdAt,
              customerEmail: i.customerEmail,
            })),
            stats: {
              todayActions: Number(todayRow?.c ?? 0),
              week7dActions: Number(weekRow?.total ?? 0),
              week7dAuto: Number(weekRow?.auto ?? 0),
              week7dEscalations: Number(weekRow?.esc ?? 0),
              overrides: Number(weekRow?.overrides ?? 0),
              avgConfidence:
                weekRow?.avgConf != null
                  ? Math.round(Number(weekRow.avgConf))
                  : null,
            },
          },
        });
        reply = out.reply;
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Agent chat failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 5. Save agent's reply
      const agentIns = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "agent",
        messageType: "observation",
        title: reply.slice(0, 80),
        body: reply,
        priority: "normal",
        readByJeff: 1, // since Jeff is in the active chat, count as read
        readAt: new Date(),
      });
      const agentMessageId = Number((agentIns as any)[0]?.insertId ?? 0);

      return {
        jeffMessageId,
        agentMessageId,
        reply,
      };
    }),
});
