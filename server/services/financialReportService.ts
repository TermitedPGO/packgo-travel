/**
 * Financial Report Service
 * Generates P&L reports, monthly trend analysis, tax summaries, and CSV exports
 * for PACK&GO Travel Agency accounting system.
 */

import { getAccountingEntries, getAccountingStats, type AccountingStats } from "../db";
import { AccountingEntry } from "../../drizzle/schema";

export interface ProfitAndLossReport {
  period: { start: Date; end: Date };
  income: {
    total: number;
    byCategory: Record<string, number>;
  };
  expenses: {
    total: number;
    byCategory: Record<string, number>;
  };
  /** Unrecognized customer-deposit (trust) income subtracted from netProfit
   *  per CST §17550. `income.total` stays gross; this is surfaced so the UI
   *  can show "客人訂金（未認列）" as its own line. */
  trustDeferredIncome: number;
  netProfit: number;
  profitMargin: number; // percentage, on net (post-deferral) revenue
  comparison: {
    prevNetProfit: number;
    changePercent: number;
  };
  yearToDate: {
    income: number;
    expenses: number;
    trustDeferredIncome: number;
    netProfit: number;
  };
}

export interface MonthlyTrendData {
  month: string; // "YYYY-MM"
  income: number;
  expenses: number;
  /** Trust-deferred income for the month (CST §17550), already subtracted
   *  from `netProfit`. Same convention as the headline stats. */
  trustDeferredIncome: number;
  netProfit: number;
}

export interface TaxSummary {
  year: number;
  totalIncome: number;
  totalExpenses: number;
  taxDeductibleExpenses: number;
  nonDeductibleExpenses: number;
  estimatedTaxableIncome: number;
  byTaxCategory: Record<string, number>;
}

export interface FinancialDashboard {
  // Shares the exact getAccountingStats envelope (trust-aware netProfit +
  // trustDeferredIncome fields) so the dashboard can never drift from it.
  stats: AccountingStats;
  monthlyTrend: MonthlyTrendData[];
  topExpenseCategories: Array<{ category: string; amount: number; percentage: number }>;
  topIncomeCategories: Array<{ category: string; amount: number; percentage: number }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  tour_booking: "行程訂單",
  visa_service: "簽證服務",
  affiliate_commission: "聯盟佣金",
  flight_booking: "機票訂購",
  hotel_booking: "飯店訂購",
  other_income: "其他收入",
  rent: "租金",
  utilities: "水電費",
  salary: "薪資",
  marketing: "行銷費用",
  travel_cost: "差旅費",
  supplier_payment: "供應商付款",
  office_supplies: "辦公用品",
  software: "軟體費用",
  insurance: "保險費",
  tax_payment: "稅款",
  bank_fee: "銀行手續費",
  stripe_fee: "Stripe 手續費",
  consulate_fee: "領事館費用",
  other_expense: "其他支出",
};

/**
 * Generate a full P&L report for a given period
 */
export async function generateProfitAndLossReport(
  startDate: Date,
  endDate: Date
): Promise<ProfitAndLossReport> {
  const [{ entries }, stats] = await Promise.all([
    getAccountingEntries({ startDate, endDate, limit: 10000 }),
    getAccountingStats({ startDate, endDate }),
  ]);

  const incomeByCategory: Record<string, number> = {};
  const expensesByCategory: Record<string, number> = {};

  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.entryType === "income") {
      incomeByCategory[entry.category] = (incomeByCategory[entry.category] ?? 0) + amount;
    } else {
      expensesByCategory[entry.category] = (expensesByCategory[entry.category] ?? 0) + amount;
    }
  }

  // netProfit / prevNetProfit / yearNetProfit are computed trust-aware inside
  // getAccountingStats (income − deferred − expenses). Read them straight off
  // `stats` rather than re-deriving — that re-derivation was the third stray
  // formula PKG-C is collapsing. Margin is on net (post-deferral) revenue.
  const netProfit = stats.netProfit;
  const netRevenue = stats.totalIncome - stats.trustDeferredIncome;
  const profitMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  const prevNetProfit = stats.prevNetProfit;
  const changePercent =
    prevNetProfit !== 0 ? ((netProfit - prevNetProfit) / Math.abs(prevNetProfit)) * 100 : 0;

  return {
    period: { start: startDate, end: endDate },
    income: { total: stats.totalIncome, byCategory: incomeByCategory },
    expenses: { total: stats.totalExpenses, byCategory: expensesByCategory },
    trustDeferredIncome: stats.trustDeferredIncome,
    netProfit,
    profitMargin,
    comparison: { prevNetProfit, changePercent },
    yearToDate: {
      income: stats.yearIncome,
      expenses: stats.yearExpenses,
      trustDeferredIncome: stats.yearTrustDeferredIncome,
      netProfit: stats.yearNetProfit,
    },
  };
}

/**
 * Generate monthly trend data for the last N months
 */
