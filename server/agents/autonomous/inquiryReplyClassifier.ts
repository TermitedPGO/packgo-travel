/**
 * inquiryReplyClassifier — 指揮中心 客服頁 risk classifier (P1-c).
 *
 * Pure, dependency-free decision function that maps an InquiryAgent draft +
 * the raw inquiry text onto an approval-box `riskLevel`. The producer
 * (inquiryReplyProducer.ts) calls this to stamp every cs task before it lands
 * in the 審核箱.
 *
 * 品質公平不可犧牲 (CLAUDE.md / proposal §3 鐵律):
 *   - "hard_gate" = money / medical / political / complaint / refund — must be
 *     reviewed PER ITEM, never bulk-approved. The router already blocks bulk
 *     hard_gate; this function's only job is to flag those cases correctly.
 *   - "review"    = everything else in the cs lane.
 *   - The cs lane in v1 NEVER returns "auto" — Jeff has not enabled auto-send
 *     (design.md §7.2). Auto is reserved for a future phase once confidence is
 *     earned, and even then only on explicit policy change.
 *
 * Why keyword-based (not another LLM call): the classifier is a cheap,
 * deterministic safety net layered UNDER the agent's own classification. Even
 * if the LLM mislabels a complaint as new_inquiry, a "退款"/"refund" keyword in
 * the customer's own words still forces a hard_gate. Belt and suspenders.
 */

import type {
  Classification,
  Urgency,
} from "./inquiryAgent";

/** The two risk tiers the cs lane can emit in v1 (never "auto"). */
export type CsRiskLevel = "review" | "hard_gate";

/**
 * Sensitive-topic keyword groups. Each inbound inquiry's text is lowercased
 * and scanned for ANY of these substrings. A hit on any group → hard_gate.
 *
 * Seeded with zh-TW + zh-CN + en terms across the five categories Jeff called
 * out (醫療 / 緊急 / 政治 / 客訴 / 退款). English terms are matched
 * case-insensitively; CJK needs no case handling. Kept as plain substrings so
 * a customer writing "我要退費" or "this is a complaint" both trip the gate.
 */
export const SENSITIVE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  // 醫療 — medical / injury / hospitalization.
  medical: [
    "醫療",
    "醫院",
    "受傷",
    "住院",
    "急診",
    "生病",
    "過敏",
    "藥物",
    "救護",
    "medical",
    "hospital",
    "injury",
    "injured",
    "ambulance",
    "allergic",
    "allergy",
  ],
  // 緊急 — urgent / emergency.
  emergency: [
    "緊急",
    "急件",
    "求救",
    "危險",
    "urgent",
    "emergency",
    "asap",
  ],
  // 政治 — political / protest / unrest.
  political: [
    "政治",
    "抗議",
    "示威",
    "暴動",
    "罷工",
    "戰爭",
    "political",
    "protest",
    "riot",
    "unrest",
    "strike",
    "war",
  ],
  // 客訴 — complaint.
  complaint: [
    "投訴",
    "客訴",
    "抱怨",
    "申訴",
    "不滿",
    "差評",
    "complaint",
    "complain",
    "dissatisfied",
    "unacceptable",
  ],
  // 退款 — refund.
  refund: [
    "退款",
    "退費",
    "退錢",
    "退訂",
    "退單",
    "退回費用",
    "refund",
    "chargeback",
    "money back",
    "reimburse",
  ],
};

/**
 * Classifications that are intrinsically hard_gate regardless of keywords:
 * the agent itself already decided this is a complaint / refund request.
 */
const HARD_GATE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  "complaint",
  "refund_request",
]);

export interface ClassifyInquiryRiskInput {
  /**
   * The raw customer text to scan (subject + body recommended — the producer
   * concatenates them). May be empty; then only classification/urgency decide.
   */
  inquiryText: string;
  /** The agent's classification of the inbound message. */
  classification: Classification;
  /** The agent's urgency assessment. */
  urgency: Urgency;
}

/** Which keyword group (if any) matched — surfaced for logging / tests. */
export interface ClassifyInquiryRiskResult {
  riskLevel: CsRiskLevel;
  /** First sensitive group that matched, or null when none did. */
  matchedCategory: string | null;
  /** Human-readable reason the level was chosen (for audit / debugging). */
  reason: string;
}

/**
 * Scan text for the first sensitive keyword group that matches. Returns the
 * group name (e.g. "refund") or null. Lowercased once for the en terms.
 */
export function matchSensitiveCategory(text: string): string | null {
  const haystack = (text || "").toLowerCase();
  if (!haystack) return null;
  for (const [category, words] of Object.entries(SENSITIVE_KEYWORDS)) {
    for (const w of words) {
      if (haystack.includes(w.toLowerCase())) {
        return category;
      }
    }
  }
  return null;
}

/**
 * Decide the cs-lane riskLevel for one inquiry reply.
 *
 * hard_gate if ANY of:
 *   - a sensitive keyword (醫療/緊急/政治/客訴/退款) appears in the text, OR
 *   - classification ∈ {complaint, refund_request}, OR
 *   - urgency === "critical".
 * Otherwise → review. NEVER "auto" (v1 cs policy, design.md §7.2).
 */
export function classifyInquiryRisk(
  input: ClassifyInquiryRiskInput,
): ClassifyInquiryRiskResult {
  const matchedCategory = matchSensitiveCategory(input.inquiryText);

  if (matchedCategory) {
    return {
      riskLevel: "hard_gate",
      matchedCategory,
      reason: `sensitive keyword group "${matchedCategory}" matched`,
    };
  }

  if (HARD_GATE_CLASSIFICATIONS.has(input.classification)) {
    return {
      riskLevel: "hard_gate",
      matchedCategory: null,
      reason: `classification "${input.classification}" is always hard_gate`,
    };
  }

  if (input.urgency === "critical") {
    return {
      riskLevel: "hard_gate",
      matchedCategory: null,
      reason: "urgency is critical",
    };
  }

  return {
    riskLevel: "review",
    matchedCategory: null,
    reason: "no sensitive signal — standard per-item review",
  };
}
