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
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
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
  });
