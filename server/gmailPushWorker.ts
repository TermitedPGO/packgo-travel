/**
 * gmail-push (2026-06-29) — BullMQ workers for Gmail push (Pub/Sub).
 *
 * Two workers live here:
 *
 *   1. gmail-push        — drains the queue the webhook (POST /api/gmail/push)
 *      enqueues into. Each job = one Pub/Sub notification (integrationId +
 *      notified historyId). The worker does the heavy lifting OFF the HTTP path:
 *      history.list diff → hydrate → ingest (runGmailPipelineForMessageIds). The
 *      webhook itself 204-acks in milliseconds so Pub/Sub never times out and
 *      redelivers (which would create a retry storm). BullMQ collapses bursts:
 *      multiple notifications for the same mailbox just re-run an idempotent
 *      incremental ingest (PACKGO_AI_PROCESSED label dedups per-message).
 *
 *   2. gmail-watch-renew — daily cron (scheduleGmailWatchRenew). Re-arms every
 *      active integration's watch (Gmail watch expires after ~7 days). Stores
 *      the fresh historyId baseline + expiration. Best-effort per integration;
 *      a single revoked grant never fails the whole tick.
 *
 * This is additive to gmailPollWorker.ts (the every-3-min fallback). Neither
 * worker replaces the other.
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import {
  GmailPushJobData,
  GmailPushJobResult,
  GmailWatchRenewJobData,
  GmailWatchRenewJobResult,
} from "./queue";
import { runGmailPipelineForMessageIds } from "./agents/autonomous/gmailPipeline";
import { buildGmailClient, registerGmailWatch } from "./_core/gmail";
import { getDb } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { handleIntegrationPollError } from "./_core/gmailAuthFailure";
import { createChildLogger } from "./_core/logger";
import { wireWorkerFunnel } from "./_core/errorFunnel";

const log = createChildLogger({ module: "gmailPushWorker" });

/** Renew a watch when it expires within this window (ms). Watch lives ~7 days;
 *  we renew daily, so any watch expiring inside ~2 days gets re-armed early —
 *  a single missed cron still leaves margin before push silently stops. */
const RENEW_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────────────────────────────────
// Worker 1 — gmail-push (incremental ingest off a Pub/Sub notification)
// ──────────────────────────────────────────────────────────────────────────
export const gmailPushWorker = new Worker<GmailPushJobData, GmailPushJobResult>(
  "gmail-push",
  async (job) => {
    const { integrationId, notifiedHistoryId } = job.data;

    // gmail-intake-ledger — the webhook already durably enqueued this job BEFORE
    // acking Pub/Sub (先耐久排隊成功才 ack), and the ledger unique key makes a
    // redelivery idempotent. Route by intakeMode: legacy + shadow still run the
    // legacy incremental ingest (shadow keeps it as the 並行對照 net); history is
    // driven by the ledger engine. Default 'legacy' → ZERO change.
    const db = await getDb();
    const [integ] = db
      ? await db
          .select({ intakeMode: gmailIntegration.intakeMode })
          .from(gmailIntegration)
          .where(eq(gmailIntegration.id, integrationId))
          .limit(1)
      : [];
    const mode = integ?.intakeMode ?? "legacy";

    let processed = 0;
    let receipts = 0;
    let errorCount = 0;

    if (mode !== "history") {
      const result = await runGmailPipelineForMessageIds(integrationId, notifiedHistoryId);
      if (!result.ok && result.errors.length) {
        log.warn(
          { integrationId, errors: result.errors.slice(0, 3) },
          "[gmailPushWorker] incremental ingest reported errors",
        );
      }
      processed = result.totalProcessed;
      receipts = result.totalReceipts;
      errorCount = result.totalFailed + result.errors.length;
    }

    if (mode !== "legacy") {
      try {
        const { runIntakeForIntegration } = await import("./services/gmailIntakeAdapters");
        await runIntakeForIntegration(integrationId);
      } catch (e) {
        errorCount++;
        log.warn({ integrationId, err: e }, "[gmailPushWorker] ledger intake failed (non-fatal)");
      }
    }

    return { processed, receipts, errors: errorCount };
  },
  {
    connection: redisBullMQ,
    // Serial per mailbox is safest (Gmail API rate limits + the diff advances a
    // shared baseline); PACK&GO has a single mailbox so concurrency=1 is plenty.
    concurrency: 1,
    lockDuration: 300000, // 5 min
    drainDelay: 5,
  },
);

