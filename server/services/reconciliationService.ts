/**
 * reconciliationService.ts — Auto reconciliation dashboard for one-person ops.
 *
 * v78: Pulls from 4 sources and reports discrepancies in one place:
 *   1. Internal payments DB (what we recorded)
 *   2. Stripe API (what actually got charged + payouts + fees)
 *   3. accountingEntries (what hit the books)
 *   4. Manual cost entries (Anthropic, Fly, suppliers)
 *
 * Output: monthly P&L view + flagged discrepancies (paid in Stripe but not in
 * DB, or vice versa). Catches money leaks before they snowball.
 */

import Stripe from "stripe";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { payments, accountingEntries, bookings, bankTransactions } from "../../drizzle/schema";
import { and, gte, lte, sql, eq } from "drizzle-orm";

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!ENV.stripeSecretKey) return null;
  if (!_stripe) _stripe = new Stripe(ENV.stripeSecretKey, { apiVersion: "2025-09-30.clover" } as any);
  return _stripe;
}

export interface ReconciliationReport {
  period: { start: Date; end: Date };
  // Income
  internalPayments: {
    count: number;
    totalAmount: number;
    byCurrency: Record<string, number>;
  };
  stripeCharges: {
    count: number;
    totalAmount: number;
    totalFees: number;
    netToBank: number;
    byCurrency: Record<string, number>;
  } | null;
  // Costs
  costs: {
    accounting: { category: string; amount: number; count: number }[];
    estimated: { source: string; amount: number; note: string }[];
  };
  // P&L
  pnl: {
    income: number;
    stripeFees: number;
    estimatedCosts: number;
    netProfit: number;
    currency: string;
  };
  // 2026-05-22 — Plaid bank ledger view. Source of truth = real money
  // movement in the bank, independent of what PACK&GO recorded internally.
  // Empty if no Plaid accounts linked OR no bank transactions in range.
  // Categories use Jeff override → AccountingAgent → Plaid PFC (in order).
  bank: {
    enabled: boolean;
    inflowsTotal: number;
    outflowsTotal: number;
    netCashFlow: number;
    txCount: number;
    uncategorizedCount: number;
    byCategory: Array<{
      category: string;
      direction: "in" | "out";
      amount: number;
      count: number;
      source: "jeff_override" | "agent" | "plaid_pfc" | "uncategorized";
    }>;
    /** Transactions excluded from accounting (personal items Jeff flagged). */
    excludedCount: number;
  };
  // Discrepancies
  discrepancies: Array<{
    severity: "high" | "medium" | "low";
    type: string;
    description: string;
    affectedIds?: (number | string)[];
  }>;
  warnings: string[];
}

/**
 * Run a full reconciliation for the given period.
 */
