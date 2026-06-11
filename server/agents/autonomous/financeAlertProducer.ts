/**
 * financeAlertProducer — 指揮中心 財務頁 producer (P4).
 *
 * Five alert builders, each scanning one class of financial anomaly. Every
 * builder returns `FinanceAlertPayload | null` (null = normal, no task). When
 * non-null, `produceFinanceAlerts` funnels them through createApprovalTask on
 * the "finance" lane with riskLevel = "review" (always — see classifier).
 *
 * Data comes from existing financial services (dynamic import — never pulled
 * into the router's eager module graph). If a service call fails or returns
 * no data, the corresponding check returns null (skip gracefully).
 *
 * 鐵律: this module is READ-ONLY. It never writes to the ledger, never
 * initiates transactions, never moves money. It only READS financial state
 * and creates informational approval tasks.
 */

import {
  createApprovalTask,
  findPendingApprovalTask,
  type ApprovalAuditCtx,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";
import { classifyFinanceAlertRisk } from "./financeAlertClassifier";
import { FINANCE_ALERT_TASK_TYPE } from "./financeExecutor";

const log = createChildLogger({ module: "financeAlertProducer" });

// ── Payload shape ─────────────────────────────────────────────────────────

export type FinanceAlertType =
  | "stripe_mismatch"
  | "profit_drop"
  | "unclassified_pileup"
  | "trust_anomaly"
  | "supplier_mismatch";

export type FinanceAlertSeverity = "info" | "warning" | "critical";

export interface FinanceAlertPayload {
  alertType: FinanceAlertType;
  severity: FinanceAlertSeverity;
  headline: string;
  details: string;
  metric?: number;
  threshold?: number;
  period?: string;
  actionSuggestion?: string;
}

// ── Configurable thresholds ───────────────────────────────────────────────

/** Profit must drop more than this % to trigger an alert. */
export const PROFIT_DROP_THRESHOLD_PCT = 20;
/** Uncategorized transaction count above this triggers an alert. */
export const UNCLASSIFIED_PILEUP_THRESHOLD = 10;
/** Trust deferred amount above this (USD) flags for review. */
export const TRUST_ANOMALY_THRESHOLD_USD = 15_000;

// ── Date helpers ──────────────────────────────────────────────────────────

function currentMonthRange(): { startDate: string; endDate: string; period: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startDate = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate, period: `${y}-${String(m + 1).padStart(2, "0")}` };
}

function previousMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const startDate = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

// ── Individual alert checks ───────────────────────────────────────────────

/**
 * Check 1: Stripe reconciliation discrepancies.
 * Reads from reconciliationService.runReconciliation for the current month.
 */
export async function checkStripeMismatch(): Promise<FinanceAlertPayload | null> {
  try {
    const { runReconciliation } = await import(
      "../../services/reconciliationService"
    );
    const { startDate, endDate, period } = currentMonthRange();
    const report = await runReconciliation(
      new Date(startDate),
      new Date(endDate),
    );

    const highDiscrepancies = report.discrepancies.filter(
      (d) => d.severity === "high",
    );

    if (highDiscrepancies.length === 0) return null;

    const totalDiscrepancies = report.discrepancies.length;
    return {
      alertType: "stripe_mismatch",
      severity: highDiscrepancies.length >= 3 ? "critical" : "warning",
      headline: `Stripe reconciliation: ${highDiscrepancies.length} high-severity discrepancies`,
      details: highDiscrepancies
        .slice(0, 5)
        .map((d) => `[${d.severity}] ${d.type}: ${d.description}`)
        .join("\n"),
      metric: highDiscrepancies.length,
      threshold: 0,
      period,
      actionSuggestion:
        totalDiscrepancies > highDiscrepancies.length
          ? `${totalDiscrepancies} total discrepancies. Review the Reconciliation tab for details.`
          : "Review the Reconciliation tab for details.",
    };
  } catch (err) {
    log.warn({ err }, "[financeAlertProducer] checkStripeMismatch failed, skipping");
    return null;
  }
}

/**
 * Check 2: Net profit dropped vs. last month.
 * Compares current-month vs previous-month P&L from bankPLService.
 */
