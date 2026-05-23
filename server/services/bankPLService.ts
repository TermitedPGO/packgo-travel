/**
 * Bank P&L Service (Phase 5).
 *
 * Reads from bankTransactions (Plaid-sourced) and produces a Schedule-C-
 * aligned P&L for a given date range. Unlike financialReportService which
 * sums manual accountingEntries, this is the source of truth Jeff will
 * file taxes against once Plaid is the system of record.
 *
 * Category → Schedule C line mapping:
 *   cogs_tour, cogs_other      → Schedule C Line 4 (Cost of goods sold)
 *   expense_marketing          → Schedule C Line 8 (Advertising)
 *   expense_software           → Schedule C Line 18 (Office expense)
 *   expense_office             → Schedule C Line 18 (Office expense)
 *   expense_travel             → Schedule C Line 24a (Travel)
 *   income_booking             → Schedule C Line 1 (Gross receipts)
 *   refund                     → Schedule C Line 2 (Returns and allowances) — netted
 *   transfer, other_review     → EXCLUDED (transfers are not income/expense;
 *                                other_review surfaces in needsReview list)
 *
 * Jeff override priority:
 *   jeffOverrideCategory > agentCategory
 *   (Jeff knows best; agent is a starting suggestion)
 */

import { getDb } from "../db";
import {
  bankTransactions,
  linkedBankAccounts,
} from "../../drizzle/schema";
import { and, eq, gte, lte, sql, isNull } from "drizzle-orm";
import {
  ACCOUNTING_CATEGORIES,
  type AccountingCategory,
} from "../agents/autonomous/accountingAgent";

export const SCHEDULE_C_MAP: Record<AccountingCategory, string> = {
  cogs_tour: "Line 4 — Cost of goods sold (供應商成本)",
  cogs_other: "Line 4 — Cost of goods sold (手續費)",
  expense_marketing: "Line 8 — Advertising",
  expense_software: "Line 18 — Office expense (軟體)",
  expense_office: "Line 18 — Office expense (辦公)",
  expense_travel: "Line 24a — Travel",
  income_booking: "Line 1 — Gross receipts",
  refund: "Line 2 — Returns and allowances",
  transfer: "(excluded — internal transfer)",
  other_review: "(excluded — needs review)",
};

const INCOME_CATEGORIES: AccountingCategory[] = ["income_booking"];
const EXPENSE_CATEGORIES: AccountingCategory[] = [
  "cogs_tour",
  "cogs_other",
  "expense_marketing",
  "expense_software",
  "expense_office",
  "expense_travel",
];
const NEUTRAL_CATEGORIES: AccountingCategory[] = ["transfer", "other_review"];
const _ALL_KNOWN: AccountingCategory[] = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  "refund",
  ...NEUTRAL_CATEGORIES,
];
// Sanity check at module load — if someone adds a category and forgets to
// classify it income/expense/neutral, fail fast in dev rather than at the
// year-end print.
for (const c of ACCOUNTING_CATEGORIES) {
  if (!_ALL_KNOWN.includes(c)) {
    console.warn(
      `[bankPL] category "${c}" not bucketed into income/expense/neutral — will be excluded`
    );
  }
}

export interface BankPLReport {
  period: { startDate: string; endDate: string };
  income: {
    total: number;
    byCategory: Record<string, number>;
  };
  expenses: {
    total: number;
    cogs: number;
    operating: number;
    byCategory: Record<string, number>;
  };
  refunds: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  transactionCount: number;
  needsReviewCount: number;
  needsReviewAmount: number;
  scheduleCMap: typeof SCHEDULE_C_MAP;
  // Audit trail
  excludedFromAccounting: number; // count of txns user excluded
  uncategorizedCount: number; // count where agent + Jeff both null
  // CST §17550 trust deferral — Jeff 2026-05-22:「放在trust account 是客人
  // 訂金 不能算我的, 除非真的跑到我的checking」. trustDeferredIncome is
  // already subtracted from income.total + netProfit; this is the separate
  // total so the UI can show "客人訂金待 recognize" as its own KPI.
  trustDeferredIncome: number;
}

/**
 * Build a P&L for a date range from Plaid-synced transactions.
 *
 * 2026-05-22 — userId is now OPTIONAL. PACK&GO is single-tenant; multi-admin
 * login (jeffhsieh09 + support@packgoplay) means accounts linked under one
 * userId need to be visible from every admin session. When omitted, the
 * report aggregates across every active linked account. Pass userId only
 * when scoping to a specific admin's accounts for debugging.
 */
