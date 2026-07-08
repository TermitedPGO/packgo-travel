/**
 * BullMQ Worker for Tour Monitor jobs
 * 
 * Processes both scheduled (daily 03:00 Taiwan) and manual monitor runs.
 * Each run checks all active tours with sourceUrl for supplier changes.
 */

import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import { TourMonitorJobData, TourMonitorJobResult } from "./queue";
import { runMonitorCycle } from "./services/tourMonitorService";
import { notifyOwner } from "./_core/notification";
import { wireWorkerFunnel } from "./_core/errorFunnel";

export const tourMonitorWorker = new Worker<TourMonitorJobData, TourMonitorJobResult>(
  "tour-monitor",
  async (job: Job<TourMonitorJobData, TourMonitorJobResult>) => {
    console.log(`[TourMonitorWorker] 🔍 Starting monitor job ${job.id} (triggered by: ${job.data.triggeredBy})`);
    
    try {
      const result = await runMonitorCycle();
      
      const jobResult: TourMonitorJobResult = {
        runId: result.runId,
        totalTours: result.totalTours,
        checkedTours: result.checkedTours,
        changedTours: result.changedTours,
        failedTours: result.failedTours,
        changesCount: result.changes.length,
      };
      
      // 行程變動 owner email — removed 2026-06-27 per Jeff (found tour-change
      // notifications pointless). The scan still runs + changes are still logged
      // (visible in the monitor dashboard); only the email stops. The job-failed
      // crash alert below is kept.

      console.log(`[TourMonitorWorker] ✅ Monitor job ${job.id} completed: ${result.checkedTours} checked, ${result.changedTours} changed`);
      return jobResult;
      
    } catch (error) {
      console.error(`[TourMonitorWorker] ❌ Monitor job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1, // Only one monitor run at a time
    lockDuration: 1800000, // 30 minutes lock (monitoring all tours can take a while)
    lockRenewTime: 600000, // Renew every 10 minutes
    drainDelay: 60, // 60 second drain delay (monitoring is not time-critical)
    stalledInterval: 300000, // Check stalled every 5 minutes
  }
);

tourMonitorWorker.on("completed", (job, result) => {
  console.log(`[TourMonitorWorker] ✅ Job ${job.id} completed: ${result.changedTours} changes in ${result.checkedTours} tours`);
});

tourMonitorWorker.on("failed", (job, err) => {
  console.error(`[TourMonitorWorker] ❌ Job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[TourMonitorWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

tourMonitorWorker.on("error", (err) => {
  console.error("[TourMonitorWorker] Worker error:", err);
});

wireWorkerFunnel(tourMonitorWorker, "tour-monitor");

console.log("✅ Tour monitor worker initialized");
