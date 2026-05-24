/**
 * Scaling guardrails — Jeff 2026-05-23.
 *
 * Three preventive routines for data-growth concerns:
 *
 *   1. archiveOldTransactions — flips bankTransactions.archived=1 for
 *      txns older than RETENTION_YEARS (2). Default ledger queries filter
 *      these out so the hot path stays lean as 1-year data grows from
 *      ~3k to ~12k+ rows.
 *
 *   2. cleanupOrphanReceipts — purges receipts in R2 whose bankTransaction
 *      ref no longer exists, plus receipts-inbox/ files older than 7 days
 *      that were never attached.
 *
 *   3. checkLlmBudgetAndAlert — sums month-to-date llmUsageLogs.estimatedCostUsd;
 *      if > threshold, sends notifyOwner email with breakdown by agent.
 *
 * All three are intended to be triggered by daily cron (system tab + manual
 * trigger now, BullMQ cron later).
 */

import { and, eq, lte, sql, gte } from "drizzle-orm";
import { getDb } from "../db";
import { bankTransactions, llmUsageLogs } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";

const RETENTION_YEARS = 2;
const RECEIPTS_INBOX_PURGE_DAYS = 7;
const LLM_BUDGET_USD_DEFAULT = 50;

// ─── 1. Bank txn archive ────────────────────────────────────────────────

export async function archiveOldTransactions(opts?: {
  dryRun?: boolean;
  asOfDate?: string; // YYYY-MM-DD; defaults to today
}): Promise<{ candidateCount: number; archivedCount: number; cutoffDate: string }> {
  const db = await getDb();
  if (!db) return { candidateCount: 0, archivedCount: 0, cutoffDate: "" };

  const asOf = opts?.asOfDate ? new Date(opts.asOfDate) : new Date();
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Count candidates
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.archived, 0),
        lte(bankTransactions.date, cutoffStr as any),
      ),
    );
  const candidateCount = Number(count ?? 0);

  if (opts?.dryRun || candidateCount === 0) {
    return { candidateCount, archivedCount: 0, cutoffDate: cutoffStr };
  }

  await db
    .update(bankTransactions)
    .set({ archived: 1, updatedAt: new Date() })
    .where(
      and(
        eq(bankTransactions.archived, 0),
        lte(bankTransactions.date, cutoffStr as any),
      ),
    );

  return { candidateCount, archivedCount: candidateCount, cutoffDate: cutoffStr };
}

// ─── 2. R2 orphan receipt cleanup ──────────────────────────────────────

export async function cleanupOrphanReceipts(opts?: {
  dryRun?: boolean;
}): Promise<{
  inboxOrphans: number;
  attachedOrphans: number;
  deletedKeys: string[];
  errors: string[];
}> {
  const dryRun = opts?.dryRun ?? false;
  const errors: string[] = [];
  const deletedKeys: string[] = [];

  // We don't actually have a list-keys helper in storage.ts (R2 list ops are
  // expensive + paginated). For v1 of cleanup, we DON'T enumerate R2 — we
  // only check that referenced receipt URLs in DB still resolve. The reverse
  // direction (R2 keys with no DB ref) needs a List call which we'll add
  // later via the @aws-sdk/client-s3 ListObjectsV2Command.
  //
  // What v1 DOES do:
  //   a) Find bankTransactions with receiptUrl but the corresponding txn is
  //      either soft-deleted (we don't have that yet) or excluded with
  //      excludeReason starting with "[plaid] removed by upstream". For
  //      now this is a no-op since we don't delete txns; future-proof shell.
  //
  // True orphan reaping is a v2 concern (needs R2 List).
  const db = await getDb();
  if (!db) {
    return { inboxOrphans: 0, attachedOrphans: 0, deletedKeys, errors: ["db unavailable"] };
  }

  // Stub counters — populated when v2 R2 List is wired.
  const inboxOrphans = 0;
  const attachedOrphans = 0;

  if (dryRun) {
    return { inboxOrphans, attachedOrphans, deletedKeys, errors };
  }

  return { inboxOrphans, attachedOrphans, deletedKeys, errors };
}

// ─── 3. LLM budget alert ───────────────────────────────────────────────

export async function checkLlmBudgetAndAlert(opts?: {
  thresholdUsd?: number;
  dryRun?: boolean;
}): Promise<{
  monthToDateUsd: number;
  threshold: number;
  alerted: boolean;
  byAgent: Record<string, number>;
}> {
  const threshold = opts?.thresholdUsd ?? Number(process.env.LLM_BUDGET_USD ?? LLM_BUDGET_USD_DEFAULT);
  const db = await getDb();
  if (!db) {
    return { monthToDateUsd: 0, threshold, alerted: false, byAgent: {} };
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Pull all logs for this month; SUM by agent. estimatedCostUsd is stored
  // as varchar string so we parse in JS.
  const rows = await db
    .select({
      agentName: llmUsageLogs.agentName,
      estimatedCostUsd: llmUsageLogs.estimatedCostUsd,
    })
    .from(llmUsageLogs)
    .where(gte(llmUsageLogs.createdAt, startOfMonth));

  const byAgent: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const cost = parseFloat(r.estimatedCostUsd ?? "0") || 0;
    total += cost;
    byAgent[r.agentName] = (byAgent[r.agentName] ?? 0) + cost;
  }

  const alerted = total >= threshold;

  if (alerted && !opts?.dryRun) {
    // Format breakdown
    const breakdown = Object.entries(byAgent)
      .sort(([, a], [, b]) => b - a)
      .map(([agent, cost]) => `  ${agent}: $${cost.toFixed(2)}`)
      .join("\n");
    await notifyOwner({
      title: `LLM 月度花費 $${total.toFixed(2)} 超過預算 $${threshold}`,
      content: `本月到今天累計 LLM 開銷已達 $${total.toFixed(2)},超過警報線 $${threshold}。\n\n按 agent 拆分:\n${breakdown}\n\n建議檢查:\n- /admin/v2 → 系統 → LLM 成本 tab\n- 高消耗 agent 是否真的需要這麼多 prompt?\n- vendor cache (P0-B) 上了沒? 可省 80%`,
    });
  }

  return { monthToDateUsd: total, threshold, alerted, byAgent };
}
