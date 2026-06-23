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
import { runCustomerSummaryScan } from "./_core/customerAiSummary";

export const customerSummaryWorker = new Worker<
  CustomerSummaryJobData,
  CustomerSummaryJobResult
>(
  "customer-summary",
  async (job: Job<CustomerSummaryJobData, CustomerSummaryJobResult>) => {
    console.log(
      `[CustomerSummaryWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const result = await runCustomerSummaryScan();
    console.log(
      `[CustomerSummaryWorker] Scan ${job.id}: scanned=${result.scanned} refreshed=${result.refreshed} errors=${result.errors}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

customerSummaryWorker.on("failed", (job, err) => {
  console.error(`[CustomerSummaryWorker] Job ${job?.id} failed:`, err);
});

console.log("✅ Customer summary worker initialized");
