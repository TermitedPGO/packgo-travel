/**
 * Round 81 Phase 3.5 — Retrospective Worker.
 *
 * Drains the `retrospective` queue. Fires weekly (Mon 01:00 UTC) and
 * on-demand (admin trigger). Reads past N days of agent outcomes +
 * policies, calls runSelfRetrospective, persists the result as an
 * agentMessages row in #全體 so it surfaces in the Inbox.
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import { getDb } from "./db";
import {
  interactionOutcomes,
  agentPolicies,
  agentMessages,
} from "../drizzle/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  runSelfRetrospective,
  formatRetrospectiveAsMessage,
} from "./agents/autonomous/selfRetrospective";
import { notifyOwner } from "./_core/notification";
import type {
  RetrospectiveJobData,
  RetrospectiveJobResult,
} from "./queue";

export const retrospectiveWorker = new Worker<
  RetrospectiveJobData,
  RetrospectiveJobResult
>(
  "retrospective",
  async (job) => {
    const windowDays = job.data.windowDays ?? 7;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

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

    const policies = await db
      .select({
        agentName: agentPolicies.agentName,
        version: agentPolicies.version,
        rules: agentPolicies.rules,
      })
      .from(agentPolicies)
      .where(eq(agentPolicies.active, 1));

    // QA audit 2026-05-11 Phase 1 fix: pull recent adopted/rejected
    // proposal messages so the LLM can avoid re-suggesting things
    // Jeff already evaluated. Looks back 60 days — long enough that
    // a quarterly review remembers, short enough that policies still
    // get re-examined if conditions actually change.
    const decisionLookback = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000
    );
    const decisionRows = await db
      .select({
        id: agentMessages.id,
        title: agentMessages.title,
        body: agentMessages.body,
        context: agentMessages.context,
        proposalDecision: agentMessages.proposalDecision,
        jeffResponse: agentMessages.jeffResponse,
        readAt: agentMessages.readAt,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.messageType, "proposal"),
          inArray(agentMessages.proposalDecision, ["adopted", "rejected"]),
          gte(agentMessages.createdAt, decisionLookback)
        )
      )
      .orderBy(desc(agentMessages.createdAt))
      .limit(30);

    // Flatten each retro message into per-proposal decision rows so
    // the LLM sees each individual suggestion + Jeff's verdict, not
    // just the wrapper title.
    const pastDecisions = decisionRows.flatMap((row) => {
      let proposals: Array<{
        agentName: string;
        proposedRulesDiff: string;
      }> = [];
      try {
        const ctx = JSON.parse(row.context ?? "{}");
        proposals = Array.isArray(ctx.proposals) ? ctx.proposals : [];
      } catch {
        /* ignore */
      }
      // If we can't extract per-proposal, fall back to one row using the title
      if (proposals.length === 0) {
        return [{
          proposalSummary: row.title,
          agentName: "general",
          decision: row.proposalDecision as "adopted" | "rejected",
          decidedAt: row.readAt ?? row.createdAt,
          note: row.jeffResponse,
        }];
      }
      return proposals.map((p) => ({
        proposalSummary: p.proposedRulesDiff ?? row.title,
        agentName: p.agentName ?? "general",
        decision: row.proposalDecision as "adopted" | "rejected",
        decidedAt: row.readAt ?? row.createdAt,
        note: row.jeffResponse,
      }));
    });

    const retro = await runSelfRetrospective({
      outcomes: outcomes.map((o) => ({
        ...o,
        customerSentiment: o.customerSentiment ?? null,
      })),
      policies,
      windowDays,
      pastDecisions,
    });

    const formatted = formatRetrospectiveAsMessage(retro, windowDays);
    const ins = await db.insert(agentMessages).values({
      agentName: "general",
      senderRole: "agent",
      messageType: "proposal",
      title: `[${job.data.triggeredBy === "schedule" ? "週度" : "手動"}] ${formatted.title}`,
      body: formatted.body,
      context: formatted.context,
      priority: retro.proposals.length > 0 ? "high" : "normal",
    });

    return {
      totalOutcomesAnalyzed: outcomes.length,
      proposalsCount: retro.proposals.length,
      messageId: Number((ins as any)[0]?.insertId ?? 0),
    };
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600000, // 10 min — LLM call can be slow
  }
);

retrospectiveWorker.on("completed", (job, result) => {
  console.log(
    `[RetrospectiveWorker] ✅ Job ${job.id} (${job.data.triggeredBy}): analyzed=${result.totalOutcomesAnalyzed} proposals=${result.proposalsCount} messageId=${result.messageId}`
  );
});
retrospectiveWorker.on("failed", (job, err) => {
  console.error(
    `[RetrospectiveWorker] ❌ Job ${job?.id} failed: ${err.message}`
  );
  notifyOwner({
    title: `[RetrospectiveWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Retrospective worker started");