gmailPushWorker.on("failed", (job, err) => {
  log.error(
    { jobId: job?.id, integrationId: job?.data?.integrationId, err },
    "[gmailPushWorker] push job failed",
  );
});

wireWorkerFunnel(gmailPushWorker, "gmail-push");

// ──────────────────────────────────────────────────────────────────────────
// Worker 2 — gmail-watch-renew (daily re-arm of users.watch)
// ──────────────────────────────────────────────────────────────────────────
export const gmailWatchRenewWorker = new Worker<
  GmailWatchRenewJobData,
  GmailWatchRenewJobResult
>(
  "gmail-watch-renew",
  async (job) => {
    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // No topic configured → push isn't set up yet; renew can't run. The poll
    // keeps working. gmail-intake-ledger (requirement 8): no longer a SILENT
    // return — post a deduped topic-unset alert for each non-legacy integration
    // (legacy mailboxes are unaffected, so they stay quiet). (Runbook step: set
    // GMAIL_PUBSUB_TOPIC, then push activates.)
    if (!topicName) {
      log.info(
        { triggeredBy: job.data.triggeredBy },
        "[gmailWatchRenewWorker] GMAIL_PUBSUB_TOPIC unset — alerting non-legacy integrations (poll still active)",
      );
      try {
        const { alertTopicUnsetForNonLegacy } = await import("./services/gmailIntakeAdapters");
        const posted = await alertTopicUnsetForNonLegacy();
        return { scanned: posted, renewed: 0, errors: 0 };
      } catch (e) {
        log.warn({ err: e }, "[gmailWatchRenewWorker] topic-unset alert failed (non-fatal)");
        return { scanned: 0, renewed: 0, errors: 0 };
      }
    }

    const integrations = await db
      .select()
      .from(gmailIntegration)
      .where(eq(gmailIntegration.isActive, 1));

    const now = Date.now();
    let renewed = 0;
    let errors = 0;

    for (const integration of integrations) {
      // Skip watches that are still comfortably valid (renew only inside window).
      const exp = integration.watchExpiration ?? 0;
      if (exp && exp - now > RENEW_WITHIN_MS) continue;

      try {
        const gmail = buildGmailClient(integration);
        const watch = await registerGmailWatch(gmail, topicName);
        await db
          .update(gmailIntegration)
          .set({
            // Re-baseline lastHistoryId to the watch's historyId so the next
            // push diffs from a fresh, valid point (the prior baseline may now
            // be outside Gmail's retention window).
            lastHistoryId: watch.historyId,
            watchExpiration: watch.expirationMs,
          })
          .where(eq(gmailIntegration.id, integration.id));
        renewed++;
        log.info(
          {
            integrationId: integration.id,
            email: integration.emailAddress,
            expiresAt: new Date(watch.expirationMs).toISOString(),
          },
          "[gmailWatchRenewWorker] watch renewed",
        );
      } catch (err) {
        errors++;
        // Mirror the poll worker: detect a revoked grant + alert once, keep the
        // row active so the poll keeps trying. A bad watch must never wedge.
        const outcome = await handleIntegrationPollError(integration, err, {
          markDisconnectReason: async (id, reason) => {
            await db
              .update(gmailIntegration)
              .set({ disconnectReason: reason })
              .where(eq(gmailIntegration.id, id));
          },
          notifyOwner,
        });
        if (outcome.revoked) {
          log.error(
            {
              integrationId: integration.id,
              email: integration.emailAddress,
              alerted: outcome.alerted,
            },
            "[gmailWatchRenewWorker] watch renew failed — token revoked/expired, needs re-auth",
          );
        } else {
          log.error(
            { integrationId: integration.id, err },
            "[gmailWatchRenewWorker] watch renew failed",
          );
        }
      }
    }

    log.info(
      { scanned: integrations.length, renewed, errors },
      "[gmailWatchRenewWorker] tick done",
    );
    return { scanned: integrations.length, renewed, errors };
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 300000,
    drainDelay: 30,
  },
);

gmailWatchRenewWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "[gmailWatchRenewWorker] job failed");
  notifyOwner({
    title: `[gmailWatchRenewWorker] Job ${job?.id ?? "?"} failed`,
    content: `Error: ${err.message}\n\n${err.stack ?? "(no stack)"}`,
  }).catch((e) => log.error({ err: e }, "[notifyOwner] dispatch failed"));
});

wireWorkerFunnel(gmailWatchRenewWorker, "gmail-watch-renew");

log.info({}, "✅ Gmail push + watch-renew workers initialized");
