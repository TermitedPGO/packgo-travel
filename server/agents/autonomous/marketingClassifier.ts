/**
 * marketingClassifier — 指揮中心 行銷頁 risk classifier (P3).
 *
 * Pure, dependency-free decision function that maps a marketing draft's
 * metadata onto an approval-box `riskLevel`. The producer
 * (marketingProducer.ts) calls this to stamp every marketing task before it
 * lands in the 審核箱.
 *
 * v1 policy (design.md / prompt-p3-marketing §1 item 3):
 *   - "review"    = default for all marketing content (doesn't touch money).
 *   - "hard_gate" = content that includes pricing (hasPrice=true) — Jeff must
 *                   review per-item, never bulk-approved.
 *   - "auto"      = NEVER in v1. Reserved for a future phase once Jeff
 *                   trusts the output enough to skip review.
 *
 * Why not just hard-code "review"? The hasPrice gate future-proofs EDMs with
 * pricing — Jeff already identified this as the one marketing scenario that
 * touches money (CST §17550 adjacent). A single boolean keeps it cheap.
 */

/** The two risk tiers the marketing lane can emit in v1 (never "auto"). */
export type MarketingRiskLevel = "review" | "hard_gate";

export interface ClassifyMarketingRiskInput {
  /** Type of content being produced. */
  contentType: string;
  /** Whether the draft includes pricing info (e.g. EDM with tour prices). */
  hasPrice: boolean;
}

export interface ClassifyMarketingRiskResult {
  riskLevel: MarketingRiskLevel;
  reason: string;
}

/**
 * Classify the marketing draft's risk level.
 *
 * hasPrice → hard_gate (money-adjacent, per-item only).
 * Everything else → review. NEVER "auto" (v1 marketing policy).
 */
export function classifyMarketingRisk(
  input: ClassifyMarketingRiskInput,
): ClassifyMarketingRiskResult {
  if (input.hasPrice) {
    return {
      riskLevel: "hard_gate",
      reason: "content includes pricing — requires per-item confirmation",
    };
  }

  return {
    riskLevel: "review",
    reason: "standard marketing content — per-item review",
  };
}
