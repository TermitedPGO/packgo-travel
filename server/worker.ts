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
import { rewriteSupplierTourInPlace } from "./services/supplierRewriteService";
import { translateTour, Language } from "./translation";
import { notifyOwner } from "./_core/notification";
import { captureException } from "./_core/sentry";
import { wireWorkerFunnel } from "./_core/errorFunnel";

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

      // Two code paths, picked by whether this is a supplier-import rewrite.
      //
      //  A. SUPPLIER REWRITE (sourceDraftTourId set) — the draft tour ALREADY
      //     has the real price + departures + a structured itinerary blob from
      //     the supplier import. We rewrite its PROSE in place and keep every
      //     fact intact. We do NOT re-scrape the source URL (for UV it's an
      //     unscrapeable JS SPA) and we do NOT create a new tour. The old path
      //     here re-scraped + regenerated, nuking price ($598→$0) + all
      //     departures (134→0) + producing garbage, then orphaned the good
      //     draft. See server/services/supplierRewriteService.ts.
      //
      //  B. ORGANIC URL / PDF (no sourceDraftTourId) — first-time generation
      //     from a scrapeable source. Unchanged: scrape → agents → createTour.
      const draftId = job.data.sourceDraftTourId;
      let result: TourGenerationResult;

      if (draftId) {
        // ── Path A: rewrite supplier draft in place (no re-scrape, no new tour) ──
        const rewrite = await rewriteSupplierTourInPlace(draftId);
        result = {
          success: rewrite.success,
          tourId: rewrite.tourId,
          error: rewrite.error,
        } as TourGenerationResult;

        await updateProgress(job, {
          step: rewrite.success ? "completed" : "failed",
          progress: 100,
          message: rewrite.success
            ? `行程改寫完成（狀態：${rewrite.status}）`
            : `行程改寫失敗：${rewrite.error ?? "unknown"}`,
          timestamp: Date.now(),
        });
        console.log(
          `✅ Supplier rewrite-in-place job completed: ${job.id} (tour #${draftId}, success=${rewrite.success}, status=${rewrite.status})`
        );
        // No draft cleanup needed — the rewrite happened IN PLACE on draftId.
        // On calibration reject the service already set status='inactive'; it
        // NEVER deletes the tour or its real departures.
      } else {
        // ── Path B: organic URL / PDF generation (unchanged) ──
        result = await generateTourFromUrlInternal(
          job.data.url,
          job.data.userId,
          job,
          job.data.forceRegenerate || false,
          job.data.isPdf || false,
          job.data.supplementUrl
        );

        await updateProgress(job, {
          step: "completed",
          progress: 100,
          message: "行程生成完成！",
          timestamp: Date.now(),
        });
        console.log(`✅ Tour generation job completed: ${job.id}`);
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
    // 2026-05-26: was concurrency=4. The 150-tour batch I queued tonight
    // hit Anthropic's 450k INPUT TOKEN/min cap on Haiku 4.5 (the prior
    // math sized for REQUEST count, not tokens — translation calls are
    // token-heavy). 4 tours × ~6 parallel sub-agents × ~20k tokens =
    // ~480k/min peak → 429 storm → Sentry email flood.
    //
    // Concurrency=2 gives ~240k tokens/min peak — comfortable headroom
    // under the 450k cap. 150-tour batch: 13 min → ~26 min, acceptable
    // for an overnight cron. The 429 retry in invokeLLM is a belt-and-
    // braces defense; this reduction is the suspenders.
    concurrency: 2,
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
  // v2 Wave 1 Module 1.1 — Sentry capture alongside email (belt + suspenders).
  captureException(err, {
    tags: {
      worker: "tour-generation",
      jobId: String(job?.id ?? "?"),
    },
    extras: {
      tourId: (job?.data as any)?.tourId ?? null,
      url: (job?.data as any)?.url ?? null,
    },
  });
  notifyOwner({
    title: `[TourGeneration] Job ${job?.id ?? "?"} failed`,
    content: `Tour ID: ${(job?.data as any)?.tourId ?? "?"}\nError: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

tourGenerationWorker.on("error", (err) => {
  console.error("❌ Worker error:", err);
  captureException(err, { tags: { worker: "tour-generation", phase: "worker-error" } });
});

wireWorkerFunnel(tourGenerationWorker, "tour-generation");

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
  // v2 Wave 1 Module 1.1 — Sentry capture alongside email.
  captureException(err, {
    tags: {
      worker: "tour-translation",
      jobId: String(job?.id ?? "?"),
    },
    extras: {
      tourId: (job?.data as any)?.tourId ?? null,
      targetLanguages: (job?.data as any)?.targetLanguages ?? null,
    },
  });
  notifyOwner({
    title: `[TourTranslation] Job ${job?.id ?? "?"} failed`,
    content: `Tour ID: ${(job?.data as any)?.tourId ?? "?"}\nError: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

tourTranslationWorker.on("error", (err) => {
  console.error("❌ Translation worker error:", err);
  captureException(err, { tags: { worker: "tour-translation", phase: "worker-error" } });
});

wireWorkerFunnel(tourTranslationWorker, "tour-translation");

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
