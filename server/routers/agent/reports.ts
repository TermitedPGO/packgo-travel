/**
 * agent.* self-report sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers the "Jeff asks each agent for a status
 * report" surface — single-agent and broadcast-to-all variants. Each
 * report lands as a digest bubble in the corresponding agent DM.
 *
 * Procedures (2):
 *   - requestAgentReport
 *   - requestAllAgentReports
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../../../drizzle/schema";
import {
  runAgentReport,
  formatReportAsMessage,
} from "../../agents/autonomous/agentReport";
import { AGENT_NAMES } from "./_shared";

export const reportsRouter = router({
  /**
   * Jeff requests a status report from a specific agent. Agent reads its
   * own outcomes + recent DM and produces a structured digest, which is
   * saved as a new bubble in the agent's DM. Returns the new messageId so
   * the UI can scroll to it.
   */
  requestAgentReport: adminProcedure
    .input(z.object({ agentName: z.enum(AGENT_NAMES) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 1. Gather data the agent needs to write its report
      const recentOutcomes = await db
        .select()
        .from(interactionOutcomes)
        .where(eq(interactionOutcomes.agentName, input.agentName))
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(50);

      const recentDmRows = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.agentName, input.agentName))
        .orderBy(desc(agentMessages.createdAt))
        .limit(20);
      const recentDmMessages = recentDmRows.reverse();

      const [activePolicy] = await db
        .select({ version: agentPolicies.version, rules: agentPolicies.rules })
        .from(agentPolicies)
        .where(and(eq(agentPolicies.agentName, input.agentName), eq(agentPolicies.active, 1)))
        .limit(1);

      // 2. Run the LLM-driven report
      let report;
      try {
        report = await runAgentReport({
          agentName: input.agentName,
          recentOutcomes: recentOutcomes.map((o) => ({
            agentName: o.agentName,
            actionTaken: o.actionTaken,
            confidence: o.confidence,
            customerSentiment: o.customerSentiment,
            customerReplied: o.customerReplied,
            customerBooked: o.customerBooked,
            reviewSubmitted: o.reviewSubmitted,
            refundRequested: o.refundRequested,
            jeffOverride: o.jeffOverride,
            jeffOverrideReason: o.jeffOverrideReason,
            outcomeFinalized: o.outcomeFinalized,
            createdAt: o.createdAt,
          })),
          recentDmMessages: recentDmMessages.map((m) => ({
            senderRole: m.senderRole as "agent" | "jeff",
            messageType: m.messageType,
            body: m.body,
            jeffResponse: m.jeffResponse,
            createdAt: m.createdAt,
          })),
          activePolicy: activePolicy ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `runAgentReport: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 3. Persist as a chat bubble
      const formatted = formatReportAsMessage(report);
      const priority =
        report.concerns.length > 0 || report.questions.length > 0
          ? "high"
          : "normal";
      const ins = await db.insert(agentMessages).values({
        agentName: input.agentName,
        senderRole: "agent",
        messageType: "digest",
        title: formatted.title,
        body: formatted.body,
        context: formatted.context,
        priority,
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      return { messageId, report };
    }),

  /**
   * Request a report from every Round 81 agent in parallel. Each agent's
   * report lands in its own DM (5 separate bubbles). Returns array of
   * results with any errors per-agent (doesn't fail the whole call if one
   * agent fails).
   */
  requestAllAgentReports: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const reportableAgents = AGENT_NAMES.filter(
      (n) => n !== "self_retrospective", // skip until we build that loop
    );

    const results = await Promise.all(
      reportableAgents.map(async (agentName) => {
        try {
          const recentOutcomes = await db
            .select()
            .from(interactionOutcomes)
            .where(eq(interactionOutcomes.agentName, agentName))
            .orderBy(desc(interactionOutcomes.createdAt))
            .limit(50);
          const recentDmRows = await db
            .select()
            .from(agentMessages)
            .where(eq(agentMessages.agentName, agentName))
            .orderBy(desc(agentMessages.createdAt))
            .limit(20);
          const [activePolicy] = await db
            .select({
              version: agentPolicies.version,
              rules: agentPolicies.rules,
            })
            .from(agentPolicies)
            .where(
              and(eq(agentPolicies.agentName, agentName), eq(agentPolicies.active, 1)),
            )
            .limit(1);

          const report = await runAgentReport({
            agentName,
            recentOutcomes: recentOutcomes.map((o) => ({
              agentName: o.agentName,
              actionTaken: o.actionTaken,
              confidence: o.confidence,
              customerSentiment: o.customerSentiment,
              customerReplied: o.customerReplied,
              customerBooked: o.customerBooked,
              reviewSubmitted: o.reviewSubmitted,
              refundRequested: o.refundRequested,
              jeffOverride: o.jeffOverride,
              jeffOverrideReason: o.jeffOverrideReason,
              outcomeFinalized: o.outcomeFinalized,
              createdAt: o.createdAt,
            })),
            recentDmMessages: recentDmRows.reverse().map((m) => ({
              senderRole: m.senderRole as "agent" | "jeff",
              messageType: m.messageType,
              body: m.body,
              jeffResponse: m.jeffResponse,
              createdAt: m.createdAt,
            })),
            activePolicy: activePolicy ?? null,
          });

          const formatted = formatReportAsMessage(report);
          const priority =
            report.concerns.length > 0 || report.questions.length > 0
              ? "high"
              : "normal";
          const ins = await db.insert(agentMessages).values({
            agentName,
            senderRole: "agent",
            messageType: "digest",
            title: formatted.title,
            body: formatted.body,
            context: formatted.context,
            priority,
          });
          const messageId = Number((ins as any)[0]?.insertId ?? 0);
          return { agentName, ok: true as const, messageId };
        } catch (e) {
          return {
            agentName,
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    return { results };
  }),
});
