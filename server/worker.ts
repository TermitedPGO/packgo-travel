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
import { notifyOwner } from "./_core/notification";

/**
 * Worker for processing tour generation jobs
 *
 * 進度更新說明：
 * - 實際進度由 MasterAgent 內部的 onProgress 回調控制
 * - Worker 只負責初始化和錯誤處理
 * - 進度百分比由 MasterAgent 根據實際執行階段計算
 *
 * Redis 請求量優化設明（2026-03-28）：
 * - drainDelay: 30s（預設 5s）→ 空閒時每 30 秒才 long-poll 一次，減少 ~83% idle 請求
 * - stalledInterval: 600s（Round 36: 從 300s 延長）→ 每 10 分鐘才檢查 stalled job
 * - concurrency: 1（預設 1）→ 行程生成是重型 AI 任務，不需要並行
 * Round 36 修復： lockDuration 20分鐘→ 40分鐘， lockRenewTime 10分鐘→ 5分鐘（更頻繁更新）
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

      // 2026-05-16: if this job was spawned by a supplier-import rewrite
      // (sourceDraftTourId carries the original draft's row id), flip
      // that draft to status='inactive' now that the PACK&GO tour exists.
      // This keeps the catalog clean — no stranded drafts after rewrite.
      //
      // 2026-05-17 update: if the new tour was rejected by calibration
      // (result.rejected=true), the new tour was already auto-deleted in
      // tourGenerator. Delete the source draft entirely too — no point
      // keeping either copy around. Audit trail (#catalog message +
      // calibrationResults) preserved separately.
      const draftId = job.data.sourceDraftTourId;
      if (draftId && result?.success) {
        try {
          if ((result as any).rejected) {
            // Both ends rejected: hard-delete the source draft.
            const { getDb } = await import("./db");
            const dbInst = await getDb();
            if (dbInst) {
              const { tours: toursTable, tourDepartures } = await import("../drizzle/schema");
              const { eq } = await import("drizzle-orm");
              await dbInst.delete(tourDepartures).where(eq(tourDepartures.tourId, draftId)).catch(() => {});
              await dbInst.delete(toursTable).where(eq(toursTable.id, draftId));
              console.log(
                `🗑 Hard-deleted source draft tour #${draftId} (PACK&GO rewrite was rejected, cal=${(result as any).rejectedScore})`
              );
            }
          } else {
            const { updateTour } = await import("./db");
            await updateTour(draftId, { status: "inactive" });
            console.log(
              `🧹 Marked source draft tour #${draftId} as inactive after successful rewrite → new tour #${result.tourId}`
            );
          }
        } catch (cleanupErr) {
          console.warn(
            `[tourGenerationWorker] Failed to clean up source draft #${draftId}:`,
            cleanupErr
          );
        }
      }

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
    // v80.24: bulk-import scenarios queue 50-100 tours; concurrency=1 takes
    // ~50-100 minutes serial. Anthropic Haiku 4.5 has 4000 req/min limit on
    // tier 1, each tour fires ~10-15 LLM calls so concurrency=4 ≈ 60 req/min
    // — well under the cap. 50-tour batch: 50 min → ~13 min. Single-tour
    // latency unchanged.
    concurrency: 4,
    lockDuration: 2400000, // 40 分鐘鎖定（Round 36: 從 20分鐘提升，給 SPA 爬蟲+LLM 足夠時間）
    lockRenewTime: 300000,  // 每 5 分鐘更新鎖定（Round 36: 從 10分鐘縮短，更頻繁更新避免 stall）
    maxStalledCount: 3, // 最多 3 次 stalled 重試

    // === Redis 請求量優化設定 ===
    // drainDelay: Queue 空閒時 long-poll 間隔（秒）
    // 預設 5s → 改為 30s，空閒時減少 ~83% Redis 請求
    drainDelay: 30,

    // stalledInterval: 檢查 stalled job 的間隔（毫秒）
    // Round 36: 從 300,000ms（5分鐘）延長到 600,000ms（10分鐘）
    // 行程生成需要 2-5 分鐘，10 分鐘檢查一次已足夠
    stalledInterval: 600000,

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
  notifyOwner({
    title: `[TourGeneration] Job ${job?.id ?? "?"} failed`,
    content: `Tour ID: ${(job?.data as any)?.tourId ?? "?"}\nError: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
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
  notifyOwner({
    title: `[TourTranslation] Job ${job?.id ?? "?"} failed`,
    content: `Tour ID: ${(job?.data as any)?.tourId ?? "?"}\nError: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

tourTranslationWorker.on("error", (err) => {
  console.error("❌ Translation worker error:", err);
});

console.log("✅ Tour translation worker initialized");

// Initialize tour monitor worker
export { tourMonitorWorker } from "./tourMonitorWorker";

// v78l Sprint 4B: AI quote follow-up worker (24h/3d/7d email cadence)
import { initQuoteFollowUpWorker } from "./queues/quoteFollowUpQueue";
initQuoteFollowUpWorker();

// v78n Sprint 6A: booking abandonment recovery worker (30-min cart drop email)
import { initAbandonmentRecoveryWorker } from "./queues/abandonmentRecoveryQueue";
initAbandonmentRecoveryWorker();

export default tourGenerationWorker;
