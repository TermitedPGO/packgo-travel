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
  it("exposes all 11 procedures from the pre-split source", () => {
    const procs = Object.keys((accountingRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
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
      ].sort(),
    );
  });
});
