/**
 * BullMQ Worker for the weekly 0909 canary (customer-cockpit Phase6 D2,
 * 2026-07-03, 表單版).
 *
 * Drains `weeklyCanaryQueue` and runs `runWeeklyCanary`, which:
 *   1. Does a REAL HTTP POST to this same server's public
 *      /api/trpc/inquiries.create endpoint (0909 test identity, marker text
 *      "[canary] 週檢 <date>") — never imports/calls the router internally.
 *   2. Waits 60s (background worker context, not a request path).
 *   3. Verifies 3 things by querying the DB: a new customerInteractions row
 *      landed on profileId 2760017, jeffhsieh09@gmail.com (the owner) got
 *      ZERO new customerProfiles rows, and profileId 2760017's lastInboundAt
 *      advanced.
 * All 3 pass → log only. Any fail → ONE high-priority agentMessages card.
 * Read-only against customer data except the canary's own form submission +
 * the failure-card insert — zero LLM calls, never emails anyone. See
 * server/_core/weeklyCanary.ts.
 */
import { Worker, Job } from "bullmq";
import { redisBullMQ } from "./redis";
import type { WeeklyCanaryJobData, WeeklyCanaryJobResult } from "./queue";
import { getDb } from "./db";
import { runWeeklyCanary } from "./_core/weeklyCanary";

/** Same loopback convention as index.ts's bot-prerender origin
 *  (http://127.0.0.1:${PORT}) — the canary is the server calling itself over
 *  a real HTTP hop, not an in-process function call. */
function loopbackBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

export const weeklyCanaryWorker = new Worker<WeeklyCanaryJobData, WeeklyCanaryJobResult>(
  "weekly-canary",
  async (job: Job<WeeklyCanaryJobData, WeeklyCanaryJobResult>) => {
    console.log(`[WeeklyCanaryWorker] Starting canary ${job.id} (triggered by: ${job.data.triggeredBy})`);
    const db = await getDb();
    if (!db) return { submitted: false, allPassed: false, failures: [], posted: false };
    const result = await runWeeklyCanary(db, {
      fetchImpl: fetch,
      baseUrl: loopbackBaseUrl(),
    });
    console.log(
      `[WeeklyCanaryWorker] Canary ${job.id}: submitted=${result.submitted} allPassed=${result.allPassed} posted=${result.posted}`,
    );
    return result;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

weeklyCanaryWorker.on("failed", (job, err) => {
  console.error(`[WeeklyCanaryWorker] Job ${job?.id} failed:`, err);
});

console.log("✅ Weekly canary worker initialized");
