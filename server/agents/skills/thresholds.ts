/**
 * v2 Wave 3 Module 3.12 — agent threshold env config.
 *
 * Two integer-valued knobs (0-100) that gate the skill auto-dispatch
 * pipeline. Module 3.4 (auto-dispatch) imports these getters.
 *
 *   - AGENT_CONFIDENCE_THRESHOLD (default 80)
 *       Minimum InquiryAgent confidence required to ATTEMPT a skill
 *       lookup + run. Below this, the inquiry escalates to Jeff for
 *       manual review and the registry is bypassed entirely.
 *
 *   - AGENT_AUTO_SEND_THRESHOLD (default 90)
 *       Minimum confidence to AUTO-SEND a skill's draft to the customer
 *       (vs leave it as a draft in the office inbox). Always ≥
 *       AGENT_CONFIDENCE_THRESHOLD in practice; nothing enforces the
 *       relationship but the defaults respect it. Refund + complaint
 *       NEVER auto-send regardless — that's enforced separately in
 *       RefundAgent's alwaysEscalate constitution and the inquiry
 *       policy, not here.
 *
 * Read-on-each-call (not cached at module load) so:
 *   - Vitest can override `process.env.X` per case
 *   - Jeff can flip the value via `fly secrets set` without a redeploy
 *     (next request reads the new value)
 *
 * The 100x-per-second cost of `process.env` reads is negligible vs the
 * LLM call that precedes any dispatch.
 */

const CONFIDENCE_DEFAULT = 80;
const AUTO_SEND_DEFAULT = 90;

/**
 * Parses an env var to an integer in [0, 100]. Returns `defaultValue`
 * when missing / non-numeric / out-of-range.
 */
function parseThreshold(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  if (parsed < 0 || parsed > 100) return defaultValue;
  return parsed;
}

/**
 * Minimum InquiryAgent confidence required to ATTEMPT skill auto-dispatch.
 * Read at each call so env-var changes (or Vitest spies) take effect
 * without re-importing the module.
 */
export function getConfidenceThreshold(): number {
  return parseThreshold(
    process.env.AGENT_CONFIDENCE_THRESHOLD,
    CONFIDENCE_DEFAULT,
  );
}

/**
 * Minimum confidence to AUTO-SEND a skill draft to the customer.
 * Drafts below this threshold are saved to the office inbox for Jeff
 * to review and manually send.
 */
export function getAutoSendThreshold(): number {
  return parseThreshold(
    process.env.AGENT_AUTO_SEND_THRESHOLD,
    AUTO_SEND_DEFAULT,
  );
}

/**
 * Exposed for debug / observability — admin UI may surface "currently
 * configured: confidence=80, auto-send=90" so Jeff can spot drift.
 */
export function getCurrentThresholds(): {
  confidence: number;
  autoSend: number;
} {
  return {
    confidence: getConfidenceThreshold(),
    autoSend: getAutoSendThreshold(),
  };
}
