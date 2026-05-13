/**
 * plaidRouter — tRPC procedures for PACK&GO LLC bookkeeping (Phase 1.3).
 *
 * Mounted at `plaid.*` in the main router. Kept separate from the existing
 * accountingRouter (which handles manual accountingEntries) so the two
 * data sources don't entangle.
 *
 * Flow:
 *   1. Admin clicks "Connect bank" in 財務 → 銀行帳戶
 *   2. Frontend calls plaid.createLinkToken → opens Plaid Link popup
 *   3. On Link onSuccess, frontend calls plaid.exchangePublicToken with
 *      the public_token. Server exchanges + persists encrypted access_token
 *      + runs an initial /transactions/sync to populate bankTransactions.
 *   4. Daily BullMQ worker (Phase 1.5) calls plaid.syncNow for each item,
 *      or admin can trigger manually.
 *   5. Admin reviews transactions in the UI, can override category, link to
 *      a booking, or exclude from accounting.
 *
 * Security:
 *   - All procedures are adminProcedure — only Jeff (role='admin') can read
 *     bank data. tRPC middleware also rate-limits admin mutations to
 *     60/min (commit 5704a81).
 *   - access_token is AES-256-GCM encrypted at rest. Decryption only
 *     happens server-side when making Plaid API calls; never returned to
 *     the client.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createLinkToken,
  exchangePublicToken,
  listAccounts,
  getInstitutionByItem,
  removeItem,
  encryptAccessToken,
  decryptAccessToken,
  plaidIsConfigured,
} from "../_core/plaid";
import { getDb } from "../db";
import {
  linkedBankAccounts,
  bankTransactions,
} from "../../drizzle/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { syncOneLinkedAccount } from "../services/plaidSyncService";

// ─── Helpers ───────────────────────────────────────────────────────────────

function requirePlaid() {
  if (!plaidIsConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Plaid not configured. Set PLAID_CLIENT_ID + PLAID_SECRET as Fly secrets.",
    });
  }
}

// NB: the old local syncOneAccount() and upsertTransactions() helpers were
// removed in the Phase 1.5 dedup pass — both call sites (exchangePublicToken
// initial sync + syncNow manual mutation) now funnel through the shared
// plaidSyncService.syncOneLinkedAccount(). Same field handling, same
// idempotency guarantees, one place to fix bugs.

// ─── Router ────────────────────────────────────────────────────────────────

export const plaidRouter = router({
  /**
   * Mint a Plaid Link token. Frontend opens the OAuth popup with this token.
   * Token is short-lived (~4 hours). Caller should fetch fresh each time.
   */
  createLinkToken: adminProcedure.mutation(async ({ ctx }) => {
    requirePlaid();
    try {
      const result = await createLinkToken(ctx.user.id);
      return result; // { linkToken, hostedLinkUrl, expiration }
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Failed to create Plaid link token: " +
          ((err as Error)?.message ?? "unknown"),
      });
    }
  }),

  /**
   * Exchange a public_token (from Plaid Link onSuccess) for a long-lived
   * access_token, then enumerate accounts under the new Item and persist
   * one row per account. Returns the inserted linkedBankAccount IDs.
   *
   * Caller (frontend) should follow up with markTrustAccount for the
   * account that's the CST trust account.
   */
  exchangePublicToken: adminProcedure
    .input(
      z.object({
        publicToken: z.string().min(1).max(512),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requirePlaid();
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable",
        });
      }

      const { accessToken, itemId } = await exchangePublicToken(
        input.publicToken
      );
      const encrypted = encryptAccessToken(accessToken);

      const [accountsRes, institution] = await Promise.all([
        listAccounts(accessToken),
        getInstitutionByItem(accessToken),
      ]);

      const insertedIds: number[] = [];
      for (const a of accountsRes.accounts) {
        const t = a.type as "depository" | "credit" | "loan" | "investment" | "other";
        try {
          const ins = await db.insert(linkedBankAccounts).values({
            userId: ctx.user.id,
            plaidItemId: itemId,
            plaidAccountId: a.account_id,
            plaidAccessTokenEncrypted: encrypted,
            plaidInstitutionId: institution?.institution_id ?? null,
            institutionName:
              institution?.name ?? a.name?.slice(0, 128) ?? "Bank",
            institutionLogoUrl: institution?.logo
              ? `data:image/png;base64,${institution.logo}`
              : null,
            accountMask: a.mask ?? null,
            accountName: (a.name ?? "Account").slice(0, 128),
            accountOfficialName: a.official_name?.slice(0, 256) ?? null,
            accountType: t,
            accountSubtype: a.subtype ? String(a.subtype).slice(0, 32) : null,
            currentBalance:
              a.balances.current != null ? String(a.balances.current) : null,
            availableBalance:
              a.balances.available != null
                ? String(a.balances.available)
                : null,
            isoCurrencyCode: a.balances.iso_currency_code ?? "USD",
          });
          insertedIds.push(Number((ins as any)[0]?.insertId ?? 0));
        } catch (err) {
          console.warn(
            `[plaid] insert linkedBankAccount for ${a.account_id} failed:`,
            (err as Error)?.message
          );
        }
      }

      // Initial sync — pull all historical transactions Plaid has cached
      // for this item. Plaid's /transactions/sync starts from "first ever"
      // when cursor is null, which is what we want.
      //
      // Phase 1.5 dedup: delegated to plaidSyncService.syncOneLinkedAccount,
      // which catches its own errors and writes lastSyncError to the row.
      // No need for a try/catch wrapper here.
      for (const id of insertedIds) {
        const [row] = await db
          .select()
          .from(linkedBankAccounts)
          .where(eq(linkedBankAccounts.id, id))
          .limit(1);
        if (row) {
          const result = await syncOneLinkedAccount({
            id: row.id,
            plaidAccountId: row.plaidAccountId,
            plaidAccessTokenEncrypted: row.plaidAccessTokenEncrypted,
            cursor: row.cursor,
          });
          if (result.error) {
            console.warn(
              `[plaid] Initial sync for account ${id} failed:`,
              result.error
            );
          } else {
            console.log(
              `[plaid] Initial sync for account ${id}: added=${result.added} modified=${result.modified} removed=${result.removed}`
            );
          }
        }
      }

      return {
        itemId,
        linkedAccountIds: insertedIds,
        accountCount: insertedIds.length,
      };
    }),

  /**
   * List all linked bank accounts for the current admin. Excludes
   * plaidAccessTokenEncrypted from output (sensitive).
   */
  linkedAccountsList: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        id: linkedBankAccounts.id,
        plaidItemId: linkedBankAccounts.plaidItemId,
        plaidAccountId: linkedBankAccounts.plaidAccountId,
        institutionName: linkedBankAccounts.institutionName,
        institutionLogoUrl: linkedBankAccounts.institutionLogoUrl,
        accountMask: linkedBankAccounts.accountMask,
        accountName: linkedBankAccounts.accountName,
        accountType: linkedBankAccounts.accountType,
        accountSubtype: linkedBankAccounts.accountSubtype,
        isTrustAccount: linkedBankAccounts.isTrustAccount,
        isActive: linkedBankAccounts.isActive,
        currentBalance: linkedBankAccounts.currentBalance,
        availableBalance: linkedBankAccounts.availableBalance,
        isoCurrencyCode: linkedBankAccounts.isoCurrencyCode,
        lastSyncedAt: linkedBankAccounts.lastSyncedAt,
        lastSyncError: linkedBankAccounts.lastSyncError,
        createdAt: linkedBankAccounts.createdAt,
      })
      .from(linkedBankAccounts)
      .where(eq(linkedBankAccounts.userId, ctx.user.id))
      .orderBy(desc(linkedBankAccounts.createdAt));
    return rows;
  }),

  /**
   * Flag (or unflag) an account as the CST trust account. The Trust account
   * logic in Phase 4 uses this to delay income recognition until tour
   * departure date.
   */
  markTrustAccount: adminProcedure
    .input(
      z.object({
        linkedAccountId: z.number().int().positive(),
        isTrust: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db
        .update(linkedBankAccounts)
        .set({ isTrustAccount: input.isTrust ? 1 : 0 })
        .where(
          and(
            eq(linkedBankAccounts.id, input.linkedAccountId),
            eq(linkedBankAccounts.userId, ctx.user.id)
          )
        );
      return { success: true };
    }),

  /**
   * Manually trigger sync for one or all linked accounts. Used by:
   *   - the daily BullMQ worker (Phase 1.5)
   *   - the admin "重新整理" button
   *   - sandbox / dev debugging
   */
  syncNow: adminProcedure
    .input(
      z
        .object({
          linkedAccountId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      requirePlaid();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const filters = [
        eq(linkedBankAccounts.userId, ctx.user.id),
        eq(linkedBankAccounts.isActive, 1),
      ];
      if (input?.linkedAccountId) {
        filters.push(eq(linkedBankAccounts.id, input.linkedAccountId));
      }

      const accounts = await db
        .select()
        .from(linkedBankAccounts)
        .where(and(...filters));

      const results: Array<{
        linkedAccountId: number;
        added: number;
        modified: number;
        removed: number;
        error?: string;
      }> = [];

      for (const acc of accounts) {
        // Phase 1.5 dedup: syncOneLinkedAccount catches its own errors,
        // persists lastSyncError, and returns result.error. No try/catch
        // needed here.
        const r = await syncOneLinkedAccount({
          id: acc.id,
          plaidAccountId: acc.plaidAccountId,
          plaidAccessTokenEncrypted: acc.plaidAccessTokenEncrypted,
          cursor: acc.cursor,
        });
        results.push({
          linkedAccountId: acc.id,
          added: r.added,
          modified: r.modified,
          removed: r.removed,
          ...(r.error ? { error: r.error } : {}),
        });
      }
      return { results };
    }),

  /**
   * Disconnect an account: call Plaid /item/remove to invalidate the
   * access_token on Plaid's side, then mark our row inactive (soft delete).
   * Transactions are kept for historical reporting.
   */
  removeLinkedAccount: adminProcedure
    .input(z.object({ linkedAccountId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [acc] = await db
        .select()
        .from(linkedBankAccounts)
        .where(
          and(
            eq(linkedBankAccounts.id, input.linkedAccountId),
            eq(linkedBankAccounts.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!acc) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      try {
        const token = decryptAccessToken(acc.plaidAccessTokenEncrypted);
        await removeItem(token);
      } catch (err) {
        console.warn(
          `[plaid] removeItem failed for ${input.linkedAccountId}:`,
          (err as Error)?.message
        );
        // Continue with soft-delete even if Plaid-side fails
      }
      await db
        .update(linkedBankAccounts)
        .set({ isActive: 0, plaidAccessTokenEncrypted: "" })
        .where(eq(linkedBankAccounts.id, input.linkedAccountId));
      return { success: true };
    }),

  /**
   * List bank transactions with filters + pagination. Default sort is
   * date desc. Limit caps at 200 per page for sanity.
   */
  transactionsList: adminProcedure
    .input(
      z
        .object({
          linkedAccountId: z.number().int().positive().optional(),
          categoryAgent: z.string().max(64).optional(),
          dateFrom: z.string().optional(), // ISO date
          dateTo: z.string().optional(),
          includeExcluded: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      // Only return transactions belonging to accounts owned by this admin
      const userAccountIds = await db
        .select({ id: linkedBankAccounts.id })
        .from(linkedBankAccounts)
        .where(eq(linkedBankAccounts.userId, ctx.user.id));
      const ownedIds = userAccountIds.map((r) => r.id);
      if (ownedIds.length === 0) return { items: [], total: 0 };

      const filters: any[] = [inArray(bankTransactions.linkedAccountId, ownedIds)];
      if (input?.linkedAccountId)
        filters.push(eq(bankTransactions.linkedAccountId, input.linkedAccountId));
      if (input?.categoryAgent)
        filters.push(eq(bankTransactions.agentCategory, input.categoryAgent));
      if (input?.dateFrom)
        filters.push(gte(bankTransactions.date, input.dateFrom as any));
      if (input?.dateTo)
        filters.push(lte(bankTransactions.date, input.dateTo as any));
      if (!input?.includeExcluded)
        filters.push(eq(bankTransactions.excludeFromAccounting, 0));

      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const items = await db
        .select()
        .from(bankTransactions)
        .where(and(...filters))
        .orderBy(desc(bankTransactions.date), desc(bankTransactions.id))
        .limit(limit)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(bankTransactions)
        .where(and(...filters));

      return { items, total: Number(count ?? 0) };
    }),

  /**
   * Manually override a transaction. Used when the AccountingAgent
   * categorized something wrong, or when Jeff wants to:
   *   - exclude personal items
   *   - link a transaction to a booking (e.g. supplier payout to its tour)
   *   - mark recoverable from agent retraining (jeffOverrideReason)
   */
  transactionUpdate: adminProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        category: z.string().max(64).optional(),
        reason: z.string().max(2000).optional(),
        exclude: z.boolean().optional(),
        relatedBookingId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify ownership via the join
      const [row] = await db
        .select({
          id: bankTransactions.id,
          linkedAccountId: bankTransactions.linkedAccountId,
          ownerUserId: linkedBankAccounts.userId,
        })
        .from(bankTransactions)
        .leftJoin(
          linkedBankAccounts,
          eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
        )
        .where(eq(bankTransactions.id, input.transactionId))
        .limit(1);
      if (!row || row.ownerUserId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updates: any = { updatedAt: new Date() };
      if (input.category !== undefined) {
        updates.jeffOverrideCategory = input.category;
      }
      if (input.reason !== undefined) {
        updates.jeffOverrideReason = input.reason;
      }
      if (input.exclude !== undefined) {
        updates.excludeFromAccounting = input.exclude ? 1 : 0;
        if (input.exclude && !input.reason) {
          updates.excludeReason = "manually excluded by admin";
        }
      }
      if (input.relatedBookingId !== undefined) {
        updates.relatedBookingId = input.relatedBookingId;
      }

      await db
        .update(bankTransactions)
        .set(updates)
        .where(eq(bankTransactions.id, input.transactionId));
      return { success: true };
    }),

  // ── Phase 5: P&L from bank transactions ─────────────────────────────────

  /**
   * Build a Schedule-C-aligned P&L for a date range. Reads bankTransactions,
   * sums by jeffOverrideCategory ?? agentCategory, returns income / expenses
   * / gross profit / net profit / needs-review surface.
   *
   * Use cases:
   *   - Admin "本月損益" card on dashboard
   *   - Monthly digest email
   *   - Year-end Schedule C draft input
   */
  profitLossReport: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ ctx, input }) => {
      const { generateBankPL } = await import("../services/bankPLService");
      return await generateBankPL({
        userId: ctx.user.id,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),

  /**
   * Monthly trend (income / COGS / operating / netProfit) for the last
   * N months. Used by the dashboard chart.
   */
  profitLossTrend: adminProcedure
    .input(
      z
        .object({
          months: z.number().int().min(1).max(36).default(12),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { generateBankMonthlyTrend } = await import(
        "../services/bankPLService"
      );
      return await generateBankMonthlyTrend({
        userId: ctx.user.id,
        months: input?.months ?? 12,
      });
    }),

  // ── Phase 6: Year-end export ────────────────────────────────────────────

  /**
   * Generate a ZIP with full year transaction data + Schedule C summary +
   * 1099-NEC ready vendor list. Uploads to R2 and returns the URL.
   * The CPA opens the ZIP; we don't auto-email — admin copies the link
   * into whichever channel they prefer.
   *
   * Year must be the current year or a past year (no future exports).
   */
  yearEndExport: adminProcedure
    .input(
      z.object({
        year: z
          .number()
          .int()
          .min(2020)
          .max(new Date().getFullYear()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { generateYearEndExport } = await import(
        "../services/yearEndExportService"
      );
      return await generateYearEndExport({
        userId: ctx.user.id,
        year: input.year,
      });
    }),

  // ── Phase 3: AccountingAgent ────────────────────────────────────────────
  //
  // Classify uncategorized bank transactions into PACK&GO's 10-category
  // taxonomy. Used by:
  //   - Admin "AI 分類" button on the BankAccountsTab (batch)
  //   - Per-transaction "重新分類" link (single)
  //   - Phase 1.5 plaidSyncWorker after each sync (auto-classify new txns)

  /**
   * Classify a single transaction. Useful when Jeff edits a merchant name
   * and wants the agent to re-evaluate.
   */
  classifyTransaction: adminProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { classifyOne } = await import(
        "../services/accountingAgentService"
      );
      // Verify ownership before classifying — we don't want to burn LLM
      // tokens on a txn from another admin's account.
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db
        .select({ ownerUserId: linkedBankAccounts.userId })
        .from(bankTransactions)
        .leftJoin(
          linkedBankAccounts,
          eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
        )
        .where(eq(bankTransactions.id, input.transactionId))
        .limit(1);
      if (!row || row.ownerUserId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return await classifyOne(input.transactionId);
    }),

  /**
   * Run AccountingAgent on every uncategorized transaction (up to limit).
   * Default 50/run; bumpable to 200 for backfills. Scoped to this admin's
   * accounts only.
   */
  classifyBatch: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const { classifyUncategorizedBatch } = await import(
        "../services/accountingAgentService"
      );
      return await classifyUncategorizedBatch({
        limit: input?.limit ?? 50,
        userId: ctx.user.id,
      });
    }),
});
