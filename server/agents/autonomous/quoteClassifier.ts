/**
 * quoteClassifier — 指揮中心 報價頁 risk classifier (P2).
 *
 * Pure, dependency-free decision function that stamps every quote-lane task
 * with its approval `riskLevel`. The producer (quoteProducer.ts) calls this
 * before a quote draft lands in the 審核箱.
 *
 * 鐵律 (Jeff Q&A · CLAUDE.md 信託會計 / proposal §3):
 *   - 報價 ALWAYS returns "hard_gate". 報價碰錢 + CST §17550 信託法 → 每一筆都
 *     必須 Jeff 逐筆確認，永遠不准 bulk-approve（router 已 BLOCK hard_gate 批次）。
 *     沒有例外 — 客製遊 / 供應商團 / 有沒有 AI 估價，一律 hard_gate。
 *
 * Why a standalone module if the answer is constant? To mirror the P1 cs lane
 * (inquiryReplyClassifier.ts) so the seam is uniform across lanes, and so a
 * future policy loosening (e.g. "auto" for tiny same-currency re-quotes) has an
 * obvious, single, test-covered place to live. The input carries the signals a
 * future rule would key on; v1 ignores them and returns hard_gate.
 */

/** The only risk tier the quote lane emits in v1. Always hard_gate. */
export type QuoteRiskLevel = "hard_gate";

export interface ClassifyQuoteRiskInput {
  /** true = 客製遊 (manual quote only); false = 供應商團. Recorded, not yet used. */
  isCustomTrip: boolean;
  /** Supplier retail price (直客價), when resolved. Recorded, not yet used. */
  supplierPrice?: number;
  /** AI estimate, when available. Recorded, not yet used. */
  aiEstimate?: number;
}

export interface ClassifyQuoteRiskResult {
  riskLevel: QuoteRiskLevel;
  /** Human-readable reason the level was chosen (for audit / debugging). */
  reason: string;
}

/**
 * Decide the quote-lane riskLevel. ALWAYS "hard_gate" in v1 — there is no path
 * to "review" or "auto" for money + CST §17550 trust-law reasons.
 */
export function classifyQuoteRisk(
  _input: ClassifyQuoteRiskInput,
): ClassifyQuoteRiskResult {
  return {
    riskLevel: "hard_gate",
    reason:
      "quote lane is always hard_gate — money + CST §17550 trust law, per-item only",
  };
}
