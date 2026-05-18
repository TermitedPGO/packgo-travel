// Drain ~150 waiting BullMQ tour-generation jobs to save credit
// 2026-05-17 — keep ~50 in queue, remove the rest.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const url = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;
if (!url) {
  console.error("No UPSTASH_REDIS_URL / REDIS_URL set");
  process.exit(1);
}

// Use long command timeout + explicit lazyConnect for stability
const redis = new IORedis(url, {
  maxRetriesPerRequest: null,
  commandTimeout: 60_000,
  enableReadyCheck: false,
});
const tourGen = new Queue("tour-generation", { connection: redis });

const counts = await tourGen.getJobCounts();
console.log("=== Before ===");
console.table(counts);

// drain() removes all waiting + delayed jobs in one Lua script call,
// fast and atomic. Doesn't touch active jobs (those 4 currently being
// processed by worker will finish naturally).
const waitingBefore = counts.waiting || 0;
console.log(`Draining ${waitingBefore} waiting jobs...`);
await tourGen.drain(true); // true = also remove delayed
console.log("✅ drain complete");

const after = await tourGen.getJobCounts();
console.log("\n=== After ===");
console.table(after);

await tourGen.close();
await redis.quit().catch(() => {});
process.exit(0);
