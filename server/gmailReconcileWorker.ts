/**
 * gmail-intake-ledger (2026-07-13) — BullMQ worker for the reconciliation
 * tripwire (gmail-reconcile queue, scheduled every 5 min). Iterates ACTIVE
 * integrations and runs the逐-message set-difference + watch health for each
 * NON-legacy mailbox (legacy is skipped inside runReconcileForIntegration, so a
 * pure-legacy deploy does nothing). Best-effort per integration — one failing
 * mailbox never fails the whole tick.
 */
import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import { GmailReconcileJobData, GmailReconcileJobResult } from "./queue";
import { runReconcileForIntegration } from "./services/gmailIntakeAdapters";
import { getDb } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { createChildLogger } from "./_core/logger";
import { wireWorkerFunnel, reportFunnelError } from "./_core/errorFunnel";

const log = createChildLogger({ module: "gmailReconcileWorker" });

export const gmailReconcileWorker = new Worker<
  GmailReconcileJobData,
  GmailReconcileJobResult
>(
  "gmail-reconcile",
  async (job) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const integrations = await db
      .select({ id: gmailIntegration.id, intakeMode: gmailIntegration.intakeMode })
      .from(gmailIntegration)
      .where(eq(gmailIntegration.isActive, 1));

    let reconciled = 0;
    let errors = 0;
    for (const integration of integrations) {
      if (integration.intakeMode === "legacy") continue;
      try {
        const ran = await runReconcileForIntegration(integration.id);
        if (ran) reconciled++;
      } catch (e) {
        errors++;
        log.error(
          { integrationId: integration.id, err: e },
          "[gmailReconcileWorker] reconcile failed (non-fatal)",
        );
        reportFunnelError({
          source: "fail-open:gmailReconcileWorker:reconcile",
          err: e,
          context: { integrationId: integration.id },
        }).catch(() => {});
      }
    }

    log.info(
      { scanned: integrations.length, reconciled, errors, triggeredBy: job.data.triggeredBy },
      "[gmailReconcileWorker] tick done",
    );
    return { scanned: integrations.length, reconciled, errors };
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 300000,
    drainDelay: 30,
  },
);

gmailReconcileWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "[gmailReconcileWorker] job failed");
});

wireWorkerFunnel(gmailReconcileWorker, "gmail-reconcile");

log.info({}, "✅ Gmail reconcile worker initialized");
