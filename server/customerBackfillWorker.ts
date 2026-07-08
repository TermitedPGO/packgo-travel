/**
 * customerBackfillWorker — customer-cockpit Step 2 (auto-collect).
 *
 * When the Gmail pipeline first creates a profile for a brand-new sender, it
 * enqueues a one-off job here. This worker pulls that customer's ENTIRE Gmail
 * history into customerInteractions, across every connected mailbox, so the
 * cockpit (truth strip + conversation) has the full picture without Jeff ever
 * typing「收」.
 *
 * Pure 搬運: reuses backfillCustomerByEmail (claim-or-insert + RFC822 dedup +
 * scrubPii), which is idempotent — a retry or accidental double-run inserts
 * nothing twice. It deliberately does NOT bump lastInteractionAt (this is
 * HISTORICAL mail; marking "active now" would be wrong and would burn the AI
 * summary scan). It NEVER sends anything to the customer — pure read + file.
 */
import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { redisBullMQ } from "./redis";
import { getDb } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { buildGmailClient } from "./_core/gmail";
import { backfillCustomerByEmail } from "./_core/customerBackfill";
import type { CustomerBackfillJobData, CustomerBackfillJobResult } from "./queue";
import { wireWorkerFunnel } from "./_core/errorFunnel";

export const customerBackfillWorker = new Worker<
  CustomerBackfillJobData,
  CustomerBackfillJobResult
>(
  "customer-backfill",
  async (job: Job<CustomerBackfillJobData, CustomerBackfillJobResult>) => {
    const { profileId, email } = job.data;
    const db = await getDb();
    if (!db) return { threadsSeen: 0, inserted: 0, claimed: 0, restamped: 0, skipped: 0 };

    const integrations = await db
      .select()
      .from(gmailIntegration)
      .where(eq(gmailIntegration.isActive, 1));

    const totals = { threadsSeen: 0, inserted: 0, claimed: 0, restamped: 0, skipped: 0 };
    for (const integ of integrations) {
      try {
        const r = await backfillCustomerByEmail(
          db,
          buildGmailClient(integ),
          integ.emailAddress,
          profileId,
          email,
        );
        totals.threadsSeen += r.threadsSeen;
        totals.inserted += r.inserted;
        totals.claimed += r.claimed;
        totals.restamped += r.restamped;
        totals.skipped += r.skipped;
      } catch (e) {
        console.error(
          `[CustomerBackfillWorker] mailbox ${integ.emailAddress} failed for ${email}:`,
          e,
        );
      }
    }
    console.log(
      `[CustomerBackfillWorker] auto-collected ${email} (profile ${profileId}): ` +
        `threads=${totals.threadsSeen} inserted=${totals.inserted} claimed=${totals.claimed} ` +
        `restamped=${totals.restamped} skipped=${totals.skipped}`,
    );
    return totals;
  },
  { connection: redisBullMQ, concurrency: 1 },
);

customerBackfillWorker.on("failed", (job, err) => {
  console.error(`[CustomerBackfillWorker] job ${job?.id} failed:`, err);
});

wireWorkerFunnel(customerBackfillWorker, "customer-backfill");

console.log("✅ Customer backfill worker initialized");
