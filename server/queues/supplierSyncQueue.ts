/**
 * supplierSyncQueue — daily catalog mirror for supplier products.
 *
 * Runs the full Lion + UV sync at 03:00 UTC (off-peak for both Taiwan
 * and the US west coast) via a BullMQ repeating job. Also exposes a
 * one-shot enqueue (`triggerManualSync`) for the admin "Sync now"
 * button in Phase 1E.
 *
 * Job shape:
 *   { kind: 'full' | 'lion-only' | 'uv-only', triggeredBy: 'cron' | 'admin' }
 *
 * Per Jeff's guidance: this is the upstream of his auto-generation
 * pipeline. After the mirror lands new products, downstream wiring
 * (Phase 1F) will pick up `newProductCodes[]` and queue tour-
 * generation jobs into the existing tourGenerationQueue.
 */

import { Queue, Worker, Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { notifyOwner } from "../_core/notification";
import { wireWorkerFunnel } from "../_core/errorFunnel";
import {
  syncAllSuppliers,
  syncLionCatalog,
  syncUvCatalog,
} from "../services/supplierSyncService";

const QUEUE_NAME = "supplier-sync";

/** Repeating job id — distinct from one-off jobs. */
const DAILY_JOB_ID = "supplier-sync-daily";

/** Cron at 03:00 UTC daily. Picked because:
 *    • 03:00 UTC ≈ 11:00 Taipei (post-lunch business hours, Lion's
 *      backend is responsive then) ≈ 19:00 LA prev day (PACK&GO's
 *      US users are mostly asleep — minimal customer-facing impact).
 *    • Both Lion and UV publish hot promotions in TW morning, so by
 *      11:00 Taipei the day's catalog is stable.
 */
const DAILY_CRON = "0 3 * * *";

export interface SupplierSyncJob {
  kind: "full" | "lion-only" | "uv-only";
  triggeredBy: "cron" | "admin";
  /** Admin user id when triggeredBy='admin', null otherwise. */
  adminUserId?: number | null;
}

export const supplierSyncQueue = new Queue<SupplierSyncJob>(QUEUE_NAME, {
  connection: redisBullMQ,
  defaultJobOptions: {
    // One retry — the sync is idempotent (upserts), so retrying after
    // a transient supplier blip is safe. More than one retry risks
    // hammering the supplier; the daily cron will catch up anyway.
    attempts: 2,
    backoff: { type: "exponential", delay: 5 * 60_000 },
    removeOnComplete: { count: 30 }, // keep last 30 for forensics
    removeOnFail: { count: 30 },
  },
});

/**
 * Bootstrap the daily repeat. Call this once at server startup AFTER
 * the worker is initialized.
 *
 * BullMQ stores repeat keys in Redis. Calling this multiple times with
 * the same pattern is idempotent — it doesn't duplicate. Changing the
 * pattern requires manually removing the old repeat key first.
 */
export async function ensureDailySupplierSyncScheduled(): Promise<void> {
  // Defensive: clear any duplicate scheduled jobs with a non-matching
  // pattern. removeRepeatable() returns true on success.
  const existing = await supplierSyncQueue.getRepeatableJobs();
  for (const r of existing) {
    if (r.id === DAILY_JOB_ID && r.pattern !== DAILY_CRON) {
      await supplierSyncQueue.removeRepeatableByKey(r.key);
    }
  }
  await supplierSyncQueue.add(
    DAILY_JOB_ID,
    { kind: "full", triggeredBy: "cron" },
    {
      jobId: DAILY_JOB_ID,
      repeat: { pattern: DAILY_CRON },
    }
  );
  console.log(
    `[supplierSync] Daily sync scheduled (cron "${DAILY_CRON}", id=${DAILY_JOB_ID})`
  );
}

/**
 * One-shot trigger for the admin "Sync now" button. Returns the
 * Bull job id so the UI can poll for completion.
 */
export async function triggerManualSync(input: {
  kind: "full" | "lion-only" | "uv-only";
  adminUserId: number;
}): Promise<string> {
  const jobId = `supplier-sync-manual-${Date.now()}-${input.adminUserId}`;
  await supplierSyncQueue.add(
    "manual",
    {
      kind: input.kind,
      triggeredBy: "admin",
      adminUserId: input.adminUserId,
    },
    { jobId }
  );
  return jobId;
}

let _worker: Worker<SupplierSyncJob> | null = null;

/**
 * Initialize the worker. Idempotent — subsequent calls return the
 * existing worker. Must be called from server bootstrap before
 * ensureDailySupplierSyncScheduled().
 *
 * Concurrency 1: only ONE supplier sync runs at a time. The sync
 * itself is sequential (Lion → UV) and hammering with concurrency >1
 * would just split bandwidth + risk hitting supplier rate limits twice.
 */
export function initSupplierSyncWorker(): Worker<SupplierSyncJob> {
  if (_worker) return _worker;
  _worker = new Worker<SupplierSyncJob>(
    QUEUE_NAME,
    async (job: Job<SupplierSyncJob>) => {
      const { kind, triggeredBy } = job.data;
      console.log(
        `[supplierSync] Starting ${kind} sync (triggered by ${triggeredBy}, job=${job.id})`
      );
      const startedAt = Date.now();
      try {
        if (kind === "lion-only") {
          const r = await syncLionCatalog();
          return { results: [r], durationMs: Date.now() - startedAt };
        }
        if (kind === "uv-only") {
          const r = await syncUvCatalog();
          return { results: [r], durationMs: Date.now() - startedAt };
        }
        // 'full' — both suppliers
        const results = await syncAllSuppliers();
        return { results, durationMs: Date.now() - startedAt };
      } catch (err) {
        // Throwing makes BullMQ mark the job failed + retry (per attempts).
        console.error(`[supplierSync] job ${job.id} threw:`, err);
        throw err;
      }
    },
    {
      connection: redisBullMQ,
      concurrency: 1,
    }
  );

  _worker.on("completed", (job, returnValue) => {
    const r = returnValue as { results?: unknown[]; durationMs?: number };
    console.log(
      `[supplierSync] Job ${job.id} completed in ${r.durationMs}ms (${
        r.results?.length ?? 0
      } supplier(s))`
    );
  });

  _worker.on("failed", (job, err) => {
    console.error(`[supplierSync] Job ${job?.id} failed:`, err.message);
    // Only page Jeff for FINAL failures (after all retries exhausted)
    // — transient supplier blips that auto-recover shouldn't email him.
    const attemptsMade = job?.attemptsMade ?? 0;
    const attemptsMax = job?.opts?.attempts ?? 1;
    if (attemptsMade >= attemptsMax) {
      notifyOwner({
        title: `[供應商同步] ${job?.id ?? "?"} 失敗 (重試 ${attemptsMade} 次)`,
        content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
      }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
    }
  });

  wireWorkerFunnel(_worker, QUEUE_NAME);

  console.log("✅ Supplier sync worker initialized (concurrency=1)");
  return _worker;
}