export async function runReconciliation(start: Date, end: Date): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    period: { start, end },
    internalPayments: { count: 0, totalAmount: 0, byCurrency: {} },
    stripeCharges: null,
    costs: { accounting: [], estimated: [] },
    pnl: { income: 0, stripeFees: 0, estimatedCosts: 0, netProfit: 0, currency: "USD" },
    bank: {
      enabled: false,
      inflowsTotal: 0,
      outflowsTotal: 0,
      netCashFlow: 0,
      txCount: 0,
      uncategorizedCount: 0,
      byCategory: [],
      excludedCount: 0,
    },
    discrepancies: [],
    warnings: [],
  };

  const db = await getDb();
  if (!db) {
    report.warnings.push("Database unavailable");
    return report;
  }

  // 1) Internal payments
  const dbPayments = await db
    .select()
    .from(payments)
    .where(
      and(
        gte(payments.paidAt, start),
        lte(payments.paidAt, end),
        eq(payments.paymentStatus, "completed" as any)
      )
    );
  report.internalPayments.count = dbPayments.length;
  for (const p of dbPayments) {
    const amt = Number(p.amount) || 0;
    const cur = (p.currency || "USD").toUpperCase();
    report.internalPayments.totalAmount += amt;
    report.internalPayments.byCurrency[cur] = (report.internalPayments.byCurrency[cur] || 0) + amt;
  }

  // 2) Stripe ledger
  const stripe = getStripe();
  if (!stripe) {
    report.warnings.push("Stripe not configured (STRIPE_SECRET_KEY missing) — cannot pull live ledger");
  } else {
    try {
      const stripeCharges: Stripe.Charge[] = [];
      let hasMore = true;
      let startingAfter: string | undefined = undefined;
      const startTs = Math.floor(start.getTime() / 1000);
      const endTs = Math.floor(end.getTime() / 1000);
      while (hasMore && stripeCharges.length < 1000) {
        const page: Stripe.ApiList<Stripe.Charge> = await stripe.charges.list({
          created: { gte: startTs, lte: endTs },
          limit: 100,
          starting_after: startingAfter,
        });
        stripeCharges.push(...page.data);
        hasMore = page.has_more;
        startingAfter = page.data[page.data.length - 1]?.id;
        if (!startingAfter) break;
      }
      const successful = stripeCharges.filter((c) => c.status === "succeeded" && !c.refunded);
      let totalFees = 0;
      let totalAmount = 0;
      const byCurrency: Record<string, number> = {};
      for (const c of successful) {
        const cur = (c.currency || "usd").toUpperCase();
        // Stripe amounts are in smallest unit (USD cents, JPY whole)
        const zeroDecimal = ["BIF","CLP","GNF","JPY","KMF","KRW","MGA","PYG","RWF","TWD","UGX","VND","VUV","XAF","XOF","XPF"].includes(cur);
        const divisor = zeroDecimal ? 1 : 100;
        const amount = c.amount / divisor;
        const fee = (c.balance_transaction && typeof c.balance_transaction === "object" ? (c.balance_transaction as any).fee : 0) / divisor;
        totalAmount += amount;
        totalFees += fee || amount * 0.029 + 0.30; // fallback estimate if BT not expanded
        byCurrency[cur] = (byCurrency[cur] || 0) + amount;
      }
      report.stripeCharges = {
        count: successful.length,
        totalAmount,
        totalFees,
        netToBank: totalAmount - totalFees,
        byCurrency,
      };
    } catch (err) {
      report.warnings.push(`Stripe API error: ${(err as Error)?.message?.slice(0, 200)}`);
    }
  }

  // 3) Accounting entries (manual + auto)
  const aeRows = await db
    .select({
      category: accountingEntries.category,
      sum: sql<string>`SUM(${accountingEntries.amount})`,
      count: sql<number>`COUNT(*)`,
      entryType: accountingEntries.entryType,
    })
    .from(accountingEntries)
    .where(
      and(
        gte(accountingEntries.entryDate, start),
        lte(accountingEntries.entryDate, end)
      )
    )
    .groupBy(accountingEntries.category, accountingEntries.entryType);

  for (const r of aeRows) {
    if (r.entryType === "expense") {
      report.costs.accounting.push({
        category: String(r.category),
        amount: Number(r.sum) || 0,
        count: Number(r.count) || 0,
      });
    }
  }

  // 4) Discrepancy detection
  if (report.stripeCharges) {
    const stripeCount = report.stripeCharges.count;
    const dbCount = report.internalPayments.count;
    if (Math.abs(stripeCount - dbCount) > 0) {
      report.discrepancies.push({
        severity: "high",
        type: "count_mismatch",
        description: `Stripe shows ${stripeCount} successful charges, our DB has ${dbCount} completed payment rows. Difference: ${Math.abs(stripeCount - dbCount)}.`,
      });
    }

    // Per-currency amount mismatch
    for (const cur of Object.keys(report.stripeCharges.byCurrency)) {
      const stripeAmt = report.stripeCharges.byCurrency[cur] || 0;
      const dbAmt = report.internalPayments.byCurrency[cur] || 0;
      const delta = Math.abs(stripeAmt - dbAmt);
      const tolerance = stripeAmt * 0.001 + 1; // 0.1% or $1
      if (delta > tolerance) {
        report.discrepancies.push({
          severity: "high",
          type: "amount_mismatch",
          description: `${cur}: Stripe charged ${stripeAmt.toFixed(2)} but DB recorded ${dbAmt.toFixed(2)} (delta ${delta.toFixed(2)}).`,
        });
      }
    }
  }

  // Stripe fees not in accounting?
  const stripeFeeAccounting = report.costs.accounting.find((c) => c.category === "stripe_fee");
  if (report.stripeCharges && report.stripeCharges.totalFees > 0) {
    const accountedFees = stripeFeeAccounting?.amount || 0;
    if (accountedFees < report.stripeCharges.totalFees * 0.9) {
      report.discrepancies.push({
        severity: "medium",
        type: "missing_stripe_fees",
        description: `Stripe took ${report.stripeCharges.totalFees.toFixed(2)} in fees this period but only ${accountedFees.toFixed(2)} is in accounting. Add the missing fee entries to track real margin.`,
      });
    }
  }

  // 5) Compute P&L (USD only for now — multi-currency would need FX conversion)
  const incomeUSD = report.internalPayments.byCurrency["USD"] || 0;
  const stripeFeesUSD = report.stripeCharges?.totalFees || 0;
  const estimatedCostsUSD = report.costs.accounting
    .filter((c) => ["stripe_fee", "supplier_payment", "infrastructure", "marketing", "tax_payment"].includes(c.category))
    .reduce((s, c) => s + c.amount, 0);

  report.pnl = {
    income: incomeUSD,
    stripeFees: stripeFeesUSD,
    estimatedCosts: estimatedCostsUSD,
    netProfit: incomeUSD - stripeFeesUSD - estimatedCostsUSD,
    currency: "USD",
  };

  // 6) Estimated infrastructure costs (manual entries — Anthropic/Fly aren't queried via API)
  report.costs.estimated.push({
    source: "anthropic_estimate",
    amount: 0, // populated when LLM dashboard log is integrated
    note: "Pull actual from llm:stats:YYYY-MM-DD Redis hash",
  });
  report.costs.estimated.push({
    source: "fly_estimate",
    amount: 0,
    note: "Run `flyctl billing` monthly; manual entry recommended",
  });

  // 7) Plaid bank ledger (2026-05-22 addition).
  //    Pulls real bank-side transactions, groups by best-available category
  //    (Jeff override → AccountingAgent → Plaid PFC), and produces a cash-flow
  //    breakdown. This is the "source of truth" for monthly close — the
  //    internal payments / Stripe figures above describe SALES; the bank
  //    section describes ALL MONEY MOVEMENT including expenses Plaid pulled in.
  try {
    // bankTransactions.date is a DATE column — pass Date objects (Drizzle
    // serializes them to YYYY-MM-DD strings under the hood).
    // 2026-05-22: scope to active accounts only so sandbox cleanup
    // leftovers (24 First Platypus Bank accounts deactivated 2026-05-14)
    // don't pollute the bank ledger P&L.
    const { linkedBankAccounts } = await import("../../drizzle/schema");
    const activeAccountIds = (
      await db
        .select({ id: linkedBankAccounts.id })
        .from(linkedBankAccounts)
        .where(eq(linkedBankAccounts.isActive, 1))
    ).map((r) => r.id);
    const txnFilters: any[] = [
      gte(bankTransactions.date, start),
      lte(bankTransactions.date, end),
      eq(bankTransactions.isPending, 0),
    ];
    if (activeAccountIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      txnFilters.push(inArray(bankTransactions.linkedAccountId, activeAccountIds));
    }
    const txns = await db
      .select()
      .from(bankTransactions)
      .where(and(...txnFilters));

    // Skip when no Plaid accounts have ever synced
    if (txns.length === 0) {
      report.bank.enabled = false;
    } else {
      report.bank.enabled = true;
      const groups = new Map<
        string,
        { amount: number; count: number; direction: "in" | "out"; source: "jeff_override" | "agent" | "plaid_pfc" | "uncategorized" }
      >();

      for (const tx of txns) {
        if (tx.excludeFromAccounting === 1) {
          report.bank.excludedCount++;
          continue;
        }
        const amt = Number(tx.amount) || 0;
        // Plaid convention: positive = outflow (money leaving), negative = inflow.
        const direction: "in" | "out" = amt >= 0 ? "out" : "in";
        const absAmt = Math.abs(amt);

        let category: string;
        let source: "jeff_override" | "agent" | "plaid_pfc" | "uncategorized";
        if (tx.jeffOverrideCategory) {
          category = tx.jeffOverrideCategory;
          source = "jeff_override";
        } else if (tx.agentCategory) {
          category = tx.agentCategory;
          source = "agent";
        } else if (tx.plaidCategoryPrimary) {
          category = tx.plaidCategoryPrimary;
          source = "plaid_pfc";
        } else {
          category = "uncategorized";
          source = "uncategorized";
          report.bank.uncategorizedCount++;
        }

        report.bank.txCount++;
        if (direction === "in") report.bank.inflowsTotal += absAmt;
        else report.bank.outflowsTotal += absAmt;

        const key = `${category}::${direction}`;
        const existing = groups.get(key);
        if (existing) {
          existing.amount += absAmt;
          existing.count += 1;
        } else {
          groups.set(key, { amount: absAmt, count: 1, direction, source });
        }
      }

      report.bank.netCashFlow = report.bank.inflowsTotal - report.bank.outflowsTotal;
      report.bank.byCategory = Array.from(groups.entries())
        .map(([key, v]) => ({
          category: key.split("::")[0],
          direction: v.direction,
          amount: v.amount,
          count: v.count,
          source: v.source,
        }))
        .sort((a, b) => b.amount - a.amount);

      if (report.bank.uncategorizedCount > 0) {
        report.discrepancies.push({
          severity: report.bank.uncategorizedCount > 10 ? "medium" : "low",
          type: "bank_uncategorized",
          description: `${report.bank.uncategorizedCount} bank transaction(s) in this period have no category. Run the AccountingAgent or set jeff override.`,
        });
      }
    }
  } catch (e: any) {
    report.warnings.push(`bank ledger query failed: ${e?.message ?? String(e)}`);
  }

  return report;
}