export async function checkProfitDrop(): Promise<FinanceAlertPayload | null> {
  try {
    const { generateBankPL } = await import(
      "../../services/bankPLService"
    );
    const cur = currentMonthRange();
    const prev = previousMonthRange();

    const [curPL, prevPL] = await Promise.all([
      generateBankPL({ startDate: cur.startDate, endDate: cur.endDate }),
      generateBankPL({ startDate: prev.startDate, endDate: prev.endDate }),
    ]);

    // No previous data to compare against.
    if (prevPL.netProfit === 0) return null;

    const dropPct =
      ((prevPL.netProfit - curPL.netProfit) / Math.abs(prevPL.netProfit)) * 100;

    if (dropPct < PROFIT_DROP_THRESHOLD_PCT) return null;

    const severity: FinanceAlertSeverity =
      dropPct >= 50 ? "critical" : "warning";

    return {
      alertType: "profit_drop",
      severity,
      headline: `Net profit dropped ${dropPct.toFixed(1)}% vs last month`,
      details: [
        `Current month: $${curPL.netProfit.toFixed(2)}`,
        `Previous month: $${prevPL.netProfit.toFixed(2)}`,
        `Drop: ${dropPct.toFixed(1)}% (threshold: ${PROFIT_DROP_THRESHOLD_PCT}%)`,
      ].join("\n"),
      metric: dropPct,
      threshold: PROFIT_DROP_THRESHOLD_PCT,
      period: cur.period,
      actionSuggestion:
        "Review P&L breakdown in the Finance tab to identify the cause.",
    };
  } catch (err) {
    log.warn({ err }, "[financeAlertProducer] checkProfitDrop failed, skipping");
    return null;
  }
}

/**
 * Check 3: Uncategorized/needs-review transactions piling up.
 * Reads needsReviewCount from bankPLService for the current month.
 */
export async function checkUnclassifiedPileup(): Promise<FinanceAlertPayload | null> {
  try {
    const { generateBankPL } = await import(
      "../../services/bankPLService"
    );
    const { startDate, endDate, period } = currentMonthRange();
    const pl = await generateBankPL({ startDate, endDate });

    const count = pl.needsReviewCount;
    if (count < UNCLASSIFIED_PILEUP_THRESHOLD) return null;

    return {
      alertType: "unclassified_pileup",
      severity: count >= 30 ? "critical" : "warning",
      headline: `${count} bank transactions need classification`,
      details: [
        `${count} transactions in the current period remain uncategorized.`,
        `Uncategorized amount: $${pl.needsReviewAmount.toFixed(2)}`,
        `Threshold: ${UNCLASSIFIED_PILEUP_THRESHOLD} transactions`,
      ].join("\n"),
      metric: count,
      threshold: UNCLASSIFIED_PILEUP_THRESHOLD,
      period,
      actionSuggestion:
        "Open the Bank Ledger and classify pending transactions, or run the accounting agent batch.",
    };
  } catch (err) {
    log.warn({ err }, "[financeAlertProducer] checkUnclassifiedPileup failed, skipping");
    return null;
  }
}

/**
 * Check 4: Trust account balance anomaly.
 * Uses totalDeferredForUser (aggregate across all trust accounts).
 */
export async function checkTrustAnomaly(): Promise<FinanceAlertPayload | null> {
  try {
    const { totalDeferredForUser, isTrustDeferralEnabled } = await import(
      "../../services/trustDeferralService"
    );
    if (!isTrustDeferralEnabled()) return null;

    const { endDate, period } = currentMonthRange();
    const deferred = await totalDeferredForUser({ asOfDate: endDate });

    if (deferred < TRUST_ANOMALY_THRESHOLD_USD) return null;

    return {
      alertType: "trust_anomaly",
      severity: deferred >= 30_000 ? "critical" : "warning",
      headline: `Trust account deferred balance: $${deferred.toFixed(2)}`,
      details: [
        `Total unrecognized customer deposits (Trust #5442): $${deferred.toFixed(2)}`,
        `Threshold: $${TRUST_ANOMALY_THRESHOLD_USD.toLocaleString()}`,
        "These are customer prepayments not yet recognized as income (CST §17550).",
      ].join("\n"),
      metric: deferred,
      threshold: TRUST_ANOMALY_THRESHOLD_USD,
      period,
      actionSuggestion:
        "Review the Trust Compliance tab. Check if any departed bookings need manual recognition.",
    };
  } catch (err) {
    log.warn({ err }, "[financeAlertProducer] checkTrustAnomaly failed, skipping");
    return null;
  }
}

