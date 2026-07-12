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
 * B1 fail-closed (2026-07-13): the daily tick is a READ-ONLY scan. It NEVER
 * writes recognizedAt — recognition is Jeff's money-move call, frozen until
 * the CPA recognition matrix is approved. dueForReview rows only produce a
 * review card (agentMessages) for Jeff to reconcile per-row later.
 *
 * Feature-flagged via the PLAID/STRIPE trust-deferral flags — when both off,
 * the worker fires but scanRecognitionDue returns empty immediately.
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

    const { scanRecognitionDue, maybePostRecognitionDueCard, isAnyTrustDeferralEnabled } =
      await import("./services/trustDeferralService");

    // F1 塊B (2026-07-08) 對抗審查 P1 修復:改用 isAnyTrustDeferralEnabled
    // (PLAID flag OR STRIPE flag)——這支 worker 是 scanRecognitionDue
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
        dueForReview: 0,
        skippedNoDepartureDate: 0,
        skippedNotMatched: 0,
        skippedCancelledBooking: 0,
      };
    }

    // B1 fail-closed:唯讀掃描,零 recognizedAt 寫入。到期款只列待審,不認列。
    const result = await scanRecognitionDue({
      runId: `cron-${job.id}-${Date.now()}`,
    });
    console.log(
      `[trustRecognitionWorker] ✅ run ${job.id}: scanned=${result.scanned} dueForReview=${result.dueForReview} skipNoDate=${result.skippedNoDepartureDate} skipNoMatch=${result.skippedNotMatched} skipCancelled=${result.skippedCancelledBooking}`
    );

    // B1 fail-closed:到期待審 → 出一張 agentMessages 待審卡(同集合去重,照
    // trustInvariantWatchdog 模式)+ notifyOwner 待審摘要。認列凍結,等 CPA
    // 認列矩陣核准後由 Jeff 逐筆核 —— 文案只講到期待審,不再誤導成錢可轉出。
    if (result.dueForReview > 0) {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (db) {
        await maybePostRecognitionDueCard(db, result).catch((e) => {
          reportFunnelError({
            source: "fail-open:trustRecognitionWorker:dueCardFailed",
            err: e,
            context: { jobId: job.id ?? "?" },
          }).catch(() => {});
        });
      }
      const total = result.dueRows.reduce((s, r) => s + r.amount, 0);
      await notifyOwner({
        title: `📋 信託到期待審 — ${result.dueForReview} 筆 $${total.toFixed(2)} 等你逐筆核`,
        content:
          `${result.dueForReview} 筆出發日已到、已配對訂單的客戶款今天到期待審,總額 $${total.toFixed(2)}。\n\n` +
          `系統不自動認列(認列是你的動錢權)。等 CPA 認列矩陣核准後,由你逐筆核。\n` +
          `明細與去重狀態見駕駛艙的「到期待審」卡。`,
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
    `[trustRecognitionWorker] ✅ ${job.id}: ${result.dueForReview} due for review`
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
