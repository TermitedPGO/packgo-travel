/**
 * BullMQ Worker for the nightly stale-customer follow-up scan
 * (gmail-thread-filing layer 2).
 *
 * Drains `followupScanQueue` and runs `runFollowupScan`, which reads the real
 * filed conversations, finds customers who went quiet after we spoke last, and
 * posts a reminder into Jeff's office inbox (agentMessages). It NEVER emails the
 * customer. Per-customer failures are swallowed inside the scan; the job reports
 * stats.
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type { FollowupScanJobData, FollowupScanJobResult } from "./queue";
import { getDb } from "./db";
import { runFollowupScan } from "./_core/followupScan";

export const followupScanWorker = new Worker<FollowupScanJobData, FollowupScanJobResult>(
  "followup-scan",
  async (job: Job<FollowupScanJobData, FollowupScanJobResult>) => {
    console.log(
      `[FollowupScanWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const db = await getDb();
    if (!db) return { candidates: 0, posted: 0, skipped: 0 };
    const result = await runFollowupScan(db);
    console.log(
      `[FollowupScanWorker] Scan ${job.id}: candidates=${result.candidates} posted=${result.posted} skipped=${result.skipped}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

followupScanWorker.on("failed", (job, err) => {
  console.error(`[FollowupScanWorker] Job ${job?.id} failed:`, err);
});

console.log("✅ Followup scan worker initialized");