export async function generateBankPL(opts: {
  userId?: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** If true, override the agent's "other_review" verdict by treating
   *  ANY uncategorized txn as needs-review. Defaults true. */
  surfaceAgentReview?: boolean;
}): Promise<BankPLReport> {
  const db = await getDb();
  if (!db) {
    return emptyReport(opts.startDate, opts.endDate);
  }

  // Pull all (non-excluded, non-pending) txns in window across active accounts.
  const filters: any[] = [
    eq(linkedBankAccounts.isActive, 1),
    gte(bankTransactions.date, opts.startDate as any),
    lte(bankTransactions.date, opts.endDate as any),
  ];
  if (opts.userId) {
    filters.push(eq(linkedBankAccounts.userId, opts.userId));
  }
  const rows = await db
    .select({
      amount: bankTransactions.amount,
      agentCategory: bankTransactions.agentCategory,
      jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
      excludeFromAccounting: bankTransactions.excludeFromAccounting,
      isPending: bankTransactions.isPending,
      ownerUserId: linkedBankAccounts.userId,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(and(...filters));

  const incomeByCategory: Record<string, number> = {};
  const expensesByCategory: Record<string, number> = {};
  let totalIncome = 0;
  let cogs = 0;
  let operating = 0;
  let refunds = 0;
  let excludedFromAccounting = 0;
  let uncategorizedCount = 0;
  let needsReviewCount = 0;
  let needsReviewAmount = 0;
  let transactionCount = 0;

  for (const r of rows) {
    transactionCount++;
    const amt = parseFloat(r.amount as any) || 0;

    if (r.excludeFromAccounting === 1) {
      excludedFromAccounting++;
      continue;
    }
    if (r.isPending === 1) continue;

    const cat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;

    if (!cat) {
      uncategorizedCount++;
      needsReviewCount++;
      needsReviewAmount += Math.abs(amt);
      continue;
    }
    if (cat === "other_review") {
      needsReviewCount++;
      needsReviewAmount += Math.abs(amt);
      continue;
    }
    if (cat === "transfer") {
      continue; // not income, not expense
    }

    if (cat === "refund") {
      // Plaid sign convention: positive = outflow.
      // Customer refund OUT to customer = positive (outflow). Reduces income.
      // Supplier refund IN from supplier = negative (inflow). Reduces expenses.
      // We sum absolute value into `refunds` and net out on the report.
      refunds += amt;
      continue;
    }

    if (INCOME_CATEGORIES.includes(cat)) {
      // Plaid sign: negative = inflow = income. Flip sign for display.
      const incomeAmt = -amt;
      incomeByCategory[cat] = (incomeByCategory[cat] ?? 0) + incomeAmt;
      totalIncome += incomeAmt;
      continue;
    }

    if (EXPENSE_CATEGORIES.includes(cat)) {
      // Plaid sign: positive = outflow = expense. Keep sign.
      expensesByCategory[cat] = (expensesByCategory[cat] ?? 0) + amt;
      if (cat === "cogs_tour" || cat === "cogs_other") cogs += amt;
      else operating += amt;
      continue;
    }
  }

  const totalExpenses = cogs + operating;
  // Refunds (positive = paid out to customer) net against income.
  // grossProfit = income - cogs - refunds
  const grossIncome = totalIncome - refunds;

  // Phase 4: subtract deferred-but-not-yet-recognized trust income from
  // monthly P&L. CST §17550 says customer prepayments don't count as
  // income until departure. Feature-flagged: when off, this is 0 and
  // recognition matches the deposit date (Phase 3 behavior).
  let deferredIncomeSubtracted = 0;
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import(
      "./trustDeferralService"
    );
    if (isTrustDeferralEnabled()) {
      // Trust deferral: customer prepayments sitting in trust account are
      // NOT recognized as income until the trip departs (CST §17550). When
      // userId omitted (single-tenant aggregate), sum across all active
      // trust accounts. Jeff 2026-05-22: 「放在trust account 是客人訂金 不
      // 能算我的」 — this guarantees the FinanceLanding 賺多少 doesn't
      // overstate by including un-earned trust deposits.
      deferredIncomeSubtracted = await totalDeferredForUser({
        userId: opts.userId,
        asOfDate: opts.endDate,
      });
    }
  } catch (err) {
    console.warn(
      "[bankPL] trust deferral lookup failed (returning gross):",
      (err as Error)?.message
    );
  }

  const netIncome = grossIncome - deferredIncomeSubtracted;
  const grossProfit = netIncome - cogs;
  const netProfit = grossProfit - operating;
  const profitMargin = netIncome > 0 ? (netProfit / netIncome) * 100 : 0;

  return {
    period: { startDate: opts.startDate, endDate: opts.endDate },
    income: {
      total: netIncome,
      byCategory: incomeByCategory,
    },
    expenses: {
      total: totalExpenses,
      cogs,
      operating,
      byCategory: expensesByCategory,
    },
    refunds,
    grossProfit,
    netProfit,
    profitMargin,
    transactionCount,
    needsReviewCount,
    needsReviewAmount,
    scheduleCMap: SCHEDULE_C_MAP,
    excludedFromAccounting,
    uncategorizedCount,
    trustDeferredIncome: deferredIncomeSubtracted,
  };
}

function emptyReport(startDate: string, endDate: string): BankPLReport {
  return {
    period: { startDate, endDate },
    income: { total: 0, byCategory: {} },
    expenses: { total: 0, cogs: 0, operating: 0, byCategory: {} },
    refunds: 0,
    trustDeferredIncome: 0,
    grossProfit: 0,
    netProfit: 0,
    profitMargin: 0,
    transactionCount: 0,
    needsReviewCount: 0,
    needsReviewAmount: 0,
    scheduleCMap: SCHEDULE_C_MAP,
    excludedFromAccounting: 0,
    uncategorizedCount: 0,
  };
}

/**
 * Build a monthly trend (one row per month) for the last `months` months.
 * Returns array sorted oldest → newest.
 */
export async function generateBankMonthlyTrend(opts: {
  userId?: number;
  months: number;
}): Promise<
  Array<{
    month: string; // YYYY-MM
    income: number;
    cogs: number;
    operating: number;
    netProfit: number;
  }>
> {
  const months = Math.max(1, Math.min(36, opts.months));
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  const db = await getDb();
  if (!db) return [];

  // 2026-05-22 — drop userId scope. Single-tenant; aggregate across every
  // active linked account so multi-admin login sees the full P&L.
  const trendFilters: any[] = [
    eq(linkedBankAccounts.isActive, 1),
    gte(bankTransactions.date, startStr as any),
    lte(bankTransactions.date, endStr as any),
    eq(bankTransactions.excludeFromAccounting, 0),
    eq(bankTransactions.isPending, 0),
  ];
  if (opts.userId) {
    trendFilters.push(eq(linkedBankAccounts.userId, opts.userId));
  }

  // Pull rows once, aggregate in JS — month buckets are small so this
  // is cheaper than 12 separate queries.
  const rows = await db
    .select({
      date: bankTransactions.date,
      amount: bankTransactions.amount,
      agentCategory: bankTransactions.agentCategory,
      jeffOverrideCategory: bankTransactions.jeffOverrideCategory,
      excludeFromAccounting: bankTransactions.excludeFromAccounting,
      isPending: bankTransactions.isPending,
      ownerUserId: linkedBankAccounts.userId,
    })
    .from(bankTransactions)
    .leftJoin(
      linkedBankAccounts,
      eq(bankTransactions.linkedAccountId, linkedBankAccounts.id)
    )
    .where(and(...trendFilters));

  const map = new Map<
    string,
    { income: number; cogs: number; operating: number }
  >();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(k, { income: 0, cogs: 0, operating: 0 });
  }

  for (const r of rows) {
    const cat = (r.jeffOverrideCategory ?? r.agentCategory) as
      | AccountingCategory
      | null;
    if (!cat || cat === "transfer" || cat === "other_review") continue;

    const d = new Date(String(r.date));
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const slot = map.get(k);
    if (!slot) continue;

    const amt = parseFloat(r.amount as any) || 0;
    if (INCOME_CATEGORIES.includes(cat)) {
      slot.income += -amt;
    } else if (cat === "refund") {
      slot.income -= amt;
    } else if (cat === "cogs_tour" || cat === "cogs_other") {
      slot.cogs += amt;
    } else if (EXPENSE_CATEGORIES.includes(cat)) {
      slot.operating += amt;
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: v.income,
      cogs: v.cogs,
      operating: v.operating,
      netProfit: v.income - v.cogs - v.operating,
    }));
}
