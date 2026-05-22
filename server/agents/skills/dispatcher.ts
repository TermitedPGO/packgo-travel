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

import { eq } from "drizzle-orm";
import { lookupSkill } from "./registry";
import type { SkillContext, SkillResult } from "./orchestrator";
import { safelyRun } from "./orchestrator";
import { getConfidenceThreshold } from "./thresholds";
import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";
import { getDb } from "../../db";
import { skillRuns } from "../../../drizzle/schema";
import { storagePut } from "../../storage";
import { createChildLogger } from "../../_core/logger";

const log = createChildLogger({ module: "skill-dispatcher" });

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

// ─── DB-persisting variant ──────────────────────────────────────────────
//
// gmailPipeline calls THIS (not the pure function above) so every
// auto-dispatch attempt leaves an audit trail in `skillRuns`. The pure
// function stays exported for unit tests that want to assert flow
// without a DB.

export type PersistedDispatchOutcome =
  | { kind: "skipped"; reason: DispatchSkipReason }
  | {
      kind: "ran";
      skillRunId: number;
      result: SkillResult;
      /** S3 path when the orchestrator returned a PDF and we uploaded it. */
      pdfStoragePath?: string;
    };

export type PersistedDispatchInput = DispatchInput & {
  /** customerInteractions.id — written to skillRuns row for cross-link. */
  interactionId?: number;
};

/**
 * Like {@link dispatchSkillFromInquiry} but persists the run to
 * `skillRuns` and uploads any generated PDF to R2. The persisting writes
 * are best-effort — if the DB or storage call fails, the function logs
 * and returns the orchestrator's outcome anyway (audit hole rather than
 * data loss; the customer-facing draft is still produced).
 *
 * Returns `kind: "skipped"` for the same 3 reasons as the pure function;
 * no DB row is written in the skip case (no skill executed = nothing
 * to audit).
 *
 * Returns `kind: "ran"` with `skillRunId` (0 if the initial insert
 * failed but the orchestrator still ran), the raw `SkillResult` from
 * the orchestrator, and `pdfStoragePath` when applicable.
 */
export async function dispatchAndPersistFromInquiry(
  input: PersistedDispatchInput,
): Promise<PersistedDispatchOutcome> {
  // Reuse the gate logic from the pure function for the skip cases.
  // (Mirror the same gates here rather than calling the pure function
  // and persisting after, because we want to claim the skillRuns row
  // BEFORE invoking the orchestrator so a crashing run still has a
  // record of having started.)
  if (input.inquiry.shouldEscalate) {
    return { kind: "skipped", reason: "agent-already-escalated" };
  }
  if (input.inquiry.confidence < getConfidenceThreshold()) {
    return { kind: "skipped", reason: "confidence-below-threshold" };
  }
  const entry = lookupSkill(input.inquiry.classification);
  if (!entry) {
    return { kind: "skipped", reason: "no-skill-registered" };
  }

  // Claim the row with status='running'. If insert fails we still proceed
  // with the orchestrator — the customer-facing draft matters more than
  // the audit trail.
  const startedAt = Date.now();
  let skillRunId = 0;
  try {
    const db = await getDb();
    if (db) {
      const ins = await db.insert(skillRuns).values({
        skillId: entry.skillId,
        intent: input.inquiry.classification,
        interactionId: input.interactionId,
        customerProfileId: input.customerProfileId,
        status: "running",
      });
      skillRunId = Number((ins as unknown as Array<{ insertId?: number }>)[0]?.insertId ?? 0);
    }
  } catch (err) {
    log.warn(
      { err, intent: input.inquiry.classification, skillId: entry.skillId },
      "[dispatcher] skillRuns claim insert failed — running anyway with skillRunId=0",
    );
  }

  // Run the orchestrator.
  const ctx: SkillContext = {
    inquiry: input.inquiry,
    rawMessage: input.rawMessage,
    senderEmail: input.senderEmail,
    customerProfileId: input.customerProfileId,
    language: input.inquiry.draftLanguage,
    correlationId:
      skillRunId > 0 ? `skillRun-${skillRunId}` : input.correlationId,
  };
  const result = await safelyRun(ctx, (c) => entry.orchestrator.run(c));
  const durationMs = Date.now() - startedAt;

  // Persist outcome + upload PDF on success.
  let pdfStoragePath: string | undefined;
  try {
    if (result.ok && result.pdf && skillRunId > 0) {
      pdfStoragePath = `skill-runs/${skillRunId}/${entry.skillId}.pdf`;
      await storagePut(pdfStoragePath, result.pdf, "application/pdf");
    }
  } catch (err) {
    log.warn(
      { err, skillRunId, skillId: entry.skillId },
      "[dispatcher] PDF upload failed — orchestrator output still returned",
    );
    pdfStoragePath = undefined;
  }

  try {
    const db = await getDb();
    if (db && skillRunId > 0) {
      if (result.ok) {
        await db
          .update(skillRuns)
          .set({
            status: "succeeded",
            pdfStoragePath: pdfStoragePath ?? null,
            draftBody: result.draftBody,
            meta: result.meta as Record<string, unknown>,
            durationMs,
            completedAt: new Date(),
          })
          .where(eq(skillRuns.id, skillRunId));
      } else {
        await db
          .update(skillRuns)
          .set({
            status: result.needsJeff ? "escalated" : "failed",
            errorMessage: result.reason.slice(0, 1024),
            durationMs,
            completedAt: new Date(),
          })
          .where(eq(skillRuns.id, skillRunId));
      }
    }
  } catch (err) {
    log.warn(
      { err, skillRunId },
      "[dispatcher] skillRuns completion update failed — outcome still returned",
    );
  }

  return { kind: "ran", skillRunId, result, pdfStoragePath };
}
