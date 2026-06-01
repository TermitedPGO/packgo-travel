/**
 * Plaid sync service (Phase 1.5).
 *
 * Single source of truth for "given a linkedBankAccount, pull new
 * transactions and upsert them." Used by:
 *   - server/_core/plaidWebhook.ts  → enqueueImmediateSync on webhook
 *   - server/plaidSyncWorker.ts     → nightly catch-up cron
 *   - server/routers/plaidRouter.ts → plaid.syncNow manual trigger
 *
 * Idempotency:
 *   bankTransactions.plaidTransactionId is the unique key. We use
 *   INSERT … ON DUPLICATE KEY UPDATE so re-syncing the same window
 *   never creates duplicates; it just refreshes amount + pending flag.
 *
 * Removed transactions:
 *   Plaid /transactions/sync returns a `removed[]` list when a txn was
 *   reversed (charge declined / refunded mid-sync). We flag those
 *   excludeFromAccounting=1 so they fall out of P&L. We DO NOT delete
 *   them — keeping the row preserves the audit trail.
 *
 * Pagination:
 *   Loop until has_more=false, max 20 pages = ~10,000 txns per sync.
 *   At ~50 txns/page that's two months of dense activity in a single
 *   call. If we ever hit the cap something is very wrong; log warn.
 */