export async function generateMonthlyTrend(months: number = 12): Promise<MonthlyTrendData[]> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const { entries } = await getAccountingEntries({ startDate, endDate, limit: 50000 });

  const monthMap: Record<string, { income: number; expenses: number }> = {};

  // Initialize all months
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap[key] = { income: 0, expenses: 0 };
  }

  for (const entry of entries) {
    const d = new Date(entry.entryDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthMap[key]) continue;
    const amount = Number(entry.amount);
    if (entry.entryType === "income") {
      monthMap[key].income += amount;
    } else {
      monthMap[key].expenses += amount;
    }
  }

  // Per-month trust-deferred (CST §17550) so the trend's netProfit uses the
  // SAME convention as the headline stats — otherwise this service would still
  // hold two netProfit formulas (the thing PKG-C is collapsing). Scoped to each
  // month's own deposits (depositSince=month-01). Reuses the canonical helper
  // via a dynamic import (db ↔ trustDeferral cycle). Flag-gated: when off, no
  // extra queries run and every month stays gross.
  const deferredByMonth: Record<string, number> = {};
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import("./trustDeferralService");
    if (isTrustDeferralEnabled()) {
      const keys = Object.keys(monthMap);
      const totals = await Promise.all(
        keys.map((k) => {
          const [y, m] = k.split("-").map(Number);
          const lastDay = new Date(y, m, 0).getDate(); // m is 1-based → day 0 of next = last of this
          return totalDeferredForUser({
            depositSince: `${k}-01`,
            asOfDate: `${k}-${String(lastDay).padStart(2, "0")}`,
          });
        })
      );
      keys.forEach((k, i) => { deferredByMonth[k] = totals[i]; });
    }
  } catch (err) {
    console.warn("[financialReport] monthly trust deferral lookup failed (gross):", (err as Error)?.message);
  }

  return foldMonthlyTrend(monthMap, deferredByMonth);
}

/**
 * Pure fold of month buckets → sorted trend rows with trust-aware netProfit.
 * Split out (PKG-C, 2026-05-30) so the per-month formula
 *   netProfit = income − trustDeferred − expenses
 * is unit-testable without a DB. `deferredByMonth` defaults to empty → gross.
 */
export function foldMonthlyTrend(
  buckets: Record<string, { income: number; expenses: number }>,
  deferredByMonth: Record<string, number> = {}
): MonthlyTrendData[] {
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { income, expenses }]) => {
      const trustDeferredIncome = deferredByMonth[month] ?? 0;
      return {
        month,
        income,
        expenses,
        trustDeferredIncome,
        netProfit: income - trustDeferredIncome - expenses,
      };
    });
}

/**
 * Generate tax summary for a given year
 */
export async function generateTaxSummary(year: number): Promise<TaxSummary> {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31, 23, 59, 59);

  const { entries } = await getAccountingEntries({ startDate, endDate, limit: 50000 });

  let totalIncome = 0;
  let totalExpenses = 0;
  let taxDeductibleExpenses = 0;
  let nonDeductibleExpenses = 0;
  const byTaxCategory: Record<string, number> = {};

  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.entryType === "income") {
      totalIncome += amount;
    } else {
      totalExpenses += amount;
      if (entry.isTaxDeductible) {
        taxDeductibleExpenses += amount;
        const cat = entry.taxCategory ?? entry.category;
        byTaxCategory[cat] = (byTaxCategory[cat] ?? 0) + amount;
      } else {
        nonDeductibleExpenses += amount;
      }
    }
  }

  return {
    year,
    totalIncome,
    totalExpenses,
    taxDeductibleExpenses,
    nonDeductibleExpenses,
    estimatedTaxableIncome: totalIncome - taxDeductibleExpenses,
    byTaxCategory,
  };
}

/**
 * Generate CSV export for accounting entries
 */
export function generateAccountingCsv(entries: AccountingEntry[]): string {
  const headers = [
    "日期",
    "類型",
    "類別",
    "說明",
    "金額",
    "幣別",
    "可扣稅",
    "稅務類別",
    "備註",
    "建立時間",
  ];

  const rows = entries.map((entry) => {
    const date = new Date(entry.entryDate).toLocaleDateString("zh-TW");
    const type = entry.entryType === "income" ? "收入" : "支出";
    const category = CATEGORY_LABELS[entry.category] ?? entry.category;
    const amount = Number(entry.amount).toFixed(2);
    const deductible = entry.isTaxDeductible ? "是" : "否";
    const createdAt = new Date(entry.createdAt).toLocaleDateString("zh-TW");

    return [
      date,
      type,
      category,
      `"${(entry.description ?? "").replace(/"/g, '""')}"`,
      amount,
      entry.currency,
      deductible,
      entry.taxCategory ?? "",
      `"${(entry.notes ?? "").replace(/"/g, '""')}"`,
      createdAt,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Generate financial dashboard data
 */
export async function generateFinancialDashboard(
  startDate: Date,
  endDate: Date
): Promise<FinancialDashboard> {
  const [stats, monthlyTrend, { entries }] = await Promise.all([
    getAccountingStats({ startDate, endDate }),
    generateMonthlyTrend(12),
    getAccountingEntries({ startDate, endDate, limit: 50000 }),
  ]);

  const expenseByCategory: Record<string, number> = {};
  const incomeByCategory: Record<string, number> = {};

  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.entryType === "expense") {
      expenseByCategory[entry.category] = (expenseByCategory[entry.category] ?? 0) + amount;
    } else {
      incomeByCategory[entry.category] = (incomeByCategory[entry.category] ?? 0) + amount;
    }
  }

  const topExpenseCategories = Object.entries(expenseByCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({
      category: CATEGORY_LABELS[category] ?? category,
      amount,
      percentage: stats.totalExpenses > 0 ? (amount / stats.totalExpenses) * 100 : 0,
    }));

  const topIncomeCategories = Object.entries(incomeByCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({
      category: CATEGORY_LABELS[category] ?? category,
      amount,
      percentage: stats.totalIncome > 0 ? (amount / stats.totalIncome) * 100 : 0,
    }));

  return {
    stats,
    monthlyTrend,
    topExpenseCategories,
    topIncomeCategories,
  };
}

export { CATEGORY_LABELS };
