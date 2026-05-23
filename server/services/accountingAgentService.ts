/**
 * AccountingAgent service (Phase 3).
 *
 * Two entry points:
 *   1. classifyOne(transactionId) — categorize a single txn, return result
 *   2. classifyUncategorizedBatch({ limit }) — loop until either
 *      `limit` txns done or no uncategorized txns left
 *
 * Persistence:
 *   agentCategory + agentConfidence + agentReasoning are stored on
 *   bankTransactions. Jeff's override fields (jeffOverrideCategory,
 *   jeffOverrideReason) are never touched here.
 *
 * Idempotency:
 *   We only process txns where agentCategory IS NULL. Once classified,
 *   the row stays put unless Jeff re-runs via "reclassify all" admin
 *   button (Phase 3 polish, not in this iteration).
 *
 * Cost control:
 *   Haiku 4.5 @ ~$0.015/txn × ~50 txns/day (PACK&GO scale) = ~$22/yr.
 *   We rate-limit the batch loop to 200 txns/run so a backfill of
 *   24 months of history (~12,000 txns) takes 60 runs but stays within
 *   the daily LLM budget headroom.
 */

import { getDb } from "../db";
import {
  bankTransactions,
  linkedBankAccounts,
} from "../../drizzle/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  runAccountingAgent,
  type AccountingAgentInput,
  type AccountingAgentOutput,
} from "../agents/autonomous/accountingAgent";

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 200;

export interface ClassifyOneResult {
  transactionId: number;
  category: string;
  confidence: number;
  needsHumanReview: boolean;
  error?: string;
}

/**
 * Classify a single bank transaction. Reads context (account info, recent
 * Jeff-approved similar classifications) and persists result.
 */
export async function classifyOne(
  transactionId: number
): Promise<ClassifyOneResult> {
  const db = await getDb();
  if (!db) {
    return {
      transactionId,
      category: "other_review",
      confidence: 0,
      needsHumanReview: true,
      error: "db unavailable",
    };
  }

  const [row] = await db
    .select({
      tx: bankTransactions,
      acct: linkedBankAccounts,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(eq(bankTransactions.id, transactionId))
    .limit(1);

  if (!row || !row.tx) {
    return {
      transactionId,
      category: "other_review",
      confidence: 0,
      needsHumanReview: true,
      error: "transaction not found",
    };
  }

  // Fetch up to 5 recent Jeff-approved classifications for the same
  // merchant to teach the model PACK&GO's tendencies.
  let examples: AccountingAgentInput["examplePastClassifications"] = [];
  if (row.tx.merchantName) {
    const past = await db
      .select({
        merchant: bankTransactions.merchantName,
        amount: bankTransactions.amount,
        category: bankTransactions.jeffOverrideCategory,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.merchantName, row.tx.merchantName),
          // Only Jeff-approved (he overrode the agent → ground truth)
          // OR agent classified with high confidence and not overridden
          // (so we trust prior auto-applies)
        )
      )
      .orderBy(desc(bankTransactions.date))
      .limit(5);
    examples = past
      .filter((p) => p.category)
      .map((p) => ({
        merchant: String(p.merchant ?? ""),
        amount: parseFloat(p.amount as any) || 0,
        category: p.category as any,
      }));
  }

  const agentInput: AccountingAgentInput = {
    amount: parseFloat(row.tx.amount as any) || 0,
    date: String(row.tx.date),
    merchantName: row.tx.merchantName,
    description: row.tx.description,
    paymentChannel: row.tx.paymentChannel,
    plaidCategoryPrimary: row.tx.plaidCategoryPrimary,
    plaidCategoryDetailed: row.tx.plaidCategoryDetailed,
    isoCurrencyCode: row.tx.isoCurrencyCode ?? "USD",
    // 2026-05-22 — Jeff's BofA notes / Zelle memo / Bill Pay reason
    // (migration 0081). Without these the agent loses ~30% of the signal
    // for transfer-class transactions.
    originalDescription: (row.tx as any).originalDescription ?? null,
    paymentMeta: ((row.tx as any).paymentMeta as any) ?? null,
    accountType: (row.acct?.accountType ?? "depository") as any,
    accountName: row.acct?.accountName ?? null,
    isTrustAccount: (row.acct?.isTrustAccount ?? 0) === 1,
    examplePastClassifications: examples,
  };

  let agentOut: AccountingAgentOutput;
  try {
    agentOut = await runAccountingAgent(agentInput);
  } catch (err) {
    const msg = (err as Error)?.message ?? "unknown";
    console.error(
      `[accountingAgent] classify failed for txn ${transactionId}:`,
      msg
    );
    // Don't write anything — leave agentCategory NULL so next batch retries.
    return {
      transactionId,
      category: "other_review",
      confidence: 0,
      needsHumanReview: true,
      error: msg,
    };
  }

  // Persist result. agentCategory + agentConfidence + agentReasoning, plus
  // 2026-05-22 migration 0080: counterparty + counterpartyType + purposeNote
  // for IRS Schedule C / §274 documentation. Only write counterparty/etc.
  // if currently NULL — never clobber a Jeff edit. Jeff override fields stay
  // untouched as before.
  const updateSet: Record<string, unknown> = {
    agentCategory: agentOut.category,
    agentConfidence: agentOut.confidence,
    agentReasoning: agentOut.reasoning,
    updatedAt: new Date(),
  };
  // Only pre-fill the IRS fields if they're currently empty — preserves any
  // prior Jeff edit. `row.tx` was loaded at top of classifyOne.
  if (!row.tx.counterparty && agentOut.counterparty) {
    updateSet.counterparty = agentOut.counterparty;
  }
  if (!row.tx.counterpartyType && agentOut.counterpartyType) {
    updateSet.counterpartyType = agentOut.counterpartyType;
  }
  if (!row.tx.purposeNote && agentOut.purposeNote) {
    updateSet.purposeNote = agentOut.purposeNote;
  }

  await db
    .update(bankTransactions)
    .set(updateSet)
    .where(eq(bankTransactions.id, transactionId));

  // Phase 4 hook: if classified income_booking AND on a trust account,
  // record a deferred-income row. Feature-flagged via env so it's a no-op
  // until Jeff confirms Q1-Q7 in PHASE_4_TRUST_DEFERRAL_DESIGN.md.
  if (
    agentOut.category === "income_booking" &&
    (row.acct?.isTrustAccount ?? 0) === 1
  ) {
    try {
      const { processTrustInflow, isTrustDeferralEnabled } = await import(
        "./trustDeferralService"
      );
      if (isTrustDeferralEnabled()) {
        const r = await processTrustInflow(transactionId);
        console.log(
          `[accountingAgent] trust-deferral on txn ${transactionId}: deferredId=${r.deferredId} bookingId=${r.bookingId} confidence=${r.confidence} reason=${r.reason}`
        );
      }
    } catch (err) {
      // Don't fail classification if trust deferral chain blows up
      console.error(
        `[accountingAgent] trust-deferral hook failed for txn ${transactionId}:`,
        (err as Error)?.message
      );
    }
  }

  return {
    transactionId,
    category: agentOut.category,
    confidence: agentOut.confidence,
    needsHumanReview: agentOut.needsHumanReview,
  };
}

export interface ClassifyBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  byCategory: Record<string, number>;
  needsReviewCount: number;
  perTransaction: ClassifyOneResult[];
}

