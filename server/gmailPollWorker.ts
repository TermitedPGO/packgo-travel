/**
 * BullMQ Worker for the gmail-poll queue.
 *
 * QA audit 2026-05-11 Phase 9 #1 churn gap: InquiryAgent had the auto-send
 * path wired in gmailPipeline.ts but nothing called runGmailPipeline on a
 * schedule. Customers asked at 10am, Jeff opened admin at 2pm → 4-hour
 * cold reply. This worker fires every 10 minutes (per scheduleGmailPoll)
 * and runs the pipeline for every active gmailIntegration row.
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import { GmailPollJobData, GmailPollJobResult } from "./queue";
import { runGmailPipeline } from "./agents/autonomous/gmailPipeline";
import { getDb } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { handleIntegrationPollError } from "./_core/gmailAuthFailure";

export const gmailPollWorker = new Worker<GmailPollJobData, GmailPollJobResult>(
  "gmail-poll",
  async (job) => {
    const drizzleDb = await getDb();
    if (!drizzleDb) {
      throw new Error("Database not available");
    }

    const activeIntegrations = await drizzleDb
      .select()
      .from(gmailIntegration)
      .where(eq(gmailIntegration.isActive, 1));

    let totalProcessed = 0;
    let totalAutoReplied = 0;
    let totalEscalated = 0;
    let errors = 0;

    for (const integration of activeIntegrations) {
      try {
        const result = await runGmailPipeline(integration.id);
        totalProcessed += result.totalProcessed;
        totalEscalated += result.totalEscalated;
        // PipelineResult doesn't separately count auto-replied; the
        // gmailPipeline writes interactionOutcomes with actionTaken=
        // "auto_replied" when send succeeds, which the dashboard reads
        // directly. We just surface totalFailed + free-text errors here.
        errors += result.totalFailed + result.errors.length;
      } catch (err) {
        errors++;
        // 2026-06-04 — a revoked / expired OAuth grant used to fail here
        // silently every tick (this catch swallowed it, the job still
        // "completed", so the failed-event notifyOwner never fired). Now we
        // detect invalid_grant specifically and alert the owner ONCE per
        // revocation episode (deduped via disconnectReason). isActive is left
        // at 1 on purpose (Jeff's call): keep polling, just stop spamming.
        const outcome = await handleIntegrationPollError(integration, err, {
          markDisconnectReason: async (id, reason) => {
            await drizzleDb
              .update(gmailIntegration)
              .set({ disconnectReason: reason })
              .where(eq(gmailIntegration.id, id));
          },
          notifyOwner,
        });
        if (outcome.revoked) {
          console.error(
            `[GmailPollWorker] integration ${integration.id} (${integration.emailAddress}) ` +
              `Gmail token revoked/expired — ${
                outcome.alerted ? "owner alerted (once)" : "already alerted this episode"
              }; needs re-auth, isActive kept=1`
          );
        } else {
          console.error(
            `[GmailPollWorker] integration ${integration.id} failed:`,
            err
          );
        }
      }
    }

    console.log(
      `[GmailPollWorker] ✅ Tick ${job.id} (${job.data.triggeredBy}): ` +
        `integrations=${activeIntegrations.length} processed=${totalProcessed} ` +
        `auto=${totalAutoReplied} escalated=${totalEscalated} errors=${errors}`
    );

    return {
      integrationsScanned: activeIntegrations.length,
      totalProcessed,
      totalAutoReplied,
      totalEscalated,
      errors,
    };
  },
  {
    connection: redisBullMQ,
    concurrency: 1, // gmail polling is rate-limited by Google API; serial is safer
    lockDuration: 600000, // 10 min (a poll cycle can run long if many new threads)
    drainDelay: 30,
  }
);

gmailPollWorker.on("completed", (job, result) => {
  console.log(
    `[GmailPollWorker] Job ${job.id} done: ` +
      `${result.totalProcessed} threads, ${result.totalAutoReplied} auto-replied`
  );
});

gmailPollWorker.on("failed", (job, err) => {
  console.error(`[GmailPollWorker] ❌ Job ${job?.id} failed:`, err.message);
  notifyOwner({
    title: `[GmailPollWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => console.error("[notifyOwner] dispatch failed:", e));
});

console.log("✅ Gmail poll worker initialized");
