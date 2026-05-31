/**
 * financeAlertClassifier — 指揮中心 財務頁 risk classifier (P4).
 *
 * Pure, dependency-free decision function for the finance lane.
 *
 * Finance alerts are ALWAYS "review": they notify Jeff of anomalies so he can
 * look. The executor only marks them as acknowledged (status → sent). No money
 * is moved, no transactions executed, no customer communication sent.
 *
 * - NEVER "auto" — Jeff must see every financial alert.
 * - NEVER "hard_gate" — the executor doesn't touch money, so the per-item
 *   confirm toggle would be misleading.
 */

import type { RiskLevel } from "../../_core/approvalTasks";

export type FinanceRiskLevel = "review";

export interface ClassifyFinanceAlertResult {
  riskLevel: FinanceRiskLevel;
  reason: string;
}

/**
 * Classify a finance alert's risk level. Always "review" in the finance lane:
 * alerts are informational, the executor only marks them read, never moves
 * money.
 */
export function classifyFinanceAlertRisk(): ClassifyFinanceAlertResult {
  return {
    riskLevel: "review" as FinanceRiskLevel,
    reason:
      "finance alerts are always review — informational only, executor marks read",
  };
}

/** Type guard asserting the finance lane never emits auto/hard_gate. */
export function assertFinanceRiskLevel(level: RiskLevel): level is "review" {
  return level === "review";
}
