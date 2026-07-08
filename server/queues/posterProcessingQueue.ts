/**
 * posterProcessingQueue.ts — Round 80.22 Phase H2.
 *
 * Async pipeline for supplier poster processing. Triggered by admin upload.
 * The full pipeline is too slow for an HTTP request (~30-40s):
 *   1. AI Vision analyses raw poster (Claude Haiku)
 *   2. gpt-image-2 generates PACK&GO branded poster
 *   3. Sharp post-process overlays real logo + footer strip
 *   4. 7 LLM calls in parallel generate platform copies
 *
 * Job lifecycle in DB:
 *   uploaded → processing → ready (success) | failed (error)
 *
 * Admin sees real-time status via polling tRPC `posters.get`.
 */
import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { getDb } from "../db";
import { posterAssets, posterPlatformCopies } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { processPosterFull } from "../_core/posterProcessor";
import { notifyOwner } from "../_core/notification";
import { wireWorkerFunnel } from "../_core/errorFunnel";

const QUEUE_NAME = "poster-processing";

export interface PosterProcessingJobData {
  posterAssetId: number;
}

export const posterProcessingQueue = new Queue<PosterProcessingJobData>(QUEUE_NAME, {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 50 },
  },
});

/** Enqueue a freshly uploaded poster for AI processing. */
export async function enqueuePosterProcessing(posterAssetId: number) {
  const job = await posterProcessingQueue.add(
    "process-poster",
    { posterAssetId },
    { jobId: `poster-${posterAssetId}` }
  );
  console.log(`[PosterQueue] Enqueued #${posterAssetId} → job ${job.id}`);
  return job;
}

let _worker: Worker<PosterProcessingJobData> | null = null;

export function initPosterProcessingWorker() {
  if (_worker) return _worker;
  _worker = new Worker<PosterProcessingJobData>(
    QUEUE_NAME,
    async (job) => {
      const { posterAssetId } = job.data;
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      // Fetch the poster row
      const [poster] = await db
        .select()
        .from(posterAssets)
        .where(eq(posterAssets.id, posterAssetId))
        .limit(1);
      if (!poster) {
        console.warn(`[PosterQueue] Poster ${posterAssetId} not found (skipping)`);
        return { skipped: true };
      }

      // Mark processing
      await db
        .update(posterAssets)
        .set({ status: "processing" })
        .where(eq(posterAssets.id, posterAssetId));

      try {
        const result = await processPosterFull({
          originalImageUrl: poster.originalImageUrl,
          originalCopyText: poster.originalCopyText ?? undefined,
          vendor: poster.sourceVendor,
          audience: poster.targetAudience,
        });

        // Update poster + insert 7 platform copies in one transaction
        await db.transaction(async (tx) => {
          await tx
            .update(posterAssets)
            .set({
              status: "ready",
              brandedImageUrl: result.brandedImageUrl,
              aiAnalysis: JSON.stringify(result.analysis),
              title: result.analysis.title || poster.title,
            })
            .where(eq(posterAssets.id, posterAssetId));

          for (const copy of result.copies) {
            await tx.insert(posterPlatformCopies).values({
              posterAssetId,
              platform: copy.platform,
              copyText: copy.copyText,
              hashtags: copy.hashtags ?? null,
              status: "draft",
            });
          }
        });

        console.log(
          `[PosterQueue] ✓ Processed #${posterAssetId} (cost ~$${result.brandedImageCost.toFixed(3)})`
        );
        return { ok: true };
      } catch (err: any) {
        console.error(`[PosterQueue] Failed #${posterAssetId}:`, err?.message || err);
        await db
          .update(posterAssets)
          .set({ status: "failed", notes: String(err?.message || err).slice(0, 1000) })
          .where(eq(posterAssets.id, posterAssetId));
        throw err; // BullMQ will retry per attempts config
      }
    },
    {
      connection: redisBullMQ,
      concurrency: 2, // gpt-image-2 takes 15-25s; running 2 in parallel is safe
    }
  );

  _worker.on("failed", (job, err) => {
    console.error(`[PosterQueue] Job ${job?.id} FAILED:`, err.message);
    notifyOwner({
      title: `[PosterQueue] Job ${job?.id ?? "?"} failed`,
      content: `Poster asset ID: ${(job?.data as any)?.posterAssetId ?? "?"}\nError: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
    }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
  });

  wireWorkerFunnel(_worker, QUEUE_NAME);

  console.log("✅ Poster processing worker initialized");
  return _worker;
}
