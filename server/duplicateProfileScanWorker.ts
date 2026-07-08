/**
 * BullMQ Worker for the weekly duplicate-customer-profile reconciliation scan
 * (audit fix, 2026-06-30).
 *
 * Drains `duplicateProfileScanQueue` and runs `runDuplicateProfileScan`, which
 * finds customerProfiles rows sharing the same email/phone (no DB-level unique
 * constraint exists — see server/_core/duplicateProfileScan.ts for why) and
 * posts ONE digest into Jeff's office inbox (agentMessages) if any are found.
 * Never auto-merges or deletes — Jeff decides.
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type {
  DuplicateProfileScanJobData,
  DuplicateProfileScanJobResult,
} from "./queue";
import { getDb } from "./db";
import { runDuplicateProfileScan } from "./_core/duplicateProfileScan";
import { wireWorkerFunnel } from "./_core/errorFunnel";

export const duplicateProfileScanWorker = new Worker<
  DuplicateProfileScanJobData,
  DuplicateProfileScanJobResult
>(
  "duplicate-profile-scan",
  async (job: Job<DuplicateProfileScanJobData, DuplicateProfileScanJobResult>) => {
    console.log(
      `[DuplicateProfileScanWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const db = await getDb();
    if (!db) return { groups: 0, posted: false };
    const result = await runDuplicateProfileScan(db);
    console.log(
      `[DuplicateProfileScanWorker] Scan ${job.id}: groups=${result.groups} posted=${result.posted}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

duplicateProfileScanWorker.on("failed", (job, err) => {
  console.error(`[DuplicateProfileScanWorker] Job ${job?.id} failed:`, err);
});

wireWorkerFunnel(duplicateProfileScanWorker, "duplicate-profile-scan");

console.log("✅ Duplicate-profile scan worker initialized");
