/**
 * BullMQ worker for the Plaid daily sync queue (Phase 1.5).
 *
 * Drains plaidDailySyncQueue jobs. Each job triggers a full pass over
 * every active linkedBankAccount: pull new transactions via Plaid's
 * /transactions/sync, upsert them, advance the cursor.
 *
 * Why a worker (not an inline cron):
 *   - Survives server restarts mid-run (BullMQ + Redis persistence)
 *   - Built-in retry with exponential backoff for transient 5xx
 *   - Visible in admin → BullMQ board if we ever wire one up
 *   - Same shape as the other 7 workers in this codebase, so on-call
 *     muscle memory carries over
 */

import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import {
  PlaidDailySyncJobData,
  PlaidDailySyncJobResult,
} from "./queue";
import { syncAllActiveLinkedAccounts } from "./services/plaidSyncService";
import { notifyOwner } from "./_core/notification";
import { plaidIsConfigured } from "./_core/plaid";

export const plaidSyncWorker = new Worker<
  PlaidDailySyncJobData,
  PlaidDailySyncJobResult
>(
  "plaid-daily-sync",
  async (job: Job<PlaidDailySyncJobData, PlaidDailySyncJobResult>) => {
    console.log(
      `[plaidSyncWorker] Starting sync ${job.id} (triggered by: ${job.data.triggeredBy})`
    );

    // If Plaid isn't configured (sandbox keys missing locally) just
    // succeed with zeros — no point retrying.
    if (!plaidIsConfigured()) {
      console.warn(
        "[plaidSyncWorker] Plaid not configured (PLAID_CLIENT_ID/SECRET missing) — skipping run"
      );
      return {
        totalAccounts: 0,
        totalAdded: 0,
        totalModified: 0,
        totalRemoved: 0,
        failedAccounts: 0,
      };
    }

    try {
      const result = await syncAllActiveLinkedAccounts();
      console.log(
        `[plaidSyncWorker] ✅ Job ${job.id}: accounts=${result.totalAccounts} added=${result.totalAdded} modified=${result.totalModified} removed=${result.totalRemoved} failed=${result.failedAccounts}`
      );

      // Phase 3: auto-classify new transactions in the same job.
      // Caps at 200 to keep the run bounded; if a HISTORICAL_UPDATE
      // dropped 5000 backfill txns, classify the most recent 200
      // now and let tomorrow's run pick up the next 200. The admin
      // can also click "AI 分類" manually for an immediate backfill.
      if (result.totalAdded > 0) {
        try {
          const { classifyUncategorizedBatch } = await import(
            "./services/accountingAgentService"
          );
          const classifyResult = await classifyUncategorizedBatch({
            limit: Math.min(200, result.totalAdded + 50),
          });
          console.log(
            `[plaidSyncWorker] auto-classified: processed=${classifyResult.processed} succeeded=${classifyResult.succeeded} needsReview=${classifyResult.needsReviewCount} byCategory=${JSON.stringify(classifyResult.byCategory)}`
          );
        } catch (classifyErr) {
          console.error(
            "[plaidSyncWorker] auto-classify failed (sync still succeeded):",
            (classifyErr as Error)?.message
          );
        }
      }

      // Alert on any account-level failures so Jeff sees them in his
      // morning digest. We don't fail the whole job because retrying
      // wouldn't help (broken bank login won't fix itself).
      if (result.failedAccounts > 0) {
        const failed = result.perAccount.filter((r) => r.error);
        await notifyOwner({
          title: `⚠️ Plaid 同步部分失敗 (${result.failedAccounts}/${result.totalAccounts})`,
          content:
            `${result.failedAccounts} 個銀行帳戶今天無法同步:\n\n` +
            failed
              .map((r) => `- account ${r.accountId}: ${r.error}`)
              .join("\n") +
            `\n\n通常是 ITEM_LOGIN_REQUIRED — 進 admin → 財務 → 銀行帳戶 重新連線。`,
        });
      }

      return {
        totalAccounts: result.totalAccounts,
        totalAdded: result.totalAdded,
        totalModified: result.totalModified,
        totalRemoved: result.totalRemoved,
        failedAccounts: result.failedAccounts,
      };
    } catch (err) {
      const msg = (err as Error)?.message ?? "unknown";
      console.error(`[plaidSyncWorker] ❌ Job ${job.id} failed:`, msg);
      throw err;
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1,            // single sync at a time; Plaid rate-limits anyway
    lockDuration: 1_200_000,   // 20 minutes
    lockRenewTime: 300_000,    // every 5 minutes
    // Idle Redis polling is fine at default; this queue fires once a day.
  }
);

plaidSyncWorker.on("completed", (job, result) => {
  console.log(
    `[plaidSyncWorker] ✅ Job ${job.id}: +${result.totalAdded} txns across ${result.totalAccounts} accounts`
  );
});

plaidSyncWorker.on("failed", (job, err) => {
  console.error(`[plaidSyncWorker] ❌ Job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[plaidSyncWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

plaidSyncWorker.on("error", (err) => {
  console.error("[plaidSyncWorker] worker error:", err);
});

console.log("✅ Plaid sync worker initialized");
