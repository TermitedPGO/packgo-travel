/**
 * customer-cockpit Phase3 3b — Monthly Draft Eval Worker.
 *
 * Drains the `draft-eval` queue. Fires monthly (1st of month 03:00 UTC) and
 * on-demand (admin trigger, if ever wired). Calls runMonthlyDraftEval(), which
 * is the sole coordinator — it re-generates sample drafts via the pure
 * runInquiryAgent, scores them with independent judge LLM calls, appends a
 * section to docs/features/customer-cockpit/eval-history.md, and posts an
 * agentMessages digest card. This worker itself does nothing but drive the
 * job and report the result — no email is ever sent from this path.
 *
 * File structure照抄 server/retrospectiveWorker.ts (both are "monthly/weekly
 * cron → single coordinator call → log result" shaped workers).
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import { runMonthlyDraftEval } from "./_core/draftEval";
import { notifyOwner } from "./_core/notification";
import type { DraftEvalJobData, DraftEvalJobResult } from "./queue";

export const draftEvalWorker = new Worker<DraftEvalJobData, DraftEvalJobResult>(
  "draft-eval",
  async (job) => {
    console.log(
      `[DraftEvalWorker] Starting monthly draft eval ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const report = await runMonthlyDraftEval();
    if (!report) {
      console.log("[DraftEvalWorker] Monthly draft eval produced no report (zero samples or failure)");
      return { ran: false };
    }
    console.log(
      `[DraftEvalWorker] ✅ Monthly draft eval done: overallScore=${report.overallScore} sampleSize=${report.sampleSize} degraded=${report.degraded}`,
    );
    return {
      ran: true,
      overallScore: report.overallScore,
      sampleSize: report.sampleSize,
      degraded: report.degraded,
    };
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 900000, // 15 min — up to 10 customers * 3 judge calls can be slow
  },
);

draftEvalWorker.on("completed", (job, result) => {
  console.log(
    `[DraftEvalWorker] Job ${job.id} completed: ran=${result.ran} overallScore=${result.overallScore ?? "n/a"}`,
  );
});
draftEvalWorker.on("failed", (job, err) => {
  console.error(`[DraftEvalWorker] ❌ Job ${job?.id} failed: ${err.message}`);
  notifyOwner({
    title: `[DraftEvalWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Draft eval worker started");