/**
 * Check 5: Supplier payment reconciliation mismatch.
 * v1: reads from reconciliationService discrepancies, filtering for
 * supplier-related types. Returns null if no supplier discrepancies found
 * (the reconciliation service may not yet tag supplier-specific types).
 */
export async function checkSupplierPaymentMismatch(): Promise<FinanceAlertPayload | null> {
  try {
    const { runReconciliation } = await import(
      "../../services/reconciliationService"
    );
    const { startDate, endDate, period } = currentMonthRange();
    const report = await runReconciliation(
      new Date(startDate),
      new Date(endDate),
    );

    // Filter for supplier-related discrepancies (by type substring match).
    const supplierDisc = report.discrepancies.filter(
      (d) =>
        d.type.toLowerCase().includes("supplier") ||
        d.type.toLowerCase().includes("payment") ||
        d.description.toLowerCase().includes("supplier"),
    );

    if (supplierDisc.length === 0) return null;

    const highCount = supplierDisc.filter((d) => d.severity === "high").length;

    return {
      alertType: "supplier_mismatch",
      severity: highCount > 0 ? "warning" : "info",
      headline: `${supplierDisc.length} supplier payment discrepancies found`,
      details: supplierDisc
        .slice(0, 5)
        .map((d) => `[${d.severity}] ${d.description}`)
        .join("\n"),
      metric: supplierDisc.length,
      period,
      actionSuggestion:
        "Cross-check supplier invoices against the Reconciliation tab.",
    };
  } catch (err) {
    log.warn(
      { err },
      "[financeAlertProducer] checkSupplierPaymentMismatch failed, skipping",
    );
    return null;
  }
}

// ── Main producer ─────────────────────────────────────────────────────────

/**
 * Run all five finance checks and create approval tasks for any anomalies.
 * Idempotent per alertType: a re-scan while the same alert is still PENDING
 * skips it (counted in `skipped`) instead of piling up duplicates. Returns
 * the counts of tasks produced and skipped.
 */
export async function produceFinanceAlerts(
  ctx?: ApprovalAuditCtx,
  /**
   * Test seam: inject the check set. Production callers omit it. (The five
   * real checks dynamically import their services; concurrent dynamic
   * imports are unmockable-in-aggregate under vitest, so the dedup loop is
   * tested through this override instead.)
   */
  checksOverride?: Array<() => Promise<FinanceAlertPayload | null>>,
): Promise<{ produced: number; skipped: number }> {
  const checkFns = checksOverride ?? [
    checkStripeMismatch,
    checkProfitDrop,
    checkUnclassifiedPileup,
    checkTrustAnomaly,
    checkSupplierPaymentMismatch,
  ];
  const checks = await Promise.allSettled(checkFns.map((fn) => fn()));

  const payloads: FinanceAlertPayload[] = [];
  for (const result of checks) {
    if (result.status === "fulfilled" && result.value !== null) {
      payloads.push(result.value);
    }
  }

  let produced = 0;
  let skipped = 0;
  for (const payload of payloads) {
    const { riskLevel } = classifyFinanceAlertRisk();
    try {
      const existing = await findPendingApprovalTask(
        FINANCE_ALERT_TASK_TYPE,
        "finance_alert",
        payload.alertType,
      );
      if (existing) {
        log.info(
          { existingId: existing.id, alertType: payload.alertType },
          "[financeAlertProducer] pending alert already exists, skipping",
        );
        skipped++;
        continue;
      }

      const { id } = await createApprovalTask(
        {
          lane: "finance",
          taskType: FINANCE_ALERT_TASK_TYPE,
          riskLevel,
          title: `⚠️ ${payload.headline}`,
          summary: `[${payload.severity}] ${payload.alertType}: ${payload.headline}`,
          payload: JSON.stringify(payload),
          relatedType: "finance_alert",
          relatedId: payload.alertType,
          createdBy: "FinanceAlertProducer",
        },
        ctx,
      );
      log.info(
        { id, alertType: payload.alertType, severity: payload.severity },
        "[financeAlertProducer] created finance alert task",
      );
      produced++;
    } catch (err) {
      log.error(
        { err, alertType: payload.alertType },
        "[financeAlertProducer] failed to create alert task",
      );
    }
  }

  return { produced, skipped };
}
