/**
 * followupDraftCompliance — deterministic guard for what a follow-up draft is
 * allowed to contain before it ever reaches Jeff's review card or a customer.
 *
 * This is the cheap, reliable half of "測 AI 回應": the HARD rules a draft must
 * never break, checked in code (no LLM), so a regression breaks a test on every
 * push. The SOFT quality (warmth, no fabrication, no inferring unstated
 * relationships, mirroring Jeff's稱呼) is judged by an LLM rubric in the eval
 * runner — those need a model, this does not.
 *
 * Rules (see feedback_packgo_followup_letter_tone + feedback_no_em_dashes):
 *   - no em dash (—) or other long dashes (ASCII hyphen is fine — compounds OK)
 *   - address the customer with 您, never the informal 你
 *   - plain text only: no markdown bold / headings, no check marks / emoji
 */

export type ComplianceViolation =
  | "em_dash"
  | "informal_ni"
  | "missing_formal_you"
  | "markdown"
  | "emoji_or_check";

export interface ComplianceResult {
  ok: boolean;
  violations: ComplianceViolation[];
}

// em / en / horizontal-bar / figure dashes — NOT the ASCII hyphen "-".
const EM_DASH = /[—–―‒]/;
// markdown bold (**...**) or an ATX heading line (# ...).
const MARKDOWN = /\*\*|^#{1,6}\s/m;
// check marks + dingbats/symbols (U+2600-27BF, BMP) + astral emoji via the
// high/low surrogate ranges (covers 🎁 etc. without the unicode 'u' flag). CJK
// text + punctuation sit outside all of these.
const CHECK_OR_EMOJI = /[☀-➿]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;
const INFORMAL_NI = /你/;
const FORMAL_YOU = /您/;

/**
 * Check a draft BODY (the text that would be sent to the customer) against the
 * hard rules. Returns every violation found; ok === violations.length === 0.
 * Pure — safe to call anywhere.
 */
export function checkFollowupDraftCompliance(body: string): ComplianceResult {
  const text = body ?? "";
  const violations: ComplianceViolation[] = [];
  if (EM_DASH.test(text)) violations.push("em_dash");
  if (MARKDOWN.test(text)) violations.push("markdown");
  if (CHECK_OR_EMOJI.test(text)) violations.push("emoji_or_check");
  if (INFORMAL_NI.test(text)) violations.push("informal_ni");
  // A real letter addresses the customer; if it never says 您 (and isn't empty)
  // it failed to use the respectful form. Empty bodies are caught upstream.
  if (text.trim().length > 0 && !FORMAL_YOU.test(text)) {
    violations.push("missing_formal_you");
  }
  return { ok: violations.length === 0, violations };
}

/** One-line human summary for logs / eval reports. */
export function summarizeCompliance(r: ComplianceResult): string {
  return r.ok ? "compliant" : `violations: ${r.violations.join(", ")}`;
}
