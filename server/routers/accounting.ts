/**
 * Accounting router — admin-only ledger management + financial reports.
 *
 * Extracted from server/routers.ts (Phase 4D · sub-PR 4 of 5) on
 * 2026-05-19 as part of the routers.ts split (audit P0-1, P0-2 — SOLO REVIEW
 * money-path PR). Source range (verbatim from origin): L4643-4781.
 *
 * Procedures (10):
 *   - list           – filtered ledger query
 *   - stats          – month/range totals
 *   - create         – manual ledger entry (admin write)
 *   - update         – edit ledger entry
 *   - delete         – delete ledger entry
 *   - exportCsv      – CSV export for tax / accountant handoff
 *   - categories     – category-label dictionary
 *   - dashboard      – financial dashboard widget
 *   - profitAndLoss  – P&L report
 *   - monthlyTrend   – monthly trend chart data
 *   - taxSummary     – annual tax summary
 *
 * Behavioral coverage: financial report formulas live in
 * server/services/financialReportService.test.ts (if present). This Phase 4D
 * extraction is STRUCTURAL only — no procedure body changes.
 *
 * Q5 dependency analysis: ledger CRUD calls only db.* and
 * server/services/financialReportService exports. No shared in-file helpers
 * required extraction.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { getSecureDocumentUrl } from "../storage";
import {
  generateProfitAndLossReport,
  generateMonthlyTrend,
  generateTaxSummary,
  generateAccountingCsv,
  generateFinancialDashboard,
  CATEGORY_LABELS,
} from "../services/financialReportService";

export const accountingRouter = router({
    // List accounting entries with filters
    list: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        entryType: z.enum(["income", "expense"]).optional(),
        category: z.string().optional(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input }) => {
        return db.getAccountingEntries(input);
      }),

    // Get accounting stats
    stats: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const startDate = input.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = input.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return db.getAccountingStats({ startDate, endDate });
      }),

    // Create a new accounting entry
    create: adminProcedure
      .input(z.object({
        entryType: z.enum(["income", "expense"]),
        category: z.string(),
        amount: z.number().positive(),
        currency: z.string().default("USD"),
        description: z.string(),
        entryDate: z.date(),
        isTaxDeductible: z.boolean().default(false),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
        bookingId: z.number().optional(),
        visaApplicationId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const entry = await db.createAccountingEntry({
          ...input,
          category: input.category as any,
          amount: String(input.amount),
          isTaxDeductible: input.isTaxDeductible ? 1 : 0,
          createdBy: ctx.user.id,
        });
        return entry;
      }),

    // Update an accounting entry
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        entryType: z.enum(["income", "expense"]).optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        currency: z.string().optional(),
        description: z.string().optional(),
        entryDate: z.date().optional(),
        isTaxDeductible: z.boolean().optional(),
        taxCategory: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        const mapped: Record<string, unknown> = { ...updates };
        if (updates.amount !== undefined) mapped.amount = String(updates.amount);
        if (updates.isTaxDeductible !== undefined) mapped.isTaxDeductible = updates.isTaxDeductible ? 1 : 0;
        return db.updateAccountingEntry(id, mapped);
      }),

    // Delete an accounting entry
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteAccountingEntry(input.id);
        return { success: true };
      }),

    // Export CSV
    exportCsv: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        entryType: z.enum(["income", "expense"]).optional(),
      }))
      .query(async ({ input }) => {
        const { entries } = await db.getAccountingEntries({ ...input, limit: 50000 });
        const csv = generateAccountingCsv(entries);
        return { csv, filename: `accounting-${new Date().toISOString().slice(0, 10)}.csv` };
      }),

    // Get category labels
    categories: adminProcedure.query(async () => {
      return CATEGORY_LABELS;
    }),

    // Financial dashboard
    dashboard: adminProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ input }) => {
        const now = new Date();
        const startDate = input.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = input.endDate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        return generateFinancialDashboard(startDate, endDate);
      }),

    // P&L report
    profitAndLoss: adminProcedure
      .input(z.object({
        startDate: z.date(),
        endDate: z.date(),
      }))
      .query(async ({ input }) => {
        return generateProfitAndLossReport(input.startDate, input.endDate);
      }),

    // Monthly trend
    monthlyTrend: adminProcedure
      .input(z.object({ months: z.number().min(1).max(24).default(12) }))
      .query(async ({ input }) => {
        return generateMonthlyTrend(input.months);
      }),

    // Tax summary
    taxSummary: adminProcedure
      .input(z.object({ year: z.number().min(2020).max(2030) }))
      .query(async ({ input }) => {
        return generateTaxSummary(input.year);
      }),

    // ── 待確認支出 (email-receipt-intake, 2026-06-15) ──────────────────────
    // Gmail 自動讀出的收據,排隊給 Jeff 逐筆確認。AI 只搬不入帳:金額/算哪團/
    // Trust-Operating/要不要真記分錄,全在 confirm 時由 Jeff 決定。
    pendingExpenses: router({
      // List staged receipts (default: still-pending).
      list: adminProcedure
        .input(
          z.object({
            status: z.enum(["pending", "confirmed", "rejected"]).default("pending"),
            limit: z.number().min(1).max(200).default(100),
            offset: z.number().min(0).default(0),
          }),
        )
        .query(async ({ input }) => {
          return db.listPendingExpenses(input);
        }),

      // Count still awaiting Jeff's decision — for the tab badge.
      count: adminProcedure.query(async () => {
        return { pending: await db.countPendingExpenses() };
      }),

      // Short-TTL signed URL to preview the stored receipt attachment.
      attachmentUrl: adminProcedure
        .input(z.object({ id: z.number() }))
        .query(async ({ input }) => {
          const row = await db.getPendingExpenseById(input.id);
          if (!row || !row.attachmentKey) {
            throw new TRPCError({ code: "NOT_FOUND", message: "No attachment for this expense" });
          }
          const url = await getSecureDocumentUrl(row.attachmentKey, 300);
          return { url, filename: row.attachmentFilename ?? "receipt", mimeType: row.attachmentMimeType };
        }),

      // Confirm a pending expense. handledMode decides whether we write a real
      // ledger entry ('ledger') or just archive the receipt ('receipt_only',
      // because the same charge will arrive via Plaid and booking it here would
      // double-count). Jeff may correct any AI-read field at confirm time.
      confirm: adminProcedure
        .input(
          z.object({
            id: z.number(),
            handledMode: z.enum(["ledger", "receipt_only"]),
            account: z.enum(["trust", "operating"]),
            // Jeff's confirmed/corrected fields (override the AI extraction):
            vendor: z.string().optional(),
            amount: z.number().positive().optional(),
            currency: z.string().optional(),
            receiptDate: z.date().optional(),
            description: z.string().optional(),
            bookingId: z.number().optional(),
            // Ledger-mode only:
            entryCategory: z.string().optional(),
            isTaxDeductible: z.boolean().default(false),
            notes: z.string().optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const row = await db.getPendingExpenseById(input.id);
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Pending expense not found" });
          if (row.status !== "pending") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${row.status}` });
          }

          // Resolve final values: Jeff's input wins, fall back to AI extraction.
          const vendor = input.vendor ?? row.vendor ?? undefined;
          const amount = input.amount ?? (row.amount != null ? Number(row.amount) : undefined);
          const currency = input.currency ?? row.currency ?? "USD";
          const receiptDate = input.receiptDate ?? row.receiptDate ?? new Date();
          const description =
            input.description ?? row.description ?? (vendor ? `收據 · ${vendor}` : "收據");

          const confirmFields = {
            vendor: vendor ?? null,
            amount: amount != null ? String(amount) : null,
            currency,
            receiptDate,
            description,
            account: input.account,
            handledMode: input.handledMode,
            bookingId: input.bookingId ?? null,
            entryCategory: input.entryCategory ?? null,
            needsReview: 0,
            confirmedBy: ctx.user.id,
            confirmedAt: new Date(),
          };

          if (input.handledMode === "ledger") {
            // Booking a real expense — amount + category are mandatory.
            if (amount == null) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "金額必填才能入帳" });
            }
            if (!input.entryCategory) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "請選支出類別才能入帳" });
            }
            const { entry } = await db.confirmPendingExpenseToLedger({
              pendingId: row.id,
              entry: {
                entryType: "expense",
                category: input.entryCategory as any,
                amount: String(amount),
                currency,
                description,
                entryDate: receiptDate,
                account: input.account,
                bookingId: input.bookingId ?? null,
                // Store the R2 KEY (not a URL) — viewed via signed URL on demand.
                receiptUrl: row.attachmentKey ?? null,
                isTaxDeductible: input.isTaxDeductible ? 1 : 0,
                notes: input.notes ?? null,
                createdBy: ctx.user.id,
              },
              confirmFields,
            });
            return { ok: true as const, handledMode: "ledger" as const, accountingEntryId: entry?.id ?? null };
          }

          // receipt_only — archive the receipt + Jeff's decisions, no ledger row.
          await db.updatePendingExpense(row.id, { ...confirmFields, status: "confirmed" });
          return { ok: true as const, handledMode: "receipt_only" as const, accountingEntryId: null };
        }),

      // Reject — not a real expense / misfire / duplicate.
      reject: adminProcedure
        .input(z.object({ id: z.number(), reason: z.string().max(500).optional() }))
        .mutation(async ({ input, ctx }) => {
          const row = await db.getPendingExpenseById(input.id);
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Pending expense not found" });
          if (row.status !== "pending") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${row.status}` });
          }
          await db.updatePendingExpense(input.id, {
            status: "rejected",
            rejectReason: input.reason ?? null,
            confirmedBy: ctx.user.id,
            confirmedAt: new Date(),
          });
          return { ok: true as const };
        }),
    }),
  });
