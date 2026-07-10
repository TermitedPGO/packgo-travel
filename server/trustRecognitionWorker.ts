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
import { wireWorkerFunnel, reportFunnelError } from "./_core/errorFunnel";

export const trustRecognitionWorker = new Worker<
  TrustRecognitionJobData,
  TrustRecognitionJobResult
>(
  "trust-recognition",
  async (job: Job<TrustRecognitionJobData, TrustRecognitionJobResult>) => {
    console.log(
      `[trustRecognitionWorker] starting run ${job.id} (triggered by: ${job.data.triggeredBy})`
    );

    const { recognizeReadyDepartures, isAnyTrustDeferralEnabled } = await import(
      "./services/trustDeferralService"
    );

    // F1 塊B (2026-07-08) 對抗審查 P1 修復:改用 isAnyTrustDeferralEnabled
    // (PLAID flag OR STRIPE flag)——這支 worker 是 recognizeReadyDepartures
    // 的唯一日常呼叫端,外層的 gate 若還只看 PLAID flag,即使函式本體已經
    // 修好,worker 還是會在 STRIPE-only 開啟時提早 return 不呼叫它。
    // F2 塊B(2026-07-10):Trust→Operating 轉帳偵測 + 「認了沒轉錢」提醒,
    // 搭每日認列 cron 的便車。刻意放在 flag gate 之前 —— 偵測對象是「已存在
    // 的已認列列」(歷史事實,與當下 flag 開關無關),flag 全關時也要跑,
    // 否則歷史認列列的轉出閉環永遠不會回填。runTrustTransferDetection 本體
    // 絕不 throw(內部降級),不影響認列主流程。
    const { runTrustTransferDetection } = await import(
      "./services/trustTransferDetection"
    );
    const transferReport = await runTrustTransferDetection();
    if (transferReport.backfilled > 0 || transferReport.overdueCount > 0) {
      console.log(
        `[trustRecognitionWorker] transfer detection: backfilled=${transferReport.backfilled} pairs=${transferReport.pairsFound} overdue=${transferReport.overdueCount} ($${transferReport.overdueTotal.toFixed(2)})`
      );
    }

    if (!isAnyTrustDeferralEnabled()) {
      console.log(
        "[trustRecognitionWorker] trust deferral disabled (both PLAID_TRUST_DEFERRAL_ENABLED and STRIPE_TRUST_DEFERRAL_ENABLED are off) — skipping"
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

    // Q5 operational reminder: every day, list today's departures + the
    // amount in trust that Jeff manually needs to move trust → operating.
    // This is the bridge between the accounting (which is now correct in
    // the books via recognition) and the actual bank movement.
    if (result.recognized > 0) {
      await notifyOwner({
        title: `💰 信託收入認列 — $${result.totalRecognizedAmount.toFixed(2)} 該轉了`,
        content:
          `${result.recognized} 筆出發前已收的客戶款今天認列為收入,總額 $${result.totalRecognizedAmount.toFixed(2)}。\n\n` +
          `📋 **今天該手動操作:**\n` +
          `1. 從信託帳戶轉 **$${result.totalRecognizedAmount.toFixed(2)}** 到 operating 帳戶\n` +
          `2. 銀行 app / 網銀內部轉帳即可,系統會在下次 Plaid sync 抓到\n\n` +
          `本月 P&L 已經反映這筆 income(認列日 = 出發日)。`,
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
  }).catch((e) => {
    console.error("[notifyOwner] dispatch failed:", e);
    reportFunnelError({ source: "fail-open:trustRecognitionWorker:notifyOwnerFailed", err: e, context: { jobId: job?.id ?? "?" } }).catch(() => {});
  });
});

wireWorkerFunnel(trustRecognitionWorker, "trust-recognition");

console.log("✅ Trust recognition worker initialized");
