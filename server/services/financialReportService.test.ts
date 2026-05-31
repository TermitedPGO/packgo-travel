/**
 * PKG-C — financialReportService pure folds.
 *
 * Locks the monthly-trend netProfit convention so the ledger trend can't drift
 * back to a second formula. RED-LINE (CST §17550): each month's netProfit
 * subtracts that month's unrecognized trust-deferred income; totalIncome stays
 * gross. Mirrors bankPLService.test.ts — pure, no DB.
 */
import { describe, it, expect } from "vitest";
import { foldMonthlyTrend } from "./financialReportService";

describe("foldMonthlyTrend — trust-aware per-month netProfit", () => {
  const buckets = {
    "2026-03": { income: 5000, expenses: 1200 },
    "2026-01": { income: 3000, expenses: 800 },
    "2026-02": { income: 4000, expenses: 1000 },
  };

  it("sorts months ascending regardless of insertion order", () => {
    const rows = foldMonthlyTrend(buckets);
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("defaults to gross netProfit (income − expenses) when no deferred map", () => {
    const rows = foldMonthlyTrend(buckets);
    const jan = rows.find((r) => r.month === "2026-01")!;
    expect(jan.trustDeferredIncome).toBe(0);
    expect(jan.netProfit).toBe(2200); // 3000 − 0 − 800
  });

  it("subtracts each month's own trust-deferred from that month's netProfit", () => {
    const deferredByMonth = { "2026-01": 1000, "2026-03": 5000 };
    const rows = foldMonthlyTrend(buckets, deferredByMonth);

    const jan = rows.find((r) => r.month === "2026-01")!;
    expect(jan.income).toBe(3000); // gross, untouched
    expect(jan.trustDeferredIncome).toBe(1000);
    expect(jan.netProfit).toBe(1200); // 3000 − 1000 − 800

    const feb = rows.find((r) => r.month === "2026-02")!;
    expect(feb.trustDeferredIncome).toBe(0); // not in the map → gross
    expect(feb.netProfit).toBe(3000); // 4000 − 0 − 1000

    const mar = rows.find((r) => r.month === "2026-03")!;
    // a month where the whole income is still deferred → netProfit = −expenses
    expect(mar.netProfit).toBe(-1200); // 5000 − 5000 − 1200
  });

  it("returns [] for empty buckets", () => {
    expect(foldMonthlyTrend({})).toEqual([]);
  });
});
