/**
 * agent.* OpsAgent + Self-Retrospective sub-router.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): extracted from
 * server/routers/agentRouter.ts when the monolith was split into eight
 * domain sub-routers. Covers:
 *   - OpsAgent natural-language ops queries + action execution
 *   - Self-Retrospective on-demand run (cron trigger lives elsewhere)
 *
 * Procedures (3):
 *   - askOps
 *   - executeOpsAction
 *   - runRetrospective
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, sql } from "drizzle-orm";
import { router, adminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../../../drizzle/schema";
import {
  runSelfRetrospective,
  formatRetrospectiveAsMessage,
} from "../../agents/autonomous/selfRetrospective";

export const opsRouter = router({
  // ─────────────────────────────────────────────────────────────────
  // Round 81 / 2026-05-17 — OpsAgent
  //
  // Natural-language ops queries. Jeff types in #ops channel of
  // ChatsTab → this procedure runs OpsAgent + writes both Jeff's
  // question and the agent answer to agentMessages so the conversation
  // is persistent + visible to the future mobile app.
  // ─────────────────────────────────────────────────────────────────

  askOps: adminProcedure
    .input(
      z.object({
        question: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Round 81 Phase 1 (2026-05-17): pull last 10 #ops messages as
      // conversation memory. Without this, every question is treated as
      // standalone and Jeff has to re-specify customer/date for follow-ups.
      const historyRows = await db
        .select({
          senderRole: agentMessages.senderRole,
          body: agentMessages.body,
          createdAt: agentMessages.createdAt,
        })
        .from(agentMessages)
        .where(eq(agentMessages.agentName, "ops"))
        .orderBy(desc(agentMessages.createdAt))
        .limit(10);

      // Reverse to chronological order
      const history = historyRows.reverse().map((r) => ({
        role: (r.senderRole === "jeff" ? "user" : "agent") as "user" | "agent",
        content: r.body,
      }));

      // 1. Log Jeff's question as senderRole='jeff' so the channel shows it
      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "jeff",
        messageType: "question",
        title: input.question.slice(0, 80),
        body: input.question,
        priority: "normal",
        readByJeff: 1, // Jeff's own message — pre-marked read
      } as any);

      // 2. Run the agent with history context
      const { runOpsAgent } = await import("../../agents/autonomous/opsAgent");
      let answer = "";
      let suggestedActions: any[] = [];
      let error: string | null = null;
      try {
        const result = await runOpsAgent(input.question, history);
        answer = result.answer;
        suggestedActions = result.suggestedActions;

        // 3. Log agent answer + suggestedActions (rendered as chips in UI)
        await db.insert(agentMessages).values({
          agentName: "ops",
          senderRole: "agent",
          messageType: "observation",
          title: input.question.slice(0, 80),
          body: result.answer,
          context: JSON.stringify({
            hintsExtracted: result.hints,
            queriesRun: Object.keys(result.contextUsed),
            suggestedActions: result.suggestedActions,
          }),
          priority: "normal",
        } as any);
      } catch (err) {
        error = (err as Error).message;
        await db.insert(agentMessages).values({
          agentName: "ops",
          senderRole: "agent",
          messageType: "alert",
          title: `OpsAgent failed: ${input.question.slice(0, 60)}`,
          body: `Error: ${error}\n\nQuestion was: ${input.question}`,
          priority: "high",
        } as any);
      }

      return { answer, suggestedActions, error };
    }),

  /**
   * Round 81 Phase 2 (2026-05-17) — Execute an OpsAgent action proposal.
   *
   * Jeff clicks a chip in ChatsTab → frontend shows confirmation modal
   * (with typed-confirm for sensitivity='sensitive') → on confirm, this
   * mutation runs. The action is executed, result logged as a new
   * #ops message, so the conversation shows "I asked X, agent suggested Y,
   * I confirmed, agent did Z".
   */
  executeOpsAction: adminProcedure
    .input(
      z.object({
        actionType: z.string().min(1),
        args: z.any(),
        // Echo back to UI for the audit log entry
        proposalContext: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { executeOpsAction, ActionTypeEnum } = await import(
        "../../agents/autonomous/opsActions"
      );

      // Validate actionType is one of the known enum values
      const parsed = ActionTypeEnum.safeParse(input.actionType);
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown actionType: ${input.actionType}`,
        });
      }

      const result = await executeOpsAction(parsed.data, input.args);

      // Log the execution as a new #ops message — both confirmation by Jeff
      // (as 'jeff' role) and the result (as 'agent' role)
      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "jeff",
        messageType: "observation",
        title: `→ 執行: ${input.proposalContext?.slice(0, 60) ?? parsed.data}`,
        body: `Action type: ${parsed.data}\nArgs: ${JSON.stringify(input.args, null, 2)}`,
        priority: "low",
        readByJeff: 1,
      } as any);

      await db.insert(agentMessages).values({
        agentName: "ops",
        senderRole: "agent",
        messageType: result.ok ? "observation" : "alert",
        title: result.summary,
        body: result.error
          ? `失敗: ${result.error}\n\n${result.summary}`
          : result.summary +
            (result.details
              ? `\n\nDetails:\n${JSON.stringify(result.details, null, 2)}`
              : ""),
        priority: result.ok ? "normal" : "high",
        context: JSON.stringify({ executedAction: parsed.data, args: input.args }),
      } as any);

      return result;
    }),

  // ─────────────────────────────────────────────────────────────────
  // Phase 3 (Round 81 — Learning System): Self-Retrospective
  //
  // Reads past N days of outcomes + policies, asks the retrospective
  // agent to propose policy improvements. Posts result as an
  // agentMessages row (messageType=proposal, agentName=self_retrospective)
  // which surfaces in the Inbox.
  // Phase 3.5 will add a weekly cron trigger.
  // ─────────────────────────────────────────────────────────────────

  runRetrospective: adminProcedure
    .input(
      z
        .object({ windowDays: z.number().int().min(1).max(60).default(7) })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const windowDays = input?.windowDays ?? 7;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      // Pull outcomes for ALL agents over the window
      const outcomes = await db
        .select({
          agentName: interactionOutcomes.agentName,
          actionTaken: interactionOutcomes.actionTaken,
          confidence: interactionOutcomes.confidence,
          customerSentiment: interactionOutcomes.customerSentiment,
          customerBooked: interactionOutcomes.customerBooked,
          refundRequested: interactionOutcomes.refundRequested,
          jeffOverride: interactionOutcomes.jeffOverride,
          jeffOverrideReason: interactionOutcomes.jeffOverrideReason,
          outcomeFinalized: interactionOutcomes.outcomeFinalized,
          createdAt: interactionOutcomes.createdAt,
        })
        .from(interactionOutcomes)
        .where(sql`${interactionOutcomes.createdAt} >= ${since}`)
        .orderBy(desc(interactionOutcomes.createdAt))
        .limit(500);

      // Pull all active policies (one per agent)
      const policies = await db
        .select({
          agentName: agentPolicies.agentName,
          version: agentPolicies.version,
          rules: agentPolicies.rules,
        })
        .from(agentPolicies)
        .where(eq(agentPolicies.active, 1));

      let retro;
      try {
        retro = await runSelfRetrospective({
          outcomes: outcomes.map((o) => ({
            ...o,
            customerSentiment: o.customerSentiment ?? null,
          })),
          policies,
          windowDays,
        });
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Retrospective failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // Persist as a proposal message in #全體 (so Inbox can pick it up)
      const formatted = formatRetrospectiveAsMessage(retro, windowDays);
      const ins = await db.insert(agentMessages).values({
        agentName: "general",
        senderRole: "agent",
        messageType: "proposal",
        title: formatted.title,
        body: formatted.body,
        context: formatted.context,
        priority: retro.proposals.length > 0 ? "high" : "normal",
      });
      const messageId = Number((ins as any)[0]?.insertId ?? 0);

      return { messageId, retro, totalOutcomesAnalyzed: outcomes.length };
    }),
});
