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
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { syncOneLinkedAccount } from "../services/plaidSyncService";
import { reportFunnelError } from "../_core/errorFunnel";
import { ACCOUNTING_CATEGORIES } from "../agents/autonomous/accountingAgent";

// ── Canonical category validation (M1, 2026-05-28) ────────────────────────
// The 10 categories are owned by accountingAgent.ts. transactionUpdate +
// bulkCategorize used to accept any z.string().max(64), so a UI override of an
// unrecognised label silently fell out of bankPLService's P&L buckets. Lock
// writes to the canonical enum. "" clears an override; "exclude" is the bulk
// sentinel handled before the category write.
const CATEGORY_ENUM = z.enum(
  ACCOUNTING_CATEGORIES as unknown as [string, ...string[]],
);

// One-directional hint for the read-only legacy-override audit. Only obvious
// 1:1 remaps are suggested; genuinely ambiguous old labels (salary,
// tax_payment, other_expense) are intentionally left unmapped — 不準猜. Nothing
// here is auto-applied; Jeff confirms each in the UI.
const LEGACY_CATEGORY_SUGGESTION: Record<string, string> = {
  tour_booking: "income_booking",
  visa_service: "income_booking",
  affiliate_commission: "income_booking",
  flight_booking: "income_booking",
  hotel_booking: "income_booking",
  other_income: "income_booking",
  supplier_payment: "cogs_tour",
  consulate_fee: "cogs_tour",
  stripe_fee: "cogs_other",
  marketing: "expense_marketing",
  software: "expense_software",
  rent: "expense_office",
  utilities: "expense_office",
  office_supplies: "expense_office",
  insurance: "expense_office",
  bank_fee: "expense_office",
  travel_cost: "expense_travel",
};

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

      // Plaid occasionally returns account.type values outside our 5-value
      // enum (e.g. "brokerage", "payroll" from newer Plaid coverage).
      // Bucket unknowns into "other" so the insert doesn't fail.
      const KNOWN_TYPES = new Set([
        "depository",
        "credit",
        "loan",
        "investment",
        "other",
      ]);

      const insertedIds: number[] = [];
      for (const a of accountsRes.accounts) {
        const rawType = String(a.type ?? "other");
        const accountType = (
          KNOWN_TYPES.has(rawType) ? rawType : "other"
        ) as "depository" | "credit" | "loan" | "investment" | "other";
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
            accountType,
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
          const e = err as any;
          console.warn(
            `[plaid] insert linkedBankAccount for ${a.account_id} failed:`,
            `${e?.message} | code=${e?.code ?? e?.cause?.code} | type=${rawType}`
          );
          reportFunnelError({
            source: "fail-open:plaidRouter:insertLinkedBankAccount",
            err,
            context: { plaidAccountId: a.account_id },
          }).catch(() => {});
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
  linkedAccountsList: adminProcedure
    .input(
      z
        .object({ includeInactive: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      // 2026-05-22: previously filtered by ctx.user.id. PACK&GO is
      // single-tenant; the admin role should see every linked account
      // regardless of which admin login linked it. See plaidRouter
      // transactionsList for the same change + rationale.
      //
      // Default: only return isActive=1 accounts. Sandbox cleanup leftovers
      // (24 First Platypus Bank accounts marked inactive 2026-05-14) are
      // hidden unless caller passes includeInactive=true.
      const filters: any[] = [];
      if (!input?.includeInactive) {
        filters.push(eq(linkedBankAccounts.isActive, 1));
      }
      const baseQuery = db
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
        .from(linkedBankAccounts);
      const rows = await (filters.length
        ? baseQuery.where(and(...filters))
        : baseQuery
      ).orderBy(desc(linkedBankAccounts.createdAt));
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
          /**
           * 2026-05-22 — when true, NULL out the stored cursor before
           * calling Plaid's transactionsSync. Plaid then re-sends every
           * historical transaction (up to the Item's 24-month window),
           * each one upserted via onDuplicateKeyUpdate. Used to backfill
           * paymentMeta / originalDescription on rows that pre-date
           * migration 0081 (Jeff: "Agent 讀 BofA notes").
           *
           * Cost: bigger Plaid response (~1-3min for 500-2000 txns), no
           * additional money charge — Plaid invoices on monthly active
           * Items not on transaction count.
           */
          backfill: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      requirePlaid();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 2026-05-22 — drop userId scope (single-tenant). All active accounts
      // are eligible for syncs regardless of which admin logged in.
      const filters = [eq(linkedBankAccounts.isActive, 1)];
      if (input?.linkedAccountId) {
        filters.push(eq(linkedBankAccounts.id, input.linkedAccountId));
      }

      const accounts = await db
        .select()
        .from(linkedBankAccounts)
        .where(and(...filters));

      // backfill path — reset cursor to NULL first so Plaid re-streams
      // every transaction. Each one upserts via onDuplicateKeyUpdate
      // which now writes originalDescription + paymentMeta.
      if (input?.backfill) {
        for (const acc of accounts) {
          await db
            .update(linkedBankAccounts)
            .set({ cursor: null, updatedAt: new Date() })
            .where(eq(linkedBankAccounts.id, acc.id));
        }
      }

      const results: Array<{
        linkedAccountId: number;
        added: number;
        modified: number;
        removed: number;
        error?: string;
      }> = [];

      for (const acc of accounts) {
        const r = await syncOneLinkedAccount({
          id: acc.id,
          plaidAccountId: acc.plaidAccountId,
          plaidAccessTokenEncrypted: acc.plaidAccessTokenEncrypted,
          // After backfill flag, cursor is now null in DB. Reload from
          // there — or use null directly (same effect).
          cursor: input?.backfill ? null : acc.cursor,
        });
        results.push({
          linkedAccountId: acc.id,
          added: r.added,
          modified: r.modified,
          removed: r.removed,
          ...(r.error ? { error: r.error } : {}),
        });
      }
      return { results, backfilled: input?.backfill === true };
    }),

  /**
   * Historical backfill via Plaid /transactions/get — date-range bounded.
   *
   * 2026-05-23 — Jeff: "把記錄拉回到之前的 2025 到至今". The standard
   * transactionsSync only returns data from cursor onwards; BofA caps that
   * at ~90 days. /transactions/get accepts explicit start_date / end_date
   * and may return older data (depends on institution retention; Plaid's
   * 24-month window applies).
   *
   * Each Plaid transaction is upserted into bankTransactions with the
   * same logic as the regular sync — onDuplicateKeyUpdate refreshes
   * memos / amounts / status if the row already exists.
   *
   * Returns counts per account so the UI can show how many rows arrived.
   */
  backfillHistorical: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      requirePlaid();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { getTransactionsByDateRange } = await import("../_core/plaid");

      const accounts = await db
        .select()
        .from(linkedBankAccounts)
        .where(eq(linkedBankAccounts.isActive, 1));

      const results: Array<{
        linkedAccountId: number;
        accountName: string | null;
        totalReturned: number;
        added: number;
        error?: string;
      }> = [];

      for (const acc of accounts) {
        try {
          const token = decryptAccessToken(acc.plaidAccessTokenEncrypted);
          const { transactions, total } = await getTransactionsByDateRange(
            token,
            input.startDate,
            input.endDate,
            [acc.plaidAccountId],
          );

          let added = 0;
          for (const t of transactions) {
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
                  merchantName: t.merchant_name ?? t.name?.slice(0, 256) ?? null,
                  description: t.name ?? null,
                  originalDescription: (t as any).original_description ?? null,
                  paymentMeta: (t as any).payment_meta ?? null,
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
                    originalDescription: (t as any).original_description ?? null,
                    paymentMeta: (t as any).payment_meta ?? null,
                    updatedAt: new Date(),
                  },
                });
              added++;
            } catch {
              // duplicate / write race — skip silently
            }
          }

          results.push({
            linkedAccountId: acc.id,
            accountName: acc.accountName ?? null,
            totalReturned: total,
            added,
          });
        } catch (err) {
          results.push({
            linkedAccountId: acc.id,
            accountName: acc.accountName ?? null,
            totalReturned: 0,
            added: 0,
            error: (err as Error)?.message ?? "unknown",
          });
        }
      }

      return {
        startDate: input.startDate,
        endDate: input.endDate,
        results,
      };
    }),

  /**
   * Manual CSV import — Mobile BackfillExt v2 (2026-05-23).
   *
   * Plaid won't return BofA history older than ~90 days, so for 2025
   * data Jeff downloads CSV from BofA online banking and uploads here.
   * Each row gets a synthetic plaidTransactionId of the form
   * `csv:<accountId>:<hash>` so re-uploads dedup, and Plaid-synced rows
   * (which have opaque random IDs) never collide.
   *
   * Caller controls dryRun to preview before commit.
   */
  csvImport: adminProcedure
    .input(
      z.object({
        linkedAccountId: z.number().int().positive(),
        csvText: z.string().min(1).max(10_000_000),
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify account exists + active
      const [acc] = await db
        .select({ id: linkedBankAccounts.id, name: linkedBankAccounts.accountName })
        .from(linkedBankAccounts)
        .where(
          and(
            eq(linkedBankAccounts.id, input.linkedAccountId),
            eq(linkedBankAccounts.isActive, 1),
          ),
        )
        .limit(1);
      if (!acc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "account not found" });
      }

      const { parseBofaCsv } = await import("../services/bankCsvImportService");
      const parsed = parseBofaCsv({
        csvText: input.csvText,
        linkedAccountId: input.linkedAccountId,
      });

      // bank-csv-merge m2 — before touching the DB, decide per CSV row
      // whether it IS an already-synced Plaid transaction (BofA-via-Plaid
      // strips Zelle memos down to "PURCHASE"; the CSV carries the full
      // bank line). Matched rows ENRICH the Plaid row instead of inserting
      // a twin.
      const { matchCsvRowsToPlaid, buildEnrichment } = await import(
        "../services/bankCsvMerge"
      );
      const sortedDates = parsed.rows.map((r) => r.date).sort();
      const dateMin = sortedDates[0] ?? null;
      const dateMax = sortedDates.at(-1) ?? null;
      const shiftDay = (d: string, days: number) =>
        new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10);

      type CsvRow = (typeof parsed.rows)[number];
      let matchResult: import("../services/bankCsvMerge").MatchResult<CsvRow> = {
        merges: [],
        inserts: parsed.rows,
        ambiguous: [],
      };
      if (parsed.rows.length > 0 && dateMin && dateMax) {
        const plaidRows = await db
          .select({
            id: bankTransactions.id,
            plaidTransactionId: bankTransactions.plaidTransactionId,
            date: bankTransactions.date,
            amount: bankTransactions.amount,
            merchantName: bankTransactions.merchantName,
            description: bankTransactions.description,
            paymentMeta: bankTransactions.paymentMeta,
            // m4 — re-classify eligibility (read-only here)
            agentCategory: bankTransactions.agentCategory,
            jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
          })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.linkedAccountId, input.linkedAccountId),
              sql`${bankTransactions.plaidTransactionId} NOT LIKE 'csv:%'`,
              sql`${bankTransactions.plaidTransactionId} NOT LIKE 'manual_%'`,
              sql`${bankTransactions.date} >= ${shiftDay(dateMin, -3)}`,
              sql`${bankTransactions.date} <= ${shiftDay(dateMax, 3)}`,
            ),
          );
        matchResult = matchCsvRowsToPlaid(parsed.rows, plaidRows);
      }

      if (input.dryRun) {
        return {
          dryRun: true,
          format: parsed.format,
          parsedCount: parsed.rows.length,
          warnings: parsed.warnings.slice(0, 20),
          dateMin,
          dateMax,
          // merge preview so the commit step can say what will happen
          wouldMerge: matchResult.merges.filter((m) => !m.alreadyMerged)
            .length,
          wouldMergeAlready: matchResult.merges.filter((m) => m.alreadyMerged)
            .length,
          wouldInsert:
            matchResult.inserts.length + matchResult.ambiguous.length,
          ambiguous: matchResult.ambiguous.length,
          sample: parsed.rows.slice(0, 5).map((r) => ({
            date: r.date,
            amount: r.amount,
            description: r.description.slice(0, 60),
          })),
        };
      }

      const { audit } = await import("../_core/auditLog");

      // ── merge path: enrich the surviving Plaid row. Amount/date/category
      // are deliberately never written here (錢的不變式 — bankCsvMerge docs).
      let merged = 0;
      let mergedAlready = 0;
      let removedOldCsvRows = 0;
      // m4 — rows whose classification was stuck on the generic Plaid text
      // get ONE more agent pass now that the full bank line is on the row.
      // jeffOverrideCategory IS NULL is the hard guard: human-confirmed
      // rows are never re-queued (m0 verified field semantics).
      const reclassifyIds: number[] = [];
      for (const m of matchResult.merges) {
        try {
          if (m.alreadyMerged) {
            mergedAlready++;
          } else {
            const e = buildEnrichment(m.csvRow, m.plaidRow);
            await db
              .update(bankTransactions)
              .set({
                description: e.description,
                originalDescription: e.originalDescription,
                merchantName: e.merchantName,
                paymentMeta: e.paymentMeta,
                updatedAt: new Date(),
              })
              .where(eq(bankTransactions.id, m.plaidRow.id));
            merged++;
            const pr = m.plaidRow as typeof m.plaidRow & {
              agentCategory?: string | null;
              jeffOverrideCategory?: string | null;
            };
            if (
              pr.jeffOverrideCategory == null &&
              (pr.agentCategory == null || pr.agentCategory === "other_review")
            ) {
              reclassifyIds.push(m.plaidRow.id);
            }
            audit({
              ctx,
              action: "bankTxn.csvMerge",
              targetType: "bankTransaction",
              targetId: m.plaidRow.id,
              changes: {
                csvSyntheticId: m.csvRow.syntheticId,
                dateDiffDays: m.dateDiffDays,
                plaidOriginalName: m.plaidRow.description,
              },
            });
          }

          // Defensive de-dup (descoped m3): if a PREVIOUS import already
          // inserted this CSV row as its own twin, remove it now that the
          // Plaid row carries the full description. Prod has 0 such pairs
          // today (m0 verified); this keeps re-uploads of old CSVs safe.
          const [oldTwin] = await db
            .select({ id: bankTransactions.id })
            .from(bankTransactions)
            .where(
              eq(bankTransactions.plaidTransactionId, m.csvRow.syntheticId),
            )
            .limit(1);
          if (oldTwin) {
            await db
              .delete(bankTransactions)
              .where(eq(bankTransactions.id, oldTwin.id));
            removedOldCsvRows++;
            audit({
              ctx,
              action: "bankTxn.csvMergeRemoveTwin",
              targetType: "bankTransaction",
              targetId: oldTwin.id,
              changes: {
                mergedIntoPlaidRowId: m.plaidRow.id,
                csvSyntheticId: m.csvRow.syntheticId,
              },
            });
          }
        } catch (err) {
          console.warn(
            `[csv import] merge failed: ${(err as Error)?.message}`,
          );
        }
      }

      // m4 — reset stuck classifications so classifyUncategorizedBatch
      // (which only looks at agentCategory IS NULL) picks them up with the
      // enriched description. SQL re-guards jeffOverrideCategory IS NULL.
      let requeuedForClassification = 0;
      if (reclassifyIds.length > 0) {
        try {
          await db
            .update(bankTransactions)
            .set({
              agentCategory: null,
              agentConfidence: null,
              agentReasoning: null,
            })
            .where(
              and(
                inArray(bankTransactions.id, reclassifyIds),
                sql`${bankTransactions.jeffOverrideCategory} IS NULL`,
              ),
            );
          const { classifyUncategorizedBatch } = await import(
            "../services/accountingAgentService"
          );
          const res = await classifyUncategorizedBatch({
            limit: Math.min(reclassifyIds.length + 10, 200),
          });
          requeuedForClassification = reclassifyIds.length;
          console.log(
            `[csv import] re-classified after merge: requeued=${reclassifyIds.length} processed=${res.processed}`,
          );
        } catch (err) {
          console.warn(
            `[csv import] re-classify after merge failed (non-fatal): ${(err as Error)?.message}`,
          );
        }
      }

      // ── insert path (unmatched + ambiguous) — unchanged upsert semantics.
      // Ambiguous rows insert as before: two visible rows for Jeff beat a
      // guessed-wrong merge (design §1).
      const toInsert = [
        ...matchResult.inserts,
        ...matchResult.ambiguous.map((a) => a.csvRow),
      ];
      let inserted = 0;
      let updated = 0;
      for (const r of toInsert) {
        try {
          await db
            .insert(bankTransactions)
            .values({
              linkedAccountId: input.linkedAccountId,
              plaidTransactionId: r.syntheticId,
              date: r.date as any,
              authorizedDate: null,
              amount: String(r.amount),
              isoCurrencyCode: r.isoCurrencyCode,
              merchantName: r.merchantName,
              description: r.description,
              originalDescription: r.description,
              paymentMeta: r.referenceNumber
                ? { reference_number: r.referenceNumber }
                : null,
              paymentChannel: null,
              plaidCategoryPrimary: null,
              plaidCategoryDetailed: null,
              isPending: 0,
              accountOwner: null,
            })
            .onDuplicateKeyUpdate({
              set: {
                amount: String(r.amount),
                description: r.description,
                originalDescription: r.description,
                updatedAt: new Date(),
              },
            });
          // Heuristic: count as updated if it existed (Drizzle doesn't expose
          // affectedRows reliably; we assume mix is mostly insert on first run).
          inserted++;
        } catch (err) {
          // Genuine error — log + skip
          console.warn(`[csv import] row failed: ${(err as Error)?.message}`);
          reportFunnelError({
            source: "fail-open:plaidRouter:csvImportRow",
            err,
            context: { linkedAccountId: input.linkedAccountId },
          }).catch(() => {});
        }
      }

      return {
        dryRun: false,
        format: parsed.format,
        parsedCount: parsed.rows.length,
        warnings: parsed.warnings.slice(0, 20),
        upserted: inserted,
        updated,
        merged,
        mergedAlready,
        ambiguous: matchResult.ambiguous.length,
        removedOldCsvRows,
        requeuedForClassification,
      };
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

      // 2026-05-22 fix: previously filtered by `linkedBankAccounts.userId =
      // ctx.user.id`, which broke for one-person ops with multiple admin
      // logins (e.g. Jeff linked Plaid as jeffhsieh09@gmail.com but daily-drives
      // admin as support@packgoplay.com — the queries saw 0 accounts and
      // returned empty list while reconciliation.runReport saw all 124 txns).
      // PACK&GO is single-tenant; every admin sees every linked account.
      // If we ever go multi-tenant, gate by org_id instead.
      //
      // ALSO: drop accounts where isActive=0 (Plaid sandbox cleanup leftovers
      // from First Platypus Bank — 24 accounts that were marked inactive
      // 2026-05-14 with lastSyncError "sandbox cleanup before production
      // switch"). Their transactions don't reflect real money flow.
      const allAccountIds = await db
        .select({ id: linkedBankAccounts.id })
        .from(linkedBankAccounts)
        .where(eq(linkedBankAccounts.isActive, 1));
      const ownedIds = allAccountIds.map((r) => r.id);
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
      // 2026-05-23 scaling guardrail: hide archived (txns > 2 years old)
      // from default ledger view. Use admin.scaling.listArchived to see them.
      filters.push(eq(bankTransactions.archived, 0));

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
        // Canonical 10 only; "" clears the override. (M1 — was z.string().max(64))
        category: z.union([CATEGORY_ENUM, z.literal("")]).optional(),
        reason: z.string().max(2000).optional(),
        exclude: z.boolean().optional(),
        relatedBookingId: z.number().int().positive().optional(),
        // IRS Schedule C-grade fields (migration 0080, 2026-05-22).
        // null = clear the field; undefined = leave unchanged.
        counterparty: z.string().max(255).nullable().optional(),
        counterpartyType: z
          .enum([
            "vendor",
            "customer",
            "owner",
            "employee",
            "refund",
            "transfer",
            "tax",
            "other",
          ])
          .nullable()
          .optional(),
        purposeNote: z.string().max(2000).nullable().optional(),
        receiptUrl: z.string().url().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Load current row (for the audit-log before/after diff)
      const [row] = await db
        .select({
          id: bankTransactions.id,
          linkedAccountId: bankTransactions.linkedAccountId,
          agentCategory: bankTransactions.agentCategory,
          jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
          jeffOverrideReason: bankTransactions.jeffOverrideReason,
          excludeFromAccounting: bankTransactions.excludeFromAccounting,
          relatedBookingId: bankTransactions.relatedBookingId,
          counterparty: bankTransactions.counterparty,
          counterpartyType: bankTransactions.counterpartyType,
          purposeNote: bankTransactions.purposeNote,
          receiptUrl: bankTransactions.receiptUrl,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, input.transactionId))
        .limit(1);
      // 2026-05-22: dropped per-user ownership check. Any admin role can
      // edit any bank transaction (single-tenant PACK&GO). Audit trail
      // (adminAuditLog wire-up below) records who made each change.
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const updates: any = { updatedAt: new Date() };
      const captureChange = (field: string, oldVal: unknown, newVal: unknown) => {
        if (oldVal !== newVal) {
          before[field] = oldVal ?? null;
          after[field] = newVal ?? null;
        }
      };

      if (input.category !== undefined) {
        updates.jeffOverrideCategory = input.category;
        captureChange("category", row.jeffOverrideCategory, input.category);
      }
      if (input.reason !== undefined) {
        updates.jeffOverrideReason = input.reason;
        captureChange("reason", row.jeffOverrideReason, input.reason);
      }
      if (input.exclude !== undefined) {
        updates.excludeFromAccounting = input.exclude ? 1 : 0;
        if (input.exclude && !input.reason) {
          updates.excludeReason = "manually excluded by admin";
        }
        captureChange(
          "excludeFromAccounting",
          row.excludeFromAccounting,
          input.exclude ? 1 : 0
        );
      }
      if (input.relatedBookingId !== undefined) {
        updates.relatedBookingId = input.relatedBookingId;
        captureChange(
          "relatedBookingId",
          row.relatedBookingId,
          input.relatedBookingId
        );
      }
      // IRS Schedule C fields — null clears, string sets.
      if (input.counterparty !== undefined) {
        updates.counterparty = input.counterparty;
        captureChange("counterparty", row.counterparty, input.counterparty);
      }
      if (input.counterpartyType !== undefined) {
        updates.counterpartyType = input.counterpartyType;
        captureChange(
          "counterpartyType",
          row.counterpartyType,
          input.counterpartyType
        );
      }
      if (input.purposeNote !== undefined) {
        updates.purposeNote = input.purposeNote;
        captureChange("purposeNote", row.purposeNote, input.purposeNote);
      }
      if (input.receiptUrl !== undefined) {
        updates.receiptUrl = input.receiptUrl;
        captureChange("receiptUrl", row.receiptUrl, input.receiptUrl);
      }

      await db
        .update(bankTransactions)
        .set(updates)
        .where(eq(bankTransactions.id, input.transactionId));

      // IRS audit trail (migration 0080): every change to a bank transaction
      // gets a row in adminAuditLog. Fire-and-forget — never block on the
      // audit write. Empty-diff updates skip logging.
      if (Object.keys(after).length > 0) {
        const { audit } = await import("../_core/auditLog");
        void audit({
          ctx,
          action: "bankTransaction.update",
          targetType: "bankTransaction",
          targetId: String(input.transactionId),
          changes: { before, after },
          reason: input.reason,
        });
      }

      // Trust deferral sync (2026-05-29): the manual override path historically
      // did NOT touch the deferral ledger, so a hand-marked trust inflow never
      // created a trustDeferredIncome row and got counted as income immediately
      // (violating CST §17550 for long-lead bookings). Mirror the agent path:
      // create the deferred row when the EFFECTIVE category becomes
      // income_booking, reverse it when it moves away or gets excluded. The
      // create/reverse calls self-guard on trust-account + inflow + row
      // existence, so a non-trust or non-inflow txn is a safe no-op. Best-effort
      // — never roll back the (already committed) category change on failure.
      let trustDeferralAction: string | null = null;
      if (input.category !== undefined || input.exclude !== undefined) {
        try {
          const { effectiveCategory, syncDeferralForManualOverride } =
            await import("../services/trustDeferralService");
          const prevExcluded = row.excludeFromAccounting === 1;
          const newJeff =
            input.category !== undefined
              ? input.category
              : row.jeffOverrideCategory;
          const newExcluded =
            input.exclude !== undefined ? input.exclude : prevExcluded;
          const sync = await syncDeferralForManualOverride({
            bankTransactionId: input.transactionId,
            before: {
              effectiveCategory: effectiveCategory(
                row.jeffOverrideCategory,
                row.agentCategory
              ),
              excluded: prevExcluded,
            },
            after: {
              effectiveCategory: effectiveCategory(newJeff, row.agentCategory),
              excluded: newExcluded,
            },
            reason: input.reason,
          });
          trustDeferralAction = sync.action;
        } catch (err) {
          console.warn(
            `[trust-deferral] manual-override sync failed for txn ${input.transactionId}: ${(err as Error)?.message}`
          );
          reportFunnelError({ source: "fail-open:plaidRouter:trustDeferralManualOverrideSync", err, context: { transactionId: input.transactionId } }).catch(() => {});
        }
      }

      return { success: true, trustDeferral: trustDeferralAction };
    }),

  /**
   * IRS audit trail (migration 0080) — return the adminAuditLog entries
   * referencing this bank transaction. Used by BankLedgerV2 Sheet drawer
   * "變更歷史" section. Ordered newest-first.
   */
  transactionAuditHistory: adminProcedure
    .input(z.object({ transactionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const { adminAuditLog } = await import("../../drizzle/schema");
      const { and: drAnd, eq: drEq, desc: drDesc } = await import("drizzle-orm");
      const rows = await db
        .select({
          id: adminAuditLog.id,
          userEmail: adminAuditLog.userEmail,
          action: adminAuditLog.action,
          changes: adminAuditLog.changes,
          reason: adminAuditLog.reason,
          createdAt: adminAuditLog.createdAt,
        })
        .from(adminAuditLog)
        .where(
          drAnd(
            drEq(adminAuditLog.targetType, "bankTransaction"),
            drEq(adminAuditLog.targetId, String(input.transactionId))
          )
        )
        .orderBy(drDesc(adminAuditLog.id))
        .limit(50);
      return rows.map((r) => ({
        ...r,
        changes: r.changes
          ? (() => {
              try {
                return JSON.parse(r.changes);
              } catch {
                return null;
              }
            })()
          : null,
      }));
    }),

  /**
   * Receipt upload for an IRS-grade transaction record (≥$75 expenses need
   * supporting documentation per IRS Rev. Proc. 2017-30). Accepts base64
   * encoded file (PDF / JPEG / PNG / WebP), stores to R2 under
   * `receipts/<txnId>-<random>.<ext>`, returns the URL. Caller is then
   * expected to update the transaction with this URL via transactionUpdate.
   */
  receiptUpload: adminProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        contentType: z.enum([
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
        ]),
        // ~10 MB cap; PDFs that big are usually scanned receipts.
        base64Data: z.string().min(1).max(15_000_000),
        originalFilename: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { storagePut } = await import("../storage");
      const { randomBytes } = await import("crypto");
      const cleanBase64 = input.base64Data.replace(
        /^data:[^;]+;base64,/,
        ""
      );
      const buffer = Buffer.from(cleanBase64, "base64");
      const extByType: Record<string, string> = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const ext = extByType[input.contentType] ?? "bin";
      const suffix = randomBytes(6).toString("hex");
      const key = `receipts/${input.transactionId}-${Date.now()}-${suffix}.${ext}`;
      const { url } = await storagePut(key, buffer, input.contentType);
      return { url, key, size: buffer.length };
    }),

  /**
   * Mobile Phase 6 (2026-05-22) — orphan receipt OCR + match. Used by
   * the floating receipt camera FAB when Jeff snaps a meal/taxi receipt
   * on the road.
   *
   * Flow:
   *   1. Image → R2 under receipts-inbox/
   *   2. Claude vision OCR → { amount, date, vendor, confidence }
   *   3. Find candidate bankTransactions matching by amount + date (±3d)
   *   4. Return uploadUrl + ocr + top 5 matches; client confirms which
   *      txn to attach receiptUrl to via transactionUpdate
   */
  receiptUploadAndMatch: adminProcedure
    .input(
      z.object({
        contentType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ]),
        base64Data: z.string().min(1).max(15_000_000),
        originalFilename: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { storagePut } = await import("../storage");
      const { randomBytes } = await import("crypto");
      const { ocrReceipt } = await import("../services/receiptOcrService");

      const cleanBase64 = input.base64Data.replace(
        /^data:[^;]+;base64,/,
        ""
      );
      const extByType: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
      };
      const ext = extByType[input.contentType] ?? "bin";
      const suffix = randomBytes(6).toString("hex");
      const key = `receipts-inbox/${Date.now()}-${suffix}.${ext}`;
      const buffer = Buffer.from(cleanBase64, "base64");
      const { url } = await storagePut(key, buffer, input.contentType);

      // OCR — only for images, PDFs are upload-only
      const ocr =
        input.contentType === "application/pdf"
          ? {
              amount: null,
              date: null,
              vendor: null,
              currency: null,
              confidence: 0,
              rawResponse: "(PDF — skipping OCR)",
            }
          : await ocrReceipt({
              imageBase64: cleanBase64,
              mediaType: input.contentType,
            });

      // Match candidates — amount within ±$1, date within ±3 days
      let matches: Array<{
        id: number;
        date: any;
        amount: any;
        merchantName: string | null;
        score: number;
      }> = [];

      if (ocr.amount !== null && ocr.amount > 0) {
        const db = await getDb();
        if (db) {
          const ocrDate = ocr.date ? new Date(ocr.date) : new Date();
          const dateLo = new Date(ocrDate);
          dateLo.setDate(dateLo.getDate() - 3);
          const dateHi = new Date(ocrDate);
          dateHi.setDate(dateHi.getDate() + 3);

          // Receipts are EXPENSES → positive Plaid sign. Search for
          // outflows close to the OCR amount.
          const rows = await db
            .select({
              id: bankTransactions.id,
              date: bankTransactions.date,
              amount: bankTransactions.amount,
              merchantName: bankTransactions.merchantName,
            })
            .from(bankTransactions)
            .where(
              and(
                gte(bankTransactions.date, dateLo as any),
                lte(bankTransactions.date, dateHi as any),
                eq(bankTransactions.excludeFromAccounting, 0)
              )
            )
            .limit(50);

          const target = ocr.amount;
          matches = rows
            .map((r) => {
              const a = Math.abs(parseFloat(String(r.amount)) || 0);
              const amountDiff = Math.abs(a - target);
              const dayDiff = Math.abs(
                (new Date(r.date as any).getTime() - ocrDate.getTime()) /
                  86_400_000
              );
              // Score: amount match weighted 70%, date proximity 30%
              const amountScore = amountDiff < 0.01 ? 100 : Math.max(0, 100 - amountDiff * 10);
              const dateScore = Math.max(0, 100 - dayDiff * 20);
              const score = Math.round(amountScore * 0.7 + dateScore * 0.3);
              return {
                id: r.id,
                date: r.date,
                amount: r.amount,
                merchantName: r.merchantName,
                score,
              };
            })
            .filter((m) => m.score >= 40)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
        }
      }

      return { uploadUrl: url, key, ocr, matches };
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
    .query(async ({ input }) => {
      // 2026-05-22 — drop userId scope (single-tenant). Same rationale as
      // transactionsList / classifyBatch: support@ was seeing $0 P&L because
      // accounts are linked under jeffhsieh09@.
      const { generateBankPL } = await import("../services/bankPLService");
      return await generateBankPL({
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
    .query(async ({ input }) => {
      const { generateBankMonthlyTrend } = await import(
        "../services/bankPLService"
      );
      return await generateBankMonthlyTrend({
        months: input?.months ?? 12,
      });
    }),

  /**
   * Lightweight KPI tile data for the 財務 KPI strip (BankLedgerV2 desktop +
   * mobile KpiStrip): "賺多少 / 付多少 / 淨利" for current month + YTD. Cheaper
   * than profitLossReport since callers only need 6 numbers, not the
   * per-category breakdown. (F1 塊D 2026-07-09:原註解引用的 FinanceLanding
   * 已刪除死碼,改列現行 live 消費者。)
   *
   * 2026-05-22 — built in response to Jeff seeing $0 on the 財務 page even
   * after AI classified Zelle income, FedEx expenses, etc. The old card
   * read from bookings table which was empty; this reads from Plaid +
   * AccountingAgent classifications.
   */
  financeKpi: adminProcedure.query(async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const startOfYear = new Date(now.getFullYear(), 0, 1)
      .toISOString()
      .slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toISOString()
      .slice(0, 10);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
      .toISOString()
      .slice(0, 10);

    const { generateBankPL } = await import("../services/bankPLService");
    const [thisMonth, lastMonth, ytd] = await Promise.all([
      generateBankPL({ startDate: startOfMonth, endDate: today }),
      generateBankPL({ startDate: lastMonthStart, endDate: lastMonthEnd }),
      generateBankPL({ startDate: startOfYear, endDate: today }),
    ]);

    const growth =
      lastMonth.income.total > 0
        ? Math.round(
            ((thisMonth.income.total - lastMonth.income.total) /
              lastMonth.income.total) *
              1000,
          ) / 10
        : thisMonth.income.total > 0
          ? 100
          : 0;

    return {
      thisMonth: {
        income: thisMonth.income.total,
        expenses: thisMonth.expenses.total,
        netProfit: thisMonth.netProfit,
        cogs: thisMonth.expenses.cogs,
        operating: thisMonth.expenses.operating,
        refunds: thisMonth.refunds,
        needsReviewCount: thisMonth.needsReviewCount,
        needsReviewAmount: thisMonth.needsReviewAmount,
        trustDeferredIncome: thisMonth.trustDeferredIncome,
      },
      ytd: {
        income: ytd.income.total,
        expenses: ytd.expenses.total,
        netProfit: ytd.netProfit,
        cogs: ytd.expenses.cogs,
        operating: ytd.expenses.operating,
        refunds: ytd.refunds,
        trustDeferredIncome: ytd.trustDeferredIncome,
      },
      vsLastMonthGrowthPct: growth,
      currency: "USD",
    };
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
  // Classify uncategorized bank transactions into PACK&GO's 11-category
  // taxonomy (F1 塊C 2026-07-08 加了 stripe_payout,原註解寫 10 未同步)。Used by:
  //   - Admin "AI 分類" batch button on the bank ledger (BankLedgerV2)
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
      // 2026-05-22: dropped per-user check (single-tenant). Audit log
      // captures who triggered the classify.
      if (!row) {
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
    .mutation(async ({ input }) => {
      // 2026-05-22 fix: drop userId scope for single-tenant PACK&GO. With
      // multi-admin login (Jeff + future staff), accounts can be linked under
      // different userId values; classifying only this admin's accounts left
      // 167 txns stuck with raw Plaid PFC categories.
      const { classifyUncategorizedBatch } = await import(
        "../services/accountingAgentService"
      );
      return await classifyUncategorizedBatch({
        limit: input?.limit ?? 50,
      });
    }),

  // ── Bulk categorize helpers (2026-05-27) ─────────────────────────────────

  /**
   * Groups uncategorized bank transactions by normalized merchant name.
   * Used by the admin UI to quickly bulk-categorize repeating vendors
   * (e.g. 14 Amazon transactions all needing "supplies").
   */
  uncategorizedGroups: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { groups: [], totalUncategorized: 0 };

      const uncategorizedWhere = and(
        isNull(bankTransactions.jeffOverrideCategory),
        or(
          isNull(bankTransactions.agentCategory),
          eq(bankTransactions.agentCategory, "other_review")
        ),
        eq(bankTransactions.excludeFromAccounting, 0),
        eq(bankTransactions.archived, 0)
      );

      // Total uncategorized count (single + grouped)
      const [totalRow] = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(bankTransactions)
        .where(uncategorizedWhere);
      const totalUncategorized = Number(totalRow?.cnt ?? 0);

      // Raw SQL — Drizzle's query builder chokes on GROUP_CONCAT(... ORDER BY)
      // and on groupBy(sql`COALESCE(...)`) in some MySQL configurations.
      const rawRows: Array<{
        groupKey: string;
        cnt: number;
        totalAmount: string;
        sampleDate: string;
        ids: string;
      }> = await db.execute(sql`
        SELECT
          COALESCE(merchantName, counterparty, 'Unknown') AS groupKey,
          COUNT(*) AS cnt,
          SUM(CAST(amount AS DECIMAL(14,2))) AS totalAmount,
          MAX(date) AS sampleDate,
          GROUP_CONCAT(id ORDER BY date DESC) AS ids
        FROM bankTransactions
        WHERE jeffOverrideCategory IS NULL
          AND (agentCategory IS NULL OR agentCategory = 'other_review')
          AND excludeFromAccounting = 0
          AND archived = 0
        GROUP BY groupKey
        HAVING cnt >= 2
        ORDER BY cnt DESC, totalAmount DESC
        LIMIT ${input?.limit ?? 20}
      `) as any;
      const rows = Array.isArray(rawRows) ? (rawRows[0] ?? []) : [];

      return {
        groups: (rows as any[]).map((r: any) => ({
          groupKey: String(r.groupKey ?? "Unknown"),
          count: Number(r.cnt ?? 0),
          totalAmount: Number(r.totalAmount ?? 0),
          sampleDate: String(r.sampleDate ?? ""),
          transactionIds: r.ids
            ? String(r.ids).split(",").map(Number)
            : [],
        })),
        totalUncategorized,
      };
    }),

  /**
   * READ-ONLY audit of historical overrides whose jeffOverrideCategory is NOT
   * one of the canonical 10 (i.e. set before M1, with the old taxonomy or a
   * free-text custom value). These rows are invisible to bankPLService, so
   * they're silently missing from P&L + Schedule C. We surface them with a
   * non-binding suggestedNew hint — 不準猜: nothing is auto-remapped; Jeff
   * re-picks each in the drawer. (M1, 2026-05-28)
   */
  accountingLegacyOverrideAudit: adminProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(500).default(200) })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, rows: [] };

      const canonical = [...ACCOUNTING_CATEGORIES];
      const whereClause = and(
        isNotNull(bankTransactions.jeffOverrideCategory),
        ne(bankTransactions.jeffOverrideCategory, ""),
        notInArray(bankTransactions.jeffOverrideCategory, canonical)
      );

      const [totalRow] = await db
        .select({ cnt: sql<number>`COUNT(*)` })
        .from(bankTransactions)
        .where(whereClause);
      const total = Number(totalRow?.cnt ?? 0);

      const rows = await db
        .select({
          id: bankTransactions.id,
          date: bankTransactions.date,
          amount: bankTransactions.amount,
          merchantName: bankTransactions.merchantName,
          description: bankTransactions.description,
          legacyCategory: bankTransactions.jeffOverrideCategory,
        })
        .from(bankTransactions)
        .where(whereClause)
        .orderBy(desc(bankTransactions.date))
        .limit(input?.limit ?? 200);

      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          suggestedNew:
            (r.legacyCategory && LEGACY_CATEGORY_SUGGESTION[r.legacyCategory]) ||
            null,
        })),
      };
    }),

  /**
   * Bulk-apply the same jeffOverrideCategory to multiple transactions.
   * Designed for the "verify group" flow where Jeff picks a merchant
   * group and assigns one category to all of them at once.
   */
  bulkCategorize: adminProcedure
    .input(
      z.object({
        transactionIds: z.array(z.number().int().positive()).min(1).max(500),
        // Canonical 10, or "exclude" sentinel (→ excludeFromAccounting). (M1)
        category: z.union([CATEGORY_ENUM, z.literal("exclude")]),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // "exclude" means "remove from accounting" — different column
      const isExclude = input.category === "exclude";
      const result = await db
        .update(bankTransactions)
        .set(
          isExclude
            ? {
                excludeFromAccounting: 1,
                excludeReason: input.reason ?? "bulk excluded by Jeff",
                updatedAt: new Date(),
              }
            : {
                jeffOverrideCategory: input.category,
                jeffOverrideReason: input.reason ?? "bulk verified by Jeff",
                updatedAt: new Date(),
              }
        )
        .where(inArray(bankTransactions.id, input.transactionIds));

      const updated = result[0]?.affectedRows ?? 0;

      // Single audit-log entry for the bulk action — fire-and-forget.
      const { audit } = await import("../_core/auditLog");
      void audit({
        ctx,
        action: "bulk_categorize",
        targetType: "bankTransaction",
        targetId: String(input.transactionIds[0]),
        changes: {
          transactionIds: input.transactionIds,
          category: input.category,
          reason: input.reason ?? "bulk verified by Jeff",
          count: input.transactionIds.length,
        },
      });

      return { updated };
    }),

  // ── Scaling guardrails (2026-05-23) ─────────────────────────────────────

  /**
   * Flip `archived=1` on bankTransactions > 2 years old. Default ledger
   * queries filter archived=0, so older history is hidden from hot paths
   * but stays available for Year-end Schedule C export.
   */
  scalingArchive: adminProcedure
    .input(
      z.object({
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const { archiveOldTransactions } = await import(
        "../services/scalingGuardrailsService"
      );
      return await archiveOldTransactions({ dryRun: input.dryRun });
    }),

  /**
   * R2 orphan receipt cleanup placeholder (v1 stub — true reaping needs
   * R2 List + reconcile, planned v2 once data starts piling up).
   */
  scalingCleanupReceipts: adminProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const { cleanupOrphanReceipts } = await import(
        "../services/scalingGuardrailsService"
      );
      return await cleanupOrphanReceipts({ dryRun: input.dryRun });
    }),

  /**
   * Compute month-to-date LLM cost; if > threshold ($50 default, env
   * `LLM_BUDGET_USD` overrides) send notifyOwner email.
   */
  scalingCheckLlmBudget: adminProcedure
    .input(
      z
        .object({
          thresholdUsd: z.number().positive().optional(),
          dryRun: z.boolean().default(false),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const { checkLlmBudgetAndAlert } = await import(
        "../services/scalingGuardrailsService"
      );
      return await checkLlmBudgetAndAlert({
        thresholdUsd: input?.thresholdUsd,
        dryRun: input?.dryRun,
      });
    }),

  // ── Phase 4: Trust account deferral admin ───────────────────────────────

  /**
   * Reconciliation view: per trust account, show outstanding deferred amount,
   * unmatched rows count, and how that compares to the live balance.
   *
   * In CST §17550 compliance, sum(deferred unmatched + matched) on a trust
   * account should == linkedBankAccounts.currentBalance. If they diverge,
   * something's wrong: untracked manual withdrawals, refunded bookings
   * not yet reversed, etc.
   */
  trustReconciliation: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const { computeOutstandingTrust, isTrustDeferralEnabled } = await import(
      "../services/trustDeferralService"
    );

    // 2026-05-22 — drop userId scope (single-tenant). Was returning [] for
    // support@ admin because the Living Trust Account (#5442) is linked
    // under jeffhsieh09@. Same pattern as the other route fixes.
    const trustAccounts = await db
      .select({
        id: linkedBankAccounts.id,
        institutionName: linkedBankAccounts.institutionName,
        accountName: linkedBankAccounts.accountName,
        accountMask: linkedBankAccounts.accountMask,
        currentBalance: linkedBankAccounts.currentBalance,
        isoCurrencyCode: linkedBankAccounts.isoCurrencyCode,
      })
      .from(linkedBankAccounts)
      .where(
        and(
          eq(linkedBankAccounts.isTrustAccount, 1),
          eq(linkedBankAccounts.isActive, 1)
        )
      );

    const enabled = isTrustDeferralEnabled();
    const results = await Promise.all(
      trustAccounts.map(async (a) => {
        const outstanding = await computeOutstandingTrust(a.id);
        const balance = parseFloat(String(a.currentBalance ?? 0));
        const drift = balance - outstanding.totalOutstanding;
        return {
          ...a,
          enabled,
          outstandingTotal: outstanding.totalOutstanding,
          outstandingRows: outstanding.rowCount,
          unmatchedCount: outstanding.unmatchedCount,
          unmatchedTotal: outstanding.unmatchedTotal,
          balance,
          drift, // positive = trust balance > what we're tracking (orphan deposits)
        };
      })
    );
    return results;
  }),

  /**
   * List trust deferred rows for admin review. Filters: linkedAccountId,
   * status (unmatched / pending-recognition / recognized / reversed).
   */
  trustDeferredList: adminProcedure
    .input(
      z
        .object({
          linkedAccountId: z.number().int().positive().optional(),
          status: z
            .enum(["unmatched", "pending", "recognized", "reversed", "all"])
            .default("unmatched"),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const status = input?.status ?? "unmatched";

      const { trustDeferredIncome } = await import("../../drizzle/schema");

      // Get the user's trust account ids first
      const userTrustIds = await db
        .select({ id: linkedBankAccounts.id })
        .from(linkedBankAccounts)
        .where(
          and(
            eq(linkedBankAccounts.userId, ctx.user.id),
            eq(linkedBankAccounts.isTrustAccount, 1)
          )
        );
      const ids = userTrustIds.map((r) => r.id);
      if (ids.length === 0) return [];

      const filters: any[] = [inArray(trustDeferredIncome.linkedAccountId, ids)];
      if (input?.linkedAccountId) {
        filters.push(
          eq(trustDeferredIncome.linkedAccountId, input.linkedAccountId)
        );
      }
      if (status === "unmatched") {
        filters.push(eq(trustDeferredIncome.matchMethod, "unmatched"));
        filters.push(isNull(trustDeferredIncome.recognizedAt));
        filters.push(isNull(trustDeferredIncome.reversedAt));
      } else if (status === "pending") {
        filters.push(isNull(trustDeferredIncome.recognizedAt));
        filters.push(isNull(trustDeferredIncome.reversedAt));
      } else if (status === "recognized") {
        filters.push(
          sql`${trustDeferredIncome.recognizedAt} IS NOT NULL`
        );
      } else if (status === "reversed") {
        filters.push(sql`${trustDeferredIncome.reversedAt} IS NOT NULL`);
      }
      // "all" → no filter

      return await db
        .select()
        .from(trustDeferredIncome)
        .where(and(...filters))
        .orderBy(desc(trustDeferredIncome.depositDate))
        .limit(input?.limit ?? 50);
    }),

  /**
   * Manually link an unmatched deferred row to a booking. Recomputes the
   * expected recognition date from the booking's tourDeparture.departureDate.
   */
  trustLinkBooking: adminProcedure
    .input(
      z.object({
        deferredId: z.number().int().positive(),
        bookingId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const { linkInflowToBooking } = await import(
        "../services/trustDeferralService"
      );
      return await linkInflowToBooking(input);
    }),

  /**
   * Reverse a deferred row (booking cancelled, refund processed). Won't be
   * recognized as income. Subtracts from trust reconciliation.
   */
  trustReverse: adminProcedure
    .input(
      z.object({
        deferredId: z.number().int().positive(),
        reason: z.string().min(1).max(256),
      })
    )
    .mutation(async ({ input }) => {
      const { reverseDeferral } = await import(
        "../services/trustDeferralService"
      );
      return await reverseDeferral(input);
    }),

  /**
   * Manually trigger the daily trust-recognition scan. Useful for admin
   * "rerun now" button after fixing matches.
   */
  trustRecognizeNow: adminProcedure.mutation(async () => {
    const { recognizeReadyDepartures, isAnyTrustDeferralEnabled } = await import(
      "../services/trustDeferralService"
    );
    // F1 塊B (2026-07-08) 對抗審查 P1 修復:改用 isAnyTrustDeferralEnabled——
    // 只看 PLAID flag 會讓 Jeff 在只開 STRIPE flag 時按這顆「立即重跑」按鈕
    // 得到誤導性的「disabled」訊息,即使 Stripe-direct 遞延列其實已經在等
    // 認列。
    if (!isAnyTrustDeferralEnabled()) {
      return {
        runId: "disabled",
        scanned: 0,
        recognized: 0,
        totalRecognizedAmount: 0,
        skippedNoDepartureDate: 0,
        skippedNotMatched: 0,
        skippedCancelledBooking: 0,
        error: "trust deferral is disabled (both PLAID_TRUST_DEFERRAL_ENABLED and STRIPE_TRUST_DEFERRAL_ENABLED are off)",
      } as const;
    }
    return await recognizeReadyDepartures();
  }),

  // ── M5: exclusion audit export ──────────────────────────────────────────

  /**
   * Audit export of the transactions EXCLUDED from the P&L — the rows whose
   * effective category (jeffOverride ?? agent) is `transfer` (owner capital /
   * internal moves) or `other_review` (pending classification). An accountant
   * reviewing the Schedule-C export needs to see WHY money moved without
   * counting as income/expense. Returns structured records, a summary, and a
   * ready-to-download CSV string (the UI offers a user-initiated download).
   *
   * Money math lives in the pure foldExclusionRows (auditExportService) so the
   * "only transfer + other_review" invariant is unit-tested without a DB.
   */
  auditExclusionList: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      const { foldExclusionRows, toExclusionCsv } = await import(
        "../services/auditExportService"
      );
      if (!db) {
        return {
          records: [],
          summary: {
            total: 0,
            transferCount: 0,
            transferTotal: 0,
            otherReviewCount: 0,
            otherReviewTotal: 0,
          },
          csv: toExclusionCsv([]),
        };
      }

      // Active accounts only; archived txns intentionally included so a
      // year-spanning audit still surfaces older excluded rows (same rule as
      // bankPLService). Single-tenant: aggregate across every active account.
      const rows = await db
        .select({
          id: bankTransactions.id,
          date: bankTransactions.date,
          amount: bankTransactions.amount,
          merchantName: bankTransactions.merchantName,
          description: bankTransactions.description,
          originalDescription: bankTransactions.originalDescription,
          counterparty: bankTransactions.counterparty,
          counterpartyType: bankTransactions.counterpartyType,
          purposeNote: bankTransactions.purposeNote,
          excludeReason: bankTransactions.excludeReason,
          agentCategory: bankTransactions.agentCategory,
          jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
          isPending: bankTransactions.isPending,
        })
        .from(bankTransactions)
        .leftJoin(
          linkedBankAccounts,
          eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
        )
        .where(
          and(
            eq(linkedBankAccounts.isActive, 1),
            gte(bankTransactions.date, input.startDate as any),
            lte(bankTransactions.date, input.endDate as any)
          )
        )
        .orderBy(desc(bankTransactions.date));

      const { records, summary } = foldExclusionRows(rows);
      return { records, summary, csv: toExclusionCsv(records) };
    }),
});
