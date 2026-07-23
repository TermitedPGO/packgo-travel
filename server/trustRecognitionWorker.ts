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
 * B1 fail-closed (2026-07-12): the daily tick is a READ-ONLY scan. It NEVER
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

/**
 * The daily-cron job processor, extracted (B1.1, 2026-07-12) so an integration
 * test can run the real funnel — transfer detection (mechanically forced
 * dry-run) + scanRecognitionDue + review card — without constructing a BullMQ
 * Worker or opening a Redis connection. Behavior is byte-identical to the
 * previous inline processor.
 */
export async function processTrustRecognitionJob(
  job: Job<TrustRecognitionJobData, TrustRecognitionJobResult>,
): Promise<TrustRecognitionJobResult> {
    console.log(
      `[trustRecognitionWorker] starting run ${job.id} (triggered by: ${job.data.triggeredBy})`
    );

    const { scanRecognitionDue, maybePostRecognitionDueCard, isAnyTrustDeferralEnabled } =
      await import("./services/trustDeferralService");

    // F1 塊B (2026-07-08) 對抗審查 P1 修復:改用 isAnyTrustDeferralEnabled
    // (PLAID flag OR STRIPE flag)——這支 worker 是 scanRecognitionDue
    // 的唯一日常呼叫端,外層的 gate 若還只看 PLAID flag,即使函式本體已經
    // 修好,worker 還是會在 STRIPE-only 開啟時提早 return 不呼叫它。
    // F2 塊B(2026-07-10):Trust→Operating 轉帳偵測,搭每日認列 cron 便車。
    // B1.1(Codex 6.5 P0.1,2026-07-12):回填閉環暫停 —— 這裡硬帶 dryRun:true
    // 作雙保險(服務內另有 isTrustTransferWriteApproved 機械閘,現硬回 false
    // 亦強制 dry-run)。矩陣未核准前:不回填 transferredAt、不出催轉卡、不動錢。
    // §17550.15(c) 無「會計已認列即可轉」;歷史 recognizedAt 可能來自舊出發日
    // 規則,不得驅動 Jeff 動真錢。仍放 flag gate 之前(觀察對象是歷史列,與當下
    // flag 無關)。runTrustTransferDetection 本體絕不 throw(內部降級)。
    const { runTrustTransferDetection } = await import(
      "./services/trustTransferDetection"
    );
    const transferReport = await runTrustTransferDetection({ dryRun: true });
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
          `${result.dueForReview} 筆舊規則審查日已到、已配對訂單的客戶款列為到期待審,總額 $${total.toFixed(2)}。\n\n` +
          `審查日到不代表已出發、可認列或可從信託提領。系統不自動認列(認列是你的動錢權)。\n` +
          `等 CPA 認列矩陣核准後,由你逐筆核。明細與去重狀態見駕駛艙的「到期待審」卡。`,
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
}

export const trustRecognitionWorker = new Worker<
  TrustRecognitionJobData,
  TrustRecognitionJobResult
>("trust-recognition", processTrustRecognitionJob, {
  connection: redisBullMQ,
  concurrency: 1,
  lockDuration: 600_000, // 10 min
  lockRenewTime: 180_000, // 3 min
});

trustRecognitionWorker.on("completed", (job, result) => {
  console.log(
    `[trustRecognitionWorker] ✅ ${job.id}: ${result.dueForReview} due for review`
  );
});

/**
 * failed-listener 告警路徑,抽成具名函式以便單測(B1.1 P1.3:scanRecognitionDue 在
 * DB 不可用時 throw → job reject → BullMQ 走 failed → 這裡發 notifyOwner 告警)。
 * 行為與原本 inline listener 逐字相同(fire-and-forget notifyOwner + 失敗降級到
 * errorFunnel)。回傳 Promise 純為可測;.on("failed") 仍不 await(BullMQ 慣例)。
 */
export async function handleTrustRecognitionJobFailed(
  job: Job<TrustRecognitionJobData, TrustRecognitionJobResult> | undefined,
  err: Error,
): Promise<void> {
  console.error(`[trustRecognitionWorker] ❌ ${job?.id} failed:`, err.message);
  await notifyOwner({
    title: `[trustRecognitionWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => {
    console.error("[notifyOwner] dispatch failed:", e);
    reportFunnelError({ source: "fail-open:trustRecognitionWorker:notifyOwnerFailed", err: e, context: { jobId: job?.id ?? "?" } }).catch(() => {});
  });
}

trustRecognitionWorker.on("failed", (job, err) => {
  void handleTrustRecognitionJobFailed(job, err);
});

wireWorkerFunnel(trustRecognitionWorker, "trust-recognition");

console.log("✅ Trust recognition worker initialized");
