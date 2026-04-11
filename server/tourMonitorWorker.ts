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
      
      // Notify owner if there are changes
      if (result.changedTours > 0) {
        const changesSummary = result.changes
          .slice(0, 10) // Limit to first 10 changes in notification
          .map(c => `• ${c.tourTitle}: ${c.summary}`)
          .join('\n');
        
        await notifyOwner({
          title: `🔔 供應商監控：${result.changedTours} 個行程有變動`,
          content: `監控執行時間：${result.completedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n\n` +
            `📊 統計：共檢查 ${result.checkedTours} 個行程，發現 ${result.changedTours} 個有變動，${result.failedTours} 個失敗\n\n` +
            `📋 變動摘要：\n${changesSummary}` +
            (result.changes.length > 10 ? `\n\n...及其他 ${result.changes.length - 10} 個變動` : ''),
        }).catch(err => console.warn('[TourMonitorWorker] Failed to notify owner:', err));
      }
      
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
});

tourMonitorWorker.on("error", (err) => {
  console.error("[TourMonitorWorker] Worker error:", err);
});

console.log("✅ Tour monitor worker initialized");
