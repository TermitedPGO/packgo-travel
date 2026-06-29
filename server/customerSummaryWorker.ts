/**
 * BullMQ Worker for the customer-AI-summary warm-up cron
 * (customer-ai-sessions 批3 m3).
 *
 * Drains `customerSummaryQueue` and recomputes the AI summary for active +
 * stale customers (runCustomerSummaryScan). Read-only w.r.t. customers — it
 * only writes the summary cache. Failures per customer are swallowed inside the
 * scan; the job itself just reports stats.
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type {
  CustomerSummaryJobData,
  CustomerSummaryJobResult,
} from "./queue";
import { runCustomerSummaryScan, refreshSummaryForProfile } from "./_core/customerAiSummary";
import { backfillMissingPreferences } from "./_core/customerPreferenceExtractor";

export const customerSummaryWorker = new Worker<
  CustomerSummaryJobData,
  CustomerSummaryJobResult
>(
  "customer-summary",
  async (job: Job<CustomerSummaryJobData, CustomerSummaryJobResult>) => {
    // Event-driven (new activity): recompute just that one customer's card.
    if (job.data.profileId) {
      const pid = job.data.profileId;
      try {
        await refreshSummaryForProfile(pid);
        console.log(`[CustomerSummaryWorker] event refresh done (profile ${pid})`);
        return { scanned: 1, refreshed: 1, errors: 0 };
      } catch (e) {
        console.error(`[CustomerSummaryWorker] event refresh failed (profile ${pid}):`, e);
        return { scanned: 1, refreshed: 0, errors: 1 };
      }
    }
    // Scheduled / manual full scan.
    console.log(
      `[CustomerSummaryWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const result = await runCustomerSummaryScan();
    console.log(
      `[CustomerSummaryWorker] Scan ${job.id}: scanned=${result.scanned} refreshed=${result.refreshed} errors=${result.errors}`,
    );
    // customer-memory M2 — back-fill preferences for never-extracted customers
    // (bounded + deduped). Non-fatal: a failure here must not fail the summary
    // job; the summary result is what the queue reports.
    try {
      const bf = await backfillMissingPreferences(25);
      console.log(
        `[CustomerSummaryWorker] preference back-fill: scanned=${bf.scanned} extracted=${bf.extracted}`,
      );
    } catch (e) {
      console.error(
        "[CustomerSummaryWorker] preference back-fill failed (non-fatal):",
        e,
      );
    }
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

customerSummaryWorker.on("failed", (job, err) => {
  console.error(`[CustomerSummaryWorker] Job ${job?.id} failed:`, err);
});

console.log("✅ Customer summary worker initialized");
