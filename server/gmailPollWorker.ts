/**
 * BullMQ Worker for the gmail-poll queue.
 *
 * QA audit 2026-05-11 Phase 9 #1 churn gap: InquiryAgent had the auto-send
 * path wired in gmailPipeline.ts but nothing called runGmailPipeline on a
 * schedule. Customers asked at 10am, Jeff opened admin at 2pm → 4-hour
 * cold reply. This worker fires every 3 minutes (per scheduleGmailPoll)
 * and runs the pipeline for every active gmailIntegration row.
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import { GmailPollJobData, GmailPollJobResult } from "./queue";
import { runGmailPipeline } from "./agents/autonomous/gmailPipeline";
import { runSentMailCapture } from "./_core/sentMailFiling";
import { getDb } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { handleIntegrationPollError } from "./_core/gmailAuthFailure";
import { wireWorkerFunnel, reportFunnelError } from "./_core/errorFunnel";

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
    let totalReceipts = 0;
    let errors = 0;

    for (const integration of activeIntegrations) {
      try {
        const result = await runGmailPipeline(integration.id);
        totalProcessed += result.totalProcessed;
        totalEscalated += result.totalEscalated;
        totalReceipts += result.totalReceipts;
        // PipelineResult doesn't separately count auto-replied; the
        // gmailPipeline writes interactionOutcomes with actionTaken=
        // "auto_replied" when send succeeds, which the dashboard reads
        // directly. We just surface totalFailed + free-text errors here.
        errors += result.totalFailed + result.errors.length;

        // 2026-06-22 — also file OUTBOUND sent-mail attachments + record our
        // side of the thread. Separate lighter pass; isolated so a failure
        // here never fails the inbound tick.
        try {
          const sent = await runSentMailCapture(integration.id);
          if (sent.docsFiled || sent.interactions) {
            console.log(
              `[GmailPollWorker] sent-capture ${integration.emailAddress}: ` +
                `docs=${sent.docsFiled} interactions=${sent.interactions} scanned=${sent.scanned}`
            );
          }
        } catch (e) {
          console.error(
            `[GmailPollWorker] sent-capture ${integration.id} failed (non-fatal):`,
            e
          );
          reportFunnelError({
            source: "fail-open:gmailPollWorker:sentMailCapture",
            err: e,
            context: { integrationId: integration.id },
          }).catch(() => {});
        }
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
        `auto=${totalAutoReplied} escalated=${totalEscalated} receipts=${totalReceipts} errors=${errors}`
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
  }).catch((e) => {
    console.error("[notifyOwner] dispatch failed:", e);
    reportFunnelError({
      source: "fail-open:gmailPollWorker:notifyOwnerOnFailed",
      err: e,
      context: { jobId: job?.id },
    }).catch(() => {});
  });
});

wireWorkerFunnel(gmailPollWorker, "gmail-poll");

console.log("✅ Gmail poll worker initialized");
