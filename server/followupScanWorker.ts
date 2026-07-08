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
import { runFollowupDraftScan } from "./agents/autonomous/followupDraftProducer";
import { wireWorkerFunnel } from "./_core/errorFunnel";

export const followupScanWorker = new Worker<FollowupScanJobData, FollowupScanJobResult>(
  "followup-scan",
  async (job: Job<FollowupScanJobData, FollowupScanJobResult>) => {
    console.log(
      `[FollowupScanWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const db = await getDb();
    if (!db) return { candidates: 0, posted: 0, skipped: 0 };
    // Step 4: first auto-DRAFT a gentle follow-up for every draftable stale
    // customer (lands in the cockpit 待審草稿 panel, never sent). Then the inbox
    // reminder covers only the NON-draftable ones (no thread / sensitive),
    // excluding the drafted set so nothing double-surfaces.
    const draftRes = await runFollowupDraftScan(db);
    const result = await runFollowupScan(db, {
      excludeProfileIds: draftRes.draftedProfileIds,
    });
    console.log(
      `[FollowupScanWorker] Scan ${job.id}: drafted=${draftRes.drafted} candidates=${result.candidates} posted=${result.posted} skipped=${result.skipped}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

followupScanWorker.on("failed", (job, err) => {
  console.error(`[FollowupScanWorker] Job ${job?.id} failed:`, err);
});

wireWorkerFunnel(followupScanWorker, "followup-scan");

console.log("✅ Followup scan worker initialized");
