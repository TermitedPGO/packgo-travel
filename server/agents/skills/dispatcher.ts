/**
 * v2 Wave 3 Module 3.4 (part A) — pure skill-dispatch function.
 *
 * This is the encapsulating helper that gmailPipeline.ts will call after
 * `runInquiryAgent` returns. It wires three modules into a single
 * call site:
 *
 *   InquiryAgent (3.1)      → produces classification + confidence
 *   Skill registry  (3.2)   → maps classification → SkillOrchestrator
 *   Skill orchestrator (3.3)→ executes the skill, returns SkillResult
 *   Threshold config (3.12) → confidence gate
 *
 * Module 3.4 ships in two parts:
 *
 *   A) THIS FILE — pure function. No DB writes, no env side effects beyond
 *      reading `AGENT_CONFIDENCE_THRESHOLD`. Returns `SkillResult | null`:
 *        null      → caller should proceed with the InquiryAgent's own
 *                    draftReply (registry didn't have a match, confidence
 *                    too low, or agent already wants to escalate)
 *        ok=true   → caller persists draft + attaches PDF
 *        ok=false  → caller escalates with `reason`
 *
 *   B) FOLLOW-UP — `skillRuns` audit table + Drizzle migration + the
 *      gmailPipeline.ts integration + auto-send gates (allow-list, daily
 *      quota, circuit-breaker). Lands as a separate commit so this one
 *      stays focused + reviewable.
 *
 * Why a pure function first: lets Vitest exercise the full
 * classifier-→-registry-→-orchestrator chain with mocks alone, no DB
 * spinup. The DB writes in 3.4-B layer in additively.
 */

import { lookupSkill } from "./registry";
import type { SkillContext, SkillResult } from "./orchestrator";
import { safelyRun } from "./orchestrator";
import { getConfidenceThreshold } from "./thresholds";
import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";

export type DispatchInput = {
  /** The InquiryAgent's structured decision. */
  inquiry: InquiryAgentOutput;
  /** Raw customer email body (for skill entity extraction). */
  rawMessage: string;
  /** Customer email if known. */
  senderEmail?: string;
  /** Customer profile FK if known. */
  customerProfileId?: number;
  /** Correlation id (gmailPipeline supplies the BullMQ job id). */
  correlationId: string;
};

/**
 * The four reasons the dispatcher returns `null` (caller proceeds with
 * InquiryAgent's own draftReply, no skill output). Exported so callers
 * can branch on the reason for logging / observability if they want.
 */
export type DispatchSkipReason =
  | "no-skill-registered"
  | "confidence-below-threshold"
  | "agent-already-escalated"
  | "unknown-error";

/**
 * Wraps `SkillResult | null` with a skip-reason for null cases.
 * Returning the discriminated union directly to callers keeps the
 * existing SkillResult shape ergonomic; the skip case carries its
 * reason so observability isn't lossy.
 */
export type DispatchOutcome =
  | { kind: "skipped"; reason: DispatchSkipReason }
  | { kind: "ran"; result: SkillResult };

/**
 * Looks up the skill for the inquiry's classification and runs it,
 * subject to the confidence gate. Returns a `DispatchOutcome`:
 *
 *   - skipped/no-skill-registered    → registry didn't find a ported
 *                                      orchestrator for this intent
 *                                      (refund / complaint / unported)
 *   - skipped/confidence-below-threshold → confidence < env threshold
 *   - skipped/agent-already-escalated    → InquiryAgent already flipped
 *                                      shouldEscalate (critical urgency,
 *                                      alwaysEscalate intent, etc.)
 *   - ran                            → orchestrator was invoked; its
 *                                      SkillResult is forwarded raw
 *
 * Never throws — `safelyRun` wraps the orchestrator call so even an
 * uncaught throw inside an orchestrator surfaces as `{ ok: false }`.
 */
export async function dispatchSkillFromInquiry(
  input: DispatchInput,
): Promise<DispatchOutcome> {
  const { inquiry, rawMessage, senderEmail, customerProfileId, correlationId } =
    input;

  // Gate 1: if the InquiryAgent already wants to escalate (critical
  // urgency, refund_request, complaint, prompt-injection guard fired),
  // never auto-dispatch — preserve the escalate path.
  if (inquiry.shouldEscalate) {
    return { kind: "skipped", reason: "agent-already-escalated" };
  }

  // Gate 2: confidence floor. AGENT_CONFIDENCE_THRESHOLD env (default 80)
  // is the minimum confidence required to attempt a skill at all. Below
  // this we don't even consult the registry — caller falls back to the
  // InquiryAgent's own draftReply.
  const threshold = getConfidenceThreshold();
  if (inquiry.confidence < threshold) {
    return { kind: "skipped", reason: "confidence-below-threshold" };
  }

  // Gate 3: registry lookup. Returns null for unregistered intents
  // (refund / complaint / spam / other / general_info / booking_question)
  // AND for registered-but-not-yet-ported intents
  // (quote_request / flight_inquiry / visa_inquiry / deposit_inquiry
  // until modules 3.6 / 3.7 wire them in).
  const entry = lookupSkill(inquiry.classification);
  if (!entry) {
    return { kind: "skipped", reason: "no-skill-registered" };
  }

  // Run the orchestrator. `safelyRun` converts any thrown error inside
  // the orchestrator into `{ ok: false, needsJeff: true }`, preserving
  // the no-throw contract from module 3.3.
  const ctx: SkillContext = {
    inquiry,
    rawMessage,
    senderEmail,
    customerProfileId,
    language: inquiry.draftLanguage,
    correlationId,
  };
  const result = await safelyRun(ctx, (c) => entry.orchestrator.run(c));
  return { kind: "ran", result };
}