import { getDb } from "../db";
import { linkedBankAccounts, bankTransactions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { syncTransactions, decryptAccessToken } from "../_core/plaid";

const MAX_PAGES_PER_SYNC = 20;

export interface SyncOneResult {
  accountId: number;
  plaidAccountId: string;
  added: number;
  modified: number;
  removed: number;
  pages: number;
  error?: string;
}

/**
 * Sync a single linked account from Plaid using its persisted cursor.
 * Returns counts; mutates linkedBankAccounts.cursor + lastSyncedAt on success
 * or linkedBankAccounts.lastSyncError on failure.
 */
export async function syncOneLinkedAccount(
  acc: {
    id: number;
    plaidAccountId: string;
    plaidAccessTokenEncrypted: string;
    cursor: string | null;
  }
): Promise<SyncOneResult> {
  const db = await getDb();
  if (!db) {
    return {
      accountId: acc.id,
      plaidAccountId: acc.plaidAccountId,
      added: 0,
      modified: 0,
      removed: 0,
      pages: 0,
      error: "db not available",
    };
  }

  let cursor = acc.cursor;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let pages = 0;

  try {
    const token = decryptAccessToken(acc.plaidAccessTokenEncrypted);

    for (let i = 0; i < MAX_PAGES_PER_SYNC; i++) {
      pages++;
      const page = await syncTransactions(token, cursor);

      // ── ADDED ──
      const addedForThisAcc = page.added.filter(
        (t: any) => t.account_id === acc.plaidAccountId
      );
      for (const t of addedForThisAcc) {
        try {
          await db
            .insert(bankTransactions)
            .values({
              linkedAccountId: acc.id,
              plaidTransactionId: t.transaction_id,
              date: t.date as any,
              authorizedDate: (t.authorized_date as any) ?? null,
              amount: String(t.amount),
              isoCurrencyCode: (t.iso_currency_code ?? "USD") as string,
              merchantName:
                t.merchant_name ?? t.name?.slice(0, 256) ?? null,
              description: t.name ?? null,
              // 2026-05-22 — capture Plaid's raw bank-line text + payment_meta
              // so the AccountingAgent can read Jeff's BofA Zelle memo,
              // Bill Pay note, wire reference, check memo, etc. Without this
              // the agent only sees "Zelle payment from JANE DOE" and misses
              // the "PACKAGE TRIP DEPOSIT" that Jeff typed into BofA's UI.
              originalDescription: t.original_description ?? null,
              paymentMeta: t.payment_meta ?? null,
              paymentChannel: t.payment_channel ?? null,
              plaidCategoryPrimary:
                (t.personal_finance_category as any)?.primary ?? null,
              plaidCategoryDetailed:
                (t.personal_finance_category as any)?.detailed ?? null,
              isPending: t.pending ? 1 : 0,
              accountOwner: t.account_owner ?? null,
            })
            .onDuplicateKeyUpdate({
              set: {
                amount: String(t.amount),
                isPending: t.pending ? 1 : 0,
                // 2026-05-22 — backfill memo/notes on re-sync collisions.
                // Lets the "reset cursor + re-sync" backfill route fill in
                // historical rows that pre-date migration 0081.
                originalDescription: t.original_description ?? null,
                paymentMeta: t.payment_meta ?? null,
                updatedAt: new Date(),
              },
            });
          added++;
        } catch (insertErr) {
          // Upsert collisions on retries are expected; log only unexpected
          // errors (NOT_NULL violations etc).
          const msg = (insertErr as Error)?.message ?? "";
          if (!msg.toLowerCase().includes("duplicate")) {
            console.warn(
              `[plaidSync] failed to upsert ${t.transaction_id}:`,
              msg
            );
          }
        }
      }

      // ── MODIFIED ──
      // Use the same upsert path — INSERT ON DUPLICATE KEY UPDATE will
      // refresh the row in place.
      const modifiedForThisAcc = page.modified.filter(
        (t: any) => t.account_id === acc.plaidAccountId
      );
      for (const t of modifiedForThisAcc) {
        try {
          await db
            .insert(bankTransactions)
            .values({
              linkedAccountId: acc.id,
              plaidTransactionId: t.transaction_id,
              date: t.date as any,
              authorizedDate: (t.authorized_date as any) ?? null,
              amount: String(t.amount),
              isoCurrencyCode: (t.iso_currency_code ?? "USD") as string,
              merchantName:
                t.merchant_name ?? t.name?.slice(0, 256) ?? null,
              description: t.name ?? null,
              // 2026-05-22 — capture Plaid's raw bank-line text + payment_meta
              // so the AccountingAgent can read Jeff's BofA Zelle memo,
              // Bill Pay note, wire reference, check memo, etc. Without this
              // the agent only sees "Zelle payment from JANE DOE" and misses
              // the "PACKAGE TRIP DEPOSIT" that Jeff typed into BofA's UI.
              originalDescription: t.original_description ?? null,
              paymentMeta: t.payment_meta ?? null,
              paymentChannel: t.payment_channel ?? null,
              plaidCategoryPrimary:
                (t.personal_finance_category as any)?.primary ?? null,
              plaidCategoryDetailed:
                (t.personal_finance_category as any)?.detailed ?? null,
              isPending: t.pending ? 1 : 0,
              accountOwner: t.account_owner ?? null,
            })
            .onDuplicateKeyUpdate({
              set: {
                amount: String(t.amount),
                isPending: t.pending ? 1 : 0,
                merchantName:
                  t.merchant_name ?? t.name?.slice(0, 256) ?? null,
                description: t.name ?? null,
                originalDescription: t.original_description ?? null,
                paymentMeta: t.payment_meta ?? null,
                updatedAt: new Date(),
              },
            });
          modified++;
        } catch {
          /* expected on retries */
        }
      }

      // ── REMOVED ──
      // Plaid sends back just { transaction_id } objects. Flag them
      // excludeFromAccounting so reports/agent decisions skip them.
      for (const r of page.removed) {
        try {
          await db
            .update(bankTransactions)
            .set({
              excludeFromAccounting: 1,
              excludeReason: "[plaid] removed by upstream",
              updatedAt: new Date(),
            })
            .where(
              eq(bankTransactions.plaidTransactionId, r.transaction_id as string)
            );
          removed++;
        } catch (rmErr) {
          console.warn(
            `[plaidSync] failed to flag removed ${r.transaction_id}:`,
            (rmErr as Error)?.message
          );
        }
      }

      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }

    if (pages >= MAX_PAGES_PER_SYNC) {
      console.warn(
        `[plaidSync] hit MAX_PAGES_PER_SYNC (${MAX_PAGES_PER_SYNC}) for account ${acc.id} — there may be more txns waiting for next sync`
      );
    }

    // Persist cursor + success markers
    await db
      .update(linkedBankAccounts)
      .set({
        cursor,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      })
      .where(eq(linkedBankAccounts.id, acc.id));

    return {
      accountId: acc.id,
      plaidAccountId: acc.plaidAccountId,
      added,
      modified,
      removed,
      pages,
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? "unknown";
    console.error(`[plaidSync] account ${acc.id} sync failed:`, msg);
    await db
      .update(linkedBankAccounts)
      .set({ lastSyncError: msg })
      .where(eq(linkedBankAccounts.id, acc.id));
    return {
      accountId: acc.id,
      plaidAccountId: acc.plaidAccountId,
      added,
      modified,
      removed,
      pages,
      error: msg,
    };
  }
}

/**
 * After a sync pulls new transactions, auto-classify them so Jeff never has
 * to manually press "classify" (his 2026-06-01 ask: new txns should classify
 * themselves). Best-effort — a classify failure must never break the sync.
 */
async function autoClassifyAfterSync(added: number): Promise<void> {
  if (added <= 0) return;
  try {
    const { classifyUncategorizedBatch } = await import(
      "./accountingAgentService"
    );
    // Cap at the count we just added (plus a small buffer for stragglers).
    const res = await classifyUncategorizedBatch({ limit: Math.min(added + 10, 200) });
    console.log(
      `[plaidSync] auto-classified after sync: processed=${res.processed} succeeded=${res.succeeded} needsReview=${res.needsReviewCount}`
    );
  } catch (err) {
    console.warn(
      `[plaidSync] auto-classify after sync failed (non-fatal): ${(err as Error).message}`
    );
  }
}

/**
 * Sync all active linkedBankAccounts. Used by the nightly cron.
 * Errors on individual accounts are caught + logged; the run continues
 * so one broken bank doesn't block the others.
 */
export async function syncAllActiveLinkedAccounts(): Promise<{
  totalAccounts: number;
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  failedAccounts: number;
  perAccount: SyncOneResult[];
}> {
  const db = await getDb();
  if (!db) {
    return {
      totalAccounts: 0,
      totalAdded: 0,
      totalModified: 0,
      totalRemoved: 0,
      failedAccounts: 0,
      perAccount: [],
    };
  }

  const active = await db
    .select()
    .from(linkedBankAccounts)
    .where(eq(linkedBankAccounts.isActive, 1));

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let failedAccounts = 0;
  const perAccount: SyncOneResult[] = [];

  for (const acc of active) {
    const r = await syncOneLinkedAccount(acc);
    perAccount.push(r);
    if (r.error) {
      failedAccounts++;
    } else {
      totalAdded += r.added;
      totalModified += r.modified;
      totalRemoved += r.removed;
    }
  }

  console.log(
    `[plaidSync] daily run done: accounts=${active.length} added=${totalAdded} modified=${totalModified} removed=${totalRemoved} failed=${failedAccounts}`
  );

  await autoClassifyAfterSync(totalAdded);

  return {
    totalAccounts: active.length,
    totalAdded,
    totalModified,
    totalRemoved,
    failedAccounts,
    perAccount,
  };
}

/**
 * Sync every linkedBankAccount under a single Plaid Item (one bank login).
 * Used by webhooks where Plaid tells us "item X has new data."
 */
export async function syncAllAccountsForItem(itemId: string): Promise<{
  itemId: string;
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  failedAccounts: number;
  perAccount: SyncOneResult[];
}> {
  const db = await getDb();
  if (!db) {
    return {
      itemId,
      totalAdded: 0,
      totalModified: 0,
      totalRemoved: 0,
      failedAccounts: 0,
      perAccount: [],
    };
  }

  const accounts = await db
    .select()
    .from(linkedBankAccounts)
    .where(
      and(
        eq(linkedBankAccounts.plaidItemId, itemId),
        eq(linkedBankAccounts.isActive, 1)
      )
    );

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let failedAccounts = 0;
  const perAccount: SyncOneResult[] = [];

  for (const acc of accounts) {
    const r = await syncOneLinkedAccount(acc);
    perAccount.push(r);
    if (r.error) failedAccounts++;
    else {
      totalAdded += r.added;
      totalModified += r.modified;
      totalRemoved += r.removed;
    }
  }

  await autoClassifyAfterSync(totalAdded);

  return {
    itemId,
    totalAdded,
    totalModified,
    totalRemoved,
    failedAccounts,
    perAccount,
  };
}
