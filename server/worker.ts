import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis"; // BUG-001: dedicated BullMQ connection (commandTimeout:0)
import {
  TourGenerationJobData,
  TourGenerationProgress,
  TourGenerationResult,
  TourTranslationJobData,
  TourTranslationResult,
} from "./queue";
import { generateTourFromUrlInternal } from "./tourGenerator";
import { translateTour, Language } from "./translation";

/**
 * Worker for processing tour generation jobs
 *
 * 進度更新說明：
 * - 實際進度由 MasterAgent 內部的 onProgress 回調控制
 * - Worker 只負責初始化和錯誤處理
 * - 進度百分比由 MasterAgent 根據實際執行階段計算
 *
 * Redis 請求量優化說明（2026-03-28）：
 * - drainDelay: 30s（預設 5s）→ 空閒時每 30 秒才 long-poll 一次，減少 ~83% idle 請求
 * - stalledInterval: 300s（預設 30s）→ 每 5 分鐘才檢查 stalled job，減少 ~90% 檢查請求
 * - concurrency: 1（預設 1）→ 行程生成是重型 AI 任務，不需要並行
 * 預估每日 Redis 請求量：~8,000 次（原本 ~50,000+ 次）
 */
export const tourGenerationWorker = new Worker<TourGenerationJobData, TourGenerationResult>(
  "tour-generation",
  async (job: Job<TourGenerationJobData, TourGenerationResult>) => {
    console.log(`🚀 Processing tour generation job: ${job.id}`);

    try {
      // Update progress: Starting
      await updateProgress(job, {
        step: "starting",
        progress: 0,
        message: "初始化生成任務...",
        timestamp: Date.now(),
      });

      // Call the actual tour generation function
      // MasterAgent 會透過 onProgress 回調更新進度
      const result = await generateTourFromUrlInternal(
        job.data.url,
        job.data.userId,
        job,
        job.data.forceRegenerate || false,
        job.data.isPdf || false,
        job.data.supplementUrl
      );

      // Complete
      await updateProgress(job, {
        step: "completed",
        progress: 100,
        message: "行程生成完成！",
        timestamp: Date.now(),
      });

      console.log(`✅ Tour generation job completed: ${job.id}`);

      return result;
    } catch (error) {
      console.error(`❌ Tour generation job failed: ${job.id}`, error);

      await updateProgress(job, {
        step: "failed",
        progress: 0,
        message: error instanceof Error ? error.message : "生成失敗",
        timestamp: Date.now(),
      });

      throw error;
    }
  },
  {
    connection: redisBullMQ, // BUG-001: use dedicated connection without commandTimeout
    concurrency: 1, // 行程生成是重型 AI 任務，單一並行即可
    lockDuration: 1200000, // 20 分鐘鎖定（長任務需要）
    lockRenewTime: 600000, // 每 10 分鐘更新鎖定
    maxStalledCount: 3, // 最多 3 次 stalled 重試

    // === Redis 請求量優化設定 ===
    // drainDelay: Queue 空閒時 long-poll 間隔（秒）
    // 預設 5s → 改為 30s，空閒時減少 ~83% Redis 請求
    drainDelay: 30,

    // stalledInterval: 檢查 stalled job 的間隔（毫秒）
    // 預設 30,000ms → 改為 300,000ms（5 分鐘）
    // 行程生成任務本身就需要數分鐘，5 分鐘檢查一次已足夠
    stalledInterval: 300000,

    limiter: {
      max: 10, // 每分鐘最多 10 個任務
      duration: 60000,
    },
  }
);

/**
 * Helper function to update job progress
 */
async function updateProgress(
  job: Job<TourGenerationJobData, TourGenerationResult>,
  progress: TourGenerationProgress
) {
  await job.updateProgress(progress);
  console.log(`📊 Job ${job.id} progress: ${progress.progress}% - ${progress.message}`);
}

// Event listeners
tourGenerationWorker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

tourGenerationWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

tourGenerationWorker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});

console.log("✅ Tour generation worker initialized (optimized Redis polling)");

// ============================================================
// Tour Translation Worker (BUG-006)
// Processes translation jobs from the tourTranslationQueue
// ============================================================

export const tourTranslationWorker = new Worker<TourTranslationJobData, TourTranslationResult>(
  "tour-translation",
  async (job: Job<TourTranslationJobData, TourTranslationResult>) => {
    const { tourId, targetLanguages, sourceLanguage, userId } = job.data;
    console.log(`🌐 Processing translation job: ${job.id} (tour #${tourId} → ${targetLanguages.join(", ")})`);

    const result = await translateTour(
      tourId,
      targetLanguages as Language[],
      sourceLanguage as Language,
      userId
    );

    if (!result.success && result.errors.length > 0) {
      // Throw to trigger BullMQ retry
      throw new Error(`Translation failed: ${result.errors.join("; ")}`);
    }

    console.log(`✅ Translation job completed: ${job.id} (translated: ${result.translatedLanguages.join(", ")})`);
    return result;
  },
  {
    connection: redisBullMQ,
    concurrency: 2, // Allow 2 concurrent translations
    lockDuration: 300000, // 5 minutes lock (translation is faster than generation)
    lockRenewTime: 120000, // Renew every 2 minutes
    drainDelay: 30, // Same as tour generation worker
    stalledInterval: 300000,
  }
);

tourTranslationWorker.on("completed", (job) => {
  console.log(`✅ Translation job ${job.id} completed`);
});

tourTranslationWorker.on("failed", (job, err) => {
  console.error(`❌ Translation job ${job?.id} failed:`, err.message);
});

tourTranslationWorker.on("error", (err) => {
  console.error("❌ Translation worker error:", err);
});

console.log("✅ Tour translation worker initialized");

// Initialize tour monitor worker
export { tourMonitorWorker } from "./tourMonitorWorker";

export default tourGenerationWorker;