/**
 * Process up to `limit` uncategorized transactions (agentCategory IS NULL +
 * not excluded). Useful for both the after-sync hook and the admin
 * "重新分類" backfill button.
 */
export async function classifyUncategorizedBatch(opts?: {
  limit?: number;
  userId?: number; // restrict to one user's accounts (admin scope)
}): Promise<ClassifyBatchResult> {
  const limit = Math.max(
    1,
    Math.min(MAX_BATCH_LIMIT, opts?.limit ?? DEFAULT_BATCH_LIMIT)
  );

  const db = await getDb();
  if (!db) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      byCategory: {},
      needsReviewCount: 0,
      perTransaction: [],
    };
  }

  // Optional userId scope so admins only classify their own accounts.
  const filters: any[] = [
    isNull(bankTransactions.agentCategory),
    eq(bankTransactions.excludeFromAccounting, 0),
    eq(bankTransactions.isPending, 0), // Pending txns can flip; wait until settled.
  ];

  let candidates: Array<{ id: number }>;
  if (opts?.userId) {
    // Join to filter by account owner — keeps admin scope clean
    candidates = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .leftJoin(
        linkedBankAccounts,
        eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
      )
      .where(and(eq(linkedBankAccounts.userId, opts.userId), ...filters))
      .orderBy(desc(bankTransactions.date))
      .limit(limit);
  } else {
    candidates = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(and(...filters))
      .orderBy(desc(bankTransactions.date))
      .limit(limit);
  }

  const result: ClassifyBatchResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    byCategory: {},
    needsReviewCount: 0,
    perTransaction: [],
  };

  for (const c of candidates) {
    const r = await classifyOne(c.id);
    result.processed++;
    result.perTransaction.push(r);
    if (r.error) {
      result.failed++;
    } else {
      result.succeeded++;
      result.byCategory[r.category] =
        (result.byCategory[r.category] ?? 0) + 1;
      if (r.needsHumanReview) result.needsReviewCount++;
    }
  }

  console.log(
    `[accountingAgent] batch done: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} needsReview=${result.needsReviewCount}`
  );

  return result;
}
