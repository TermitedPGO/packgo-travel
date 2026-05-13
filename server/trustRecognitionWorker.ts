/**
 * BullMQ worker for the daily trust-recognition cron (Phase 4).
 *
 * Each tick scans trustDeferredIncome for rows where:
 *   - recognizedAt IS NULL
 *   - reversedAt IS NULL
 *   - expectedRecognitionDate <= today
 *   - bookingId IS NOT NULL  (without a matched booking we can't be sure
 *                              the departure happened — those stay deferred
 *                              and surface in admin reconciliation)
 *
 * Marks them recognized so bankPLService stops subtracting them from income.
 *
 * Feature-flagged via PLAID_TRUST_DEFERRAL_ENABLED — when off, the worker
 * fires but recognizeReadyDepartures returns 0 immediately.
 */

import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type {
  TrustRecognitionJobData,
  TrustRecognitionJobResult,
} from "./queue";
import { notifyOwner } from "./_core/notification";

export const trustRecognitionWorker = new Worker<
  TrustRecognitionJobData,
  TrustRecognitionJobResult
>(
  "trust-recognition",
  async (job: Job<TrustRecognitionJobData, TrustRecognitionJobResult>) => {
    console.log(
      `[trustRecognitionWorker] starting run ${job.id} (triggered by: ${job.data.triggeredBy})`
    );

    const { recognizeReadyDepartures, isTrustDeferralEnabled } = await import(
      "./services/trustDeferralService"
    );

    if (!isTrustDeferralEnabled()) {
      console.log(
        "[trustRecognitionWorker] PLAID_TRUST_DEFERRAL_ENABLED is off — skipping"
      );
      return {
        runId: `disabled-${job.id}`,
        scanned: 0,
        recognized: 0,
        totalRecognizedAmount: 0,
        skippedNoDepartureDate: 0,
        skippedNotMatched: 0,
      };
    }

    const result = await recognizeReadyDepartures({
      runId: `cron-${job.id}-${Date.now()}`,
    });
    console.log(
      `[trustRecognitionWorker] ✅ run ${job.id}: scanned=${result.scanned} recognized=${result.recognized} amount=$${result.totalRecognizedAmount.toFixed(2)} skipNoDate=${result.skippedNoDepartureDate} skipNoMatch=${result.skippedNotMatched}`
    );

    // Notify owner if recognition crossed a non-trivial threshold OR if
    // there are unmatched rows piling up.
    if (result.recognized > 0 && result.totalRecognizedAmount > 1000) {
      await notifyOwner({
        title: `💰 信託收入認列 — $${result.totalRecognizedAmount.toFixed(2)}`,
        content:
          `${result.recognized} 筆出發前已收的客戶款今天認列為收入。\n` +
          `這些是已經出發的團 — 錢從信託帳戶 legally transition 到 PACK&GO 名下。\n` +
          `本月 P&L 會看到對應的 income_booking 跳升。`,
      });
    }
    if (result.skippedNotMatched > 5) {
      await notifyOwner({
        title: `⚠️ 信託對帳 — ${result.skippedNotMatched} 筆未配對`,
        content:
          `信託帳戶有 ${result.skippedNotMatched} 筆入帳還沒對到具體訂單。\n\n` +
          `Agent 配對信心不足或客戶用了不同金額付款。\n` +
          `進 admin → 財務 → 銀行帳戶 → 信託對帳 手動 link 一下。\n\n` +
          `這些不會被認列為收入,直到你 link 了訂單。`,
      });
    }

    return result;
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600_000, // 10 min
    lockRenewTime: 180_000, // 3 min
  }
);

trustRecognitionWorker.on("completed", (job, result) => {
  console.log(
    `[trustRecognitionWorker] ✅ ${job.id}: +${result.recognized} recognized`
  );
});

trustRecognitionWorker.on("failed", (job, err) => {
  console.error(`[trustRecognitionWorker] ❌ ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[trustRecognitionWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Trust recognition worker initialized");
