/**
 * BullMQ Worker for the weekly customer correctness audit (customer-cockpit
 * Phase6 D1, 2026-07-03).
 *
 * Drains `weeklyCorrectnessAuditQueue` and runs `runWeeklyCorrectnessAudit`,
 * which recomputes the deterministic actions/delivered fields from
 * gatherCustomerFacts for every active, non-test customer and diffs them
 * against the cached aiSummary. Posts ONE digest into Jeff's office inbox
 * (agentMessages) if any customer's cache has drifted from reality; zero
 * differences → nothing posted. Read-only against customer data, zero LLM
 * calls, never emails anyone — see server/_core/weeklyCorrectnessAudit.ts.
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type {
  WeeklyCorrectnessAuditJobData,
  WeeklyCorrectnessAuditJobResult,
} from "./queue";
import { getDb } from "./db";
import { runWeeklyCorrectnessAudit } from "./_core/weeklyCorrectnessAudit";

export const weeklyCorrectnessAuditWorker = new Worker<
  WeeklyCorrectnessAuditJobData,
  WeeklyCorrectnessAuditJobResult
>(
  "weekly-correctness-audit",
  async (job: Job<WeeklyCorrectnessAuditJobData, WeeklyCorrectnessAuditJobResult>) => {
    console.log(
      `[WeeklyCorrectnessAuditWorker] Starting audit ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const db = await getDb();
    if (!db) return { compared: 0, mismatching: 0, degraded: 0, posted: false };
    const result = await runWeeklyCorrectnessAudit(db);
    console.log(
      `[WeeklyCorrectnessAuditWorker] Audit ${job.id}: compared=${result.compared} mismatching=${result.mismatching} degraded=${result.degraded} posted=${result.posted}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

weeklyCorrectnessAuditWorker.on("failed", (job, err) => {
  console.error(`[WeeklyCorrectnessAuditWorker] Job ${job?.id} failed:`, err);
});

console.log("✅ Weekly correctness audit worker initialized");
