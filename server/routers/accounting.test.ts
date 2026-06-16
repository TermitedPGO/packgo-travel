/**
 * Smoke test for Phase 4D · accounting sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 11
 * procedures originally at server/routers.ts L4643-4781. This is the
 * structural regression anchor for the Phase 4D money-path split.
 *
 * Behavioral coverage for the report formulas (P&L math, monthly trend
 * aggregation, tax summary) lives — when present — in
 * server/services/financialReportService.test.ts.
 */
import { describe, it, expect } from "vitest";
import { accountingRouter } from "./accounting";

describe("accountingRouter (Phase 4D extraction)", () => {
  it("exposes the 11 base procedures + 5 pendingExpenses (email-receipt-intake)", () => {
    const procs = Object.keys((accountingRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        // Phase 4D base set (server/routers.ts L4643-4781)
        "list",
        "stats",
        "create",
        "update",
        "delete",
        "exportCsv",
        "categories",
        "dashboard",
        "profitAndLoss",
        "monthlyTrend",
        "taxSummary",
        // email-receipt-intake (2026-06-15): 待確認支出 sub-router
        "pendingExpenses.list",
        "pendingExpenses.count",
        "pendingExpenses.attachmentUrl",
        "pendingExpenses.confirm",
        "pendingExpenses.reject",
      ].sort(),
    );
  });
});
