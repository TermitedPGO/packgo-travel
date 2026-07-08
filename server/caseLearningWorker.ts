// server/caseLearningWorker.ts — customer-cockpit Phase5 學習閉環,晚間批次
// 補漏。掃近 7 天 completed/cancelled 訂單,查重後蒸餾任何漏掉的案子。
// Mirrors duplicateProfileScanWorker.ts's shape exactly.
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type {
  CaseLearningBacklogJobData,
  CaseLearningBacklogJobResult,
} from "./queue";
import { runCaseLearningBacklogScan } from "./_core/caseLearning";
import { wireWorkerFunnel } from "./_core/errorFunnel";

export const caseLearningBacklogWorker = new Worker<
  CaseLearningBacklogJobData,
  CaseLearningBacklogJobResult
>(
  "case-learning-backlog",
  async (job: Job<CaseLearningBacklogJobData, CaseLearningBacklogJobResult>) => {
    console.log(
      `[CaseLearningBacklogWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );
    const result = await runCaseLearningBacklogScan(7);
    console.log(
      `[CaseLearningBacklogWorker] Scan ${job.id}: scanned=${result.scanned} distilled=${result.distilled} skipped=${result.skipped}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

caseLearningBacklogWorker.on("failed", (job, err) => {
  console.error(`[CaseLearningBacklogWorker] Job ${job?.id} failed:`, err);
});

wireWorkerFunnel(caseLearningBacklogWorker, "case-learning-backlog");

console.log("✅ Case-learning backlog worker initialized");
