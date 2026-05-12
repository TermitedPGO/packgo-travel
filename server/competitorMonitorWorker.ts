/**
 * Competitor Monitor Worker
 * 競品監控 Worker
 *
 * 負責：
 * 1. 從 BullMQ 取得爬蟲任務
 * 2. 呼叫 competitorScraperService 爬取
 * 3. 與上次快照比對，偵測變動
 * 4. 產生告警並寫入 DB
 * 5. 定時排程（repeatable job）
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import { notifyOwner } from "./_core/notification";
import {
  CompetitorMonitorJobData,
  CompetitorMonitorResult,
  addCompetitorMonitorJob,
} from "./queue";
import {
  scrapeLionTravelTour,
  compareDepartures,
  generateAlerts,
  type PreviousDeparture,
} from "./services/competitorScraperService";
import {
  getActiveCompetitorTours,
  getLatestDepartures,
  upsertCompetitorDepartures,
  insertPriceHistory,
  insertCompetitorAlerts,
  updateCompetitorTourScrapeStatus,
} from "./db";

// ── Worker ─────────────────────────────────────────────────────

export const competitorMonitorWorker = new Worker<
  CompetitorMonitorJobData,
  CompetitorMonitorResult
>(
  "competitor-monitor",
  async (job: Job<CompetitorMonitorJobData, CompetitorMonitorResult>) => {
    const { competitorTourId, tourUrl, competitor, triggeredBy } = job.data;
    console.log(
      `🔍 [CompetitorMonitor] Processing job ${job.id}: tour #${competitorTourId} (${triggeredBy})`
    );

    try {
      // Step 1: 爬取競品頁面
      const scrapeResult = await scrapeLionTravelTour(tourUrl);

      if (!scrapeResult.success) {
        // 更新 scrapeStatus 為 error
        await updateCompetitorTourScrapeStatus(competitorTourId, "error", scrapeResult.error);
        return {
          success: false,
          departuresFound: 0,
          alertsGenerated: 0,
          error: scrapeResult.error || "Scrape failed",
        };
      }

      // Step 2: 取得上次快照
      const previousDepartures = await getLatestDepartures(competitorTourId);

      // Step 3: 儲存新的出團資料
      await upsertCompetitorDepartures(competitorTourId, scrapeResult.departures);

      // Step 4: 比對變動
      const prevForCompare: PreviousDeparture[] = previousDepartures.map((d) => ({
        departureDate: d.departureDate,
        adultPrice: d.adultPrice,
        availableSeats: d.availableSeats,
        departureStatus: d.departureStatus,
      }));
      const changes = compareDepartures(prevForCompare, scrapeResult.departures);

      // Step 5: 寫入價格歷史
      for (const dep of scrapeResult.departures) {
        if (dep.adultPrice == null) continue;
        const prev = prevForCompare.find((p) => p.departureDate === dep.departureDate);
        const previousPrice = prev?.adultPrice ?? null;
        const priceChange = previousPrice != null ? dep.adultPrice - previousPrice : null;
        let changeType: "increase" | "decrease" | "new" | "unchanged" = "new";
        if (previousPrice != null) {
          if (priceChange! > 0) changeType = "increase";
          else if (priceChange! < 0) changeType = "decrease";
          else changeType = "unchanged";
        }
        await insertPriceHistory({
          competitorTourId,
          departureDate: dep.departureDate,
          price: dep.adultPrice,
          previousPrice,
          priceChange,
          changeType,
        });
      }

      // Step 6: 產生告警
      let alertsGenerated = 0;
      if (changes.length > 0) {
        const tourTitle = scrapeResult.tourTitle || `Tour #${competitorTourId}`;
        const alertsData = generateAlerts(competitorTourId, tourTitle, changes);
        await insertCompetitorAlerts(alertsData);
        alertsGenerated = alertsData.length;
        console.log(
          `⚠️ [CompetitorMonitor] ${alertsGenerated} alerts generated for tour #${competitorTourId}`
        );
      }

      // Step 7: 更新 scrapeStatus
      await updateCompetitorTourScrapeStatus(competitorTourId, "active");

      console.log(
        `✅ [CompetitorMonitor] Job ${job.id} completed: ${scrapeResult.departures.length} departures, ${alertsGenerated} alerts`
      );

      return {
        success: true,
        departuresFound: scrapeResult.departures.length,
        alertsGenerated,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [CompetitorMonitor] Job ${job.id} failed:`, errMsg);
      await updateCompetitorTourScrapeStatus(competitorTourId, "error", errMsg);
      throw error;
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1, // 一次只爬一個，避免被封鎖
    lockDuration: 120000, // 2 分鐘鎖定
    lockRenewTime: 60000, // 每分鐘更新鎖定
    drainDelay: 30, // 空閒時 30 秒 poll 一次
    stalledInterval: 300000, // 5 分鐘檢查 stalled
  }
);

competitorMonitorWorker.on("completed", (job) => {
  console.log(`✅ Competitor monitor job ${job.id} completed`);
});

competitorMonitorWorker.on("failed", (job, err) => {
  console.error(`❌ Competitor monitor job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[CompetitorMonitorWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

competitorMonitorWorker.on("error", (err) => {
  console.error("❌ Competitor monitor worker error:", err);
});

console.log("✅ Competitor monitor worker initialized");

// ── Scheduler ──────────────────────────────────────────────────

/**
 * 定時排程：每 6 小時觸發一次，掃描所有 active 競品行程並加入 queue
 */
export async function scheduleCompetitorMonitorJobs() {
  try {
    const activeTours = await getActiveCompetitorTours();
    console.log(
      `[CompetitorMonitor] Scheduling ${activeTours.length} active competitor tours`
    );

    for (const tour of activeTours) {
      await addCompetitorMonitorJob({
        competitorTourId: tour.id,
        tourUrl: tour.tourUrl,
        competitor: tour.competitor,
        triggeredBy: "schedule",
      });
      // 每個任務間隔 5-10 秒，避免同時爬取
      await new Promise((resolve) =>
        setTimeout(resolve, 5000 + Math.random() * 5000)
      );
    }

    console.log(`✅ [CompetitorMonitor] ${activeTours.length} jobs scheduled`);
  } catch (error) {
    console.error("[CompetitorMonitor] Scheduling error:", error);
  }
}

export default competitorMonitorWorker;
