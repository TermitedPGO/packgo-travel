/**
 * Scaling guardrails worker — 2026-05-23.
 *
 * Daily cron processor for the scalingGuardrails BullMQ queue. Runs:
 *   1. archiveOldTransactions — flips txns > 2 years old to archived=1
 *   2. checkLlmBudgetAndAlert — emails owner if month-to-date LLM > $50
 *
 * Both idempotent + cheap. Failures retry next day.
 */

import { Worker } from "bullmq";
import { redisBullMQ } from "./redis";
import {
  scalingGuardrailQueue,
  type ScalingGuardrailJobData,
  type ScalingGuardrailJobResult,
} from "./queue";
import {
  archiveOldTransactions,
  checkLlmBudgetAndAlert,
} from "./services/scalingGuardrailsService";
import { createChildLogger } from "./_core/logger";
import { wireWorkerFunnel } from "./_core/errorFunnel";

const log = createChildLogger({ module: "scalingGuardrailWorker" });

const scalingGuardrailWorker = new Worker<ScalingGuardrailJobData, ScalingGuardrailJobResult>(
  "scaling-guardrails",
  async (job) => {
    log.info({ jobId: job.id, trigger: job.data.triggeredBy }, "[scaling] start");

    const archive = await archiveOldTransactions({ dryRun: false });
    log.info(
      { archivedCount: archive.archivedCount, cutoff: archive.cutoffDate },
      "[scaling] archive done",
    );

    const llm = await checkLlmBudgetAndAlert();
    log.info(
      {
        monthToDateUsd: llm.monthToDateUsd,
        threshold: llm.threshold,
        alerted: llm.alerted,
      },
      "[scaling] llm budget check done",
    );

    return {
      archivedCount: archive.archivedCount,
      cutoffDate: archive.cutoffDate,
      llmMonthToDateUsd: llm.monthToDateUsd,
      llmThreshold: llm.threshold,
      llmAlerted: llm.alerted,
    };
  },
  { connection: redisBullMQ, concurrency: 1 },
);

wireWorkerFunnel(scalingGuardrailWorker, "scaling-guardrails");

void scalingGuardrailQueue;
console.log("✅ Scaling guardrail worker initialized");
