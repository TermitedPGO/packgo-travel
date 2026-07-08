/**
 * Monthly priority-rewrite cron.
 *
 * Fires on the 1st of each month at 09:00 UTC (= 01:00 PT = 17:00 Taipei).
 * Picks top-scored shallow tours (poeticContent IS NULL) and pushes them
 * to the existing tour-generation queue for full LLM/imagegen rewrite.
 *
 * Why monthly:
 *   - Jeff tops up $50 of Anthropic credit at the start of each month.
 *   - Each rewrite costs ~$0.20 (full masterAgent pipeline: content
 *     analyzer + color/image prompts + itinerary + cost + notice + hotel
 *     + meal + flight + image gen).
 *   - 225 tours × $0.20 = $45 spend, leaving $5 reserve under the $50 cap.
 *   - With 4057 shallow tours, this covers everything in ~18 months.
 *
 * Scoring (top-down):
 *   +20 featured = 1
 *   +10 PACK&GO core (美國 / 夏威夷 / 中國)
 *   +8  日本 (largest bucket, hot market)
 *   +5  韓國 / 泰國 / 越南 (mainstream Asia)
 *   +3  heroImage filled (visual ready)
 *   +1  reasonable price (TWD 20-100k / USD 500-3k)
 *
 * Worker concurrency = 1 (tour-generation queue), so 225 jobs × ~3 min =
 * ~11 hours of background work. Spreads across day 1-2 of the month.
 *
 * Skip when:
 *   - llmUsageLogs month-to-date spend > BUDGET_CAP (i.e. Jeff hasn't
 *     topped up yet, or a manual run already burned the budget).
 *   - No candidate tours remain (poeticContent populated everywhere).
 */

import { Queue, Worker, type Job } from "bullmq";
import { redisBullMQ } from "../redis";
import { tourGenerationQueue } from "../queue";
import { getDb } from "../db";
import { tours as toursTable, llmUsageLogs } from "../../drizzle/schema";
import { and, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import { createChildLogger } from "../_core/logger";
import { wireWorkerFunnel } from "../_core/errorFunnel";

const log = createChildLogger({ module: "priorityRewriteCron" });

const QUEUE_NAME = "priority-rewrite-cron";
const SCHEDULE_ID = "monthly-priority-rewrite";
const CRON_PATTERN = "0 9 1 * *"; // 1st of each month, 09:00 UTC
const BUDGET_CAP_USD = 45;
const COST_PER_TOUR_USD = 0.2;
const TARGET_TOURS = 225;

interface PriorityRewriteCronJob {
  triggeredBy: "monthly-cron" | "manual";
  /** Override target count (e.g. for manual catch-up runs). */
  limit?: number;
}

interface PriorityRewriteCronResult {
  queued: number;
  skippedByBudget: boolean;
  candidatePool: number;
  monthSpendUsdBefore: string;
  estimatedSpendThisRun: string;
}

export const priorityRewriteCronQueue = new Queue<
  PriorityRewriteCronJob,
  PriorityRewriteCronResult
>(QUEUE_NAME, {
  connection: redisBullMQ,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 600_000 }, // 10min, 20min
    removeOnComplete: { age: 30 * 24 * 3600, count: 50 }, // keep history 30d
    removeOnFail: { age: 30 * 24 * 3600, count: 50 },
  },
});

/**
 * Run the picker logic + push jobs to tour-generation queue.
 * Exported for unit testing and admin manual-trigger procedures.
 */
