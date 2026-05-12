/**
 * BullMQ Worker for the trip-reminder cron.
 *
 * v77: drains `tripReminderQueue` jobs, runs the daily scan, returns stats.
 */

import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import { TripReminderJobData, TripReminderJobResult } from "./queue";
import { runTripReminderScan, runPostTripReviewScan, runWinbackScan, runCheckinScan } from "./services/tripReminderService";
import { notifyOwner } from "./_core/notification";

export const tripReminderWorker = new Worker<TripReminderJobData, TripReminderJobResult>(
  "trip-reminder",
  async (job: Job<TripReminderJobData, TripReminderJobResult>) => {
    console.log(`[TripReminderWorker] Starting scan ${job.id} (triggered by: ${job.data.triggeredBy})`);
    try {
      const result = await runTripReminderScan();
      console.log(
        `[TripReminderWorker] Reminder scan ${job.id}: scanned=${result.scanned} queued=${result.emailsQueued} errors=${result.errors} breakdown=${JSON.stringify(result.perWindow)}`
      );

      // v78l Sprint 4C: also run post-trip review scan on same daily cadence
      try {
        const reviewResult = await runPostTripReviewScan();
        console.log(
          `[TripReminderWorker] Post-trip review scan: scanned=${reviewResult.scanned} queued=${reviewResult.emailsQueued} errors=${reviewResult.errors}`
        );
      } catch (reviewErr) {
        console.error(`[TripReminderWorker] Post-trip review scan failed:`, reviewErr);
      }

      // QA audit 2026-05-11 Phase 9 fix: 30-day winback. Same daily cadence
      // since the entire pipeline already runs once at 09:00 Taipei; the
      // returnDate-based scan key makes this idempotent across runs.
      try {
        const winbackResult = await runWinbackScan();
        console.log(
          `[TripReminderWorker] 30-day winback scan: scanned=${winbackResult.scanned} queued=${winbackResult.emailsQueued} errors=${winbackResult.errors}`
        );
      } catch (winbackErr) {
        console.error(`[TripReminderWorker] Winback scan failed:`, winbackErr);
      }

      // QA audit Phase 9 step ⑦: 90-day check-in. Final scheduled
      // touchpoint in the customer journey — low-pressure referral cue.
      try {
        const checkinResult = await runCheckinScan();
        console.log(
          `[TripReminderWorker] 90-day check-in scan: scanned=${checkinResult.scanned} queued=${checkinResult.emailsQueued} errors=${checkinResult.errors}`
        );
      } catch (checkinErr) {
        console.error(`[TripReminderWorker] Check-in scan failed:`, checkinErr);
      }

      // v78m Sprint 5A: daily ops digest email to owner
      try {
        const { runDailyDigestJob } = await import("./services/dailyDigestService");
        const digestResult = await runDailyDigestJob();
        console.log(
          `[TripReminderWorker] Daily digest: sent=${digestResult.sent} actions=${
            digestResult.data
              ? digestResult.data.pendingWechat.length +
                digestResult.data.newQuotesToFollowUp.length +
                digestResult.data.newInquiries
              : 0
          }`
        );
      } catch (digestErr) {
        console.error(`[TripReminderWorker] Daily digest failed:`, digestErr);
      }

      return result;
    } catch (error) {
      console.error(`[TripReminderWorker] Scan ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1, // single scan at a time; batch sends sequentially
    lockDuration: 600000, // 10 minutes
    lockRenewTime: 240000, // every 4 minutes
  }
);

tripReminderWorker.on("completed", (job, result) => {
  console.log(`[TripReminderWorker] ✅ Job ${job.id}: ${result.emailsQueued} reminders sent`);
});

tripReminderWorker.on("failed", (job, err) => {
  console.error(`[TripReminderWorker] ❌ Job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[TripReminderWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Trip reminder worker initialized");
