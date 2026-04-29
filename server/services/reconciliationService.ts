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
import { payments, accountingEntries, bookings } from "../../drizzle/schema";
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

  return report;
}