export async function runPriorityRewriteCron(
  triggeredBy: "monthly-cron" | "manual" = "manual",
  override?: { limit?: number },
): Promise<PriorityRewriteCronResult> {
  const db2 = await getDb();
  if (!db2) {
    throw new Error("[priorityRewriteCron] DB not initialized");
  }

  // 1. Budget check
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [costRow] = await db2
    .select({
      total: sql<string>`SUM(CAST(${llmUsageLogs.estimatedCostUsd} AS DECIMAL(20,6)))`,
    })
    .from(llmUsageLogs)
    .where(gte(llmUsageLogs.createdAt, monthStart));
  const monthSpendUsd = parseFloat(costRow?.total ?? "0");
  const budgetRemaining = BUDGET_CAP_USD - monthSpendUsd;
  const maxByBudget = Math.max(0, Math.floor(budgetRemaining / COST_PER_TOUR_USD));
  const targetLimit = Math.min(override?.limit ?? TARGET_TOURS, maxByBudget);

  if (targetLimit <= 0) {
    log.warn(
      { monthSpendUsd, budgetCapUsd: BUDGET_CAP_USD, triggeredBy },
      "[priorityRewriteCron] budget exhausted — skipping",
    );
    return {
      queued: 0,
      skippedByBudget: true,
      candidatePool: 0,
      monthSpendUsdBefore: monthSpendUsd.toFixed(2),
      estimatedSpendThisRun: "0.00",
    };
  }

  // 2. Fetch candidates — shallow supplier tours that haven't been LLM-rewritten
  const candidates = await db2
    .select({
      id: toursTable.id,
      title: toursTable.title,
      destinationCountry: toursTable.destinationCountry,
      price: toursTable.price,
      priceCurrency: toursTable.priceCurrency,
      heroImage: toursTable.heroImage,
      featured: toursTable.featured,
      sourceUrl: toursTable.sourceUrl,
    })
    .from(toursTable)
    .where(
      and(
        eq(toursTable.status, "active"),
        or(
          like(toursTable.sourceUrl, "%liontravel.com%"),
          like(toursTable.sourceUrl, "%uvbookings.com%"),
        ),
        or(
          isNull(toursTable.poeticContent),
          eq(toursTable.poeticContent, ""),
        ),
      ),
    );

  // 3. Score
  const CORE = new Set(["美國", "夏威夷", "中國"]);
  const TIER2 = new Set(["日本"]);
  const TIER3 = new Set(["韓國", "泰國", "越南"]);
  const scored = candidates.map((t) => {
    let score = 0;
    if (t.featured) score += 20;
    const country = t.destinationCountry ?? "";
    if (CORE.has(country)) score += 10;
    else if (TIER2.has(country)) score += 8;
    else if (TIER3.has(country)) score += 5;
    if (t.heroImage) score += 3;
    const price = Number(t.price ?? 0);
    const cur = t.priceCurrency ?? "TWD";
    if (
      (cur === "TWD" && price >= 20000 && price <= 100000) ||
      (cur === "USD" && price >= 500 && price <= 3000)
    )
      score += 1;
    return { ...t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, targetLimit);

  // 4. Push to tour-generation queue
  let queued = 0;
  for (const t of picked) {
    if (!t.sourceUrl) continue;
    const requestId = `monthly_rewrite_${t.id}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    try {
      await tourGenerationQueue.add(
        "generate-tour",
        {
          url: t.sourceUrl,
          userId: 1, // Jeff's admin user
          requestId,
          forceRegenerate: true,
          isPdf: false,
          sourceDraftTourId: t.id,
        },
        { jobId: requestId },
      );
      queued++;
    } catch (err) {
      log.warn(
        { tourId: t.id, err },
        "[priorityRewriteCron] failed to enqueue tour",
      );
    }
  }

  log.info(
    {
      triggeredBy,
      candidatePool: candidates.length,
      queued,
      monthSpendUsd,
      estimatedSpend: queued * COST_PER_TOUR_USD,
    },
    "[priorityRewriteCron] queued priority rewrites",
  );

  return {
    queued,
    skippedByBudget: false,
    candidatePool: candidates.length,
    monthSpendUsdBefore: monthSpendUsd.toFixed(2),
    estimatedSpendThisRun: (queued * COST_PER_TOUR_USD).toFixed(2),
  };
}

/**
 * Register the monthly cron. Called from boot in server/_core/index.ts.
 * Removes any stale repeatable with the same id before adding (idempotent
 * across deploys).
 */
export async function setupMonthlyPriorityRewriteCron(): Promise<void> {
  const schedulers = await priorityRewriteCronQueue.getJobSchedulers();
  for (const s of schedulers) {
    if (s.id === SCHEDULE_ID) {
      await priorityRewriteCronQueue.removeJobScheduler(SCHEDULE_ID);
    }
  }
  await priorityRewriteCronQueue.add(
    SCHEDULE_ID,
    { triggeredBy: "monthly-cron" },
    {
      repeat: { pattern: CRON_PATTERN },
      jobId: SCHEDULE_ID,
    },
  );
  console.log(`✅ Monthly priority rewrite scheduled: ${CRON_PATTERN}`);
}

/**
 * Start the worker that handles the cron tick. Called from boot.
 */
export function startPriorityRewriteCronWorker(): Worker<
  PriorityRewriteCronJob,
  PriorityRewriteCronResult
> {
  const worker = new Worker<PriorityRewriteCronJob, PriorityRewriteCronResult>(
    QUEUE_NAME,
    async (job: Job<PriorityRewriteCronJob>) => {
      log.info(
        { jobId: job.id, triggeredBy: job.data.triggeredBy },
        "[priorityRewriteCron] starting run",
      );
      return runPriorityRewriteCron(job.data.triggeredBy, {
        limit: job.data.limit,
      });
    },
    {
      connection: redisBullMQ,
      concurrency: 1,
    },
  );

  worker.on("completed", (job, result) => {
    log.info(
      { jobId: job.id, result },
      "[priorityRewriteCron] run completed",
    );
  });
  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, err },
      "[priorityRewriteCron] run failed",
    );
  });

  wireWorkerFunnel(worker, QUEUE_NAME);

  console.log("✅ Priority rewrite cron worker initialized");
  return worker;
}
