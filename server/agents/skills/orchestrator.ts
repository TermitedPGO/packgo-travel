/**
 * v2 Wave 3 Module 3.3 — canonical SkillOrchestrator interface.
 *
 * Every server-ported PACK&GO skill (tour comparison, china visa, quote,
 * deposit, tour confirmation, flight ticket — see SkillId in registry.ts)
 * implements this interface. Two consumers:
 *
 *   - `server/agents/skills/registry.ts` — uses `SkillOrchestrator` as
 *     the value type of its `Map<Intent, SkillRegistryEntry>`.
 *   - `server/agents/autonomous/gmailPipeline.ts` (module 3.4) — calls
 *     `await entry.orchestrator.run(ctx)` after the InquiryAgent has
 *     classified an inbound email.
 *
 * Design contract (every implementor MUST honor):
 *
 *   1. Deterministic-modulo-LLM. Identical `SkillContext` should produce
 *      structurally identical output. LLM stochasticity within the body
 *      is OK; the SHAPE of the result must be stable.
 *
 *   2. Never throw. Use the discriminated `SkillResult` union to report
 *      failures: `{ ok: false, reason, needsJeff }`. The dispatcher wraps
 *      every `run()` in a try/catch as a safety net, but the contract is
 *      "handle your own failures gracefully."
 *
 *   3. Bounded latency. Each `run()` should complete in under 90 seconds.
 *      The dispatcher applies a wall-clock timeout matching that.
 *
 *   4. No mutation of `ctx`. Treat it as read-only. The dispatcher reuses
 *      the same context across the audit log + draft persistence steps.
 *
 *   5. No side effects beyond the returned `pdf` / `draftBody`. Do NOT
 *      send email, write to DB, hit Stripe, etc. — the dispatcher owns
 *      those steps so the policy (auto-send vs draft) is single-source.
 */

import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";

/**
 * Input every orchestrator receives. The dispatcher (module 3.4)
 * constructs this from the InquiryAgent's output + the inbound Gmail
 * thread's metadata.
 */
export type SkillContext = {
  /** The classified inquiry that triggered dispatch. */
  inquiry: InquiryAgentOutput;
  /** The raw customer message body (for entity extraction). */
  rawMessage: string;
  /** Customer email if known. */
  senderEmail?: string;
  /** Customer profile ID if known (FK to customerProfiles). */
  customerProfileId?: number;
  /** Reply language preference — same as `inquiry.draftLanguage`. */
  language: "zh-TW" | "zh-CN" | "en";
  /** Correlation ID for log + Sentry breadcrumb threading. */
  correlationId: string;
};

/**
 * Discriminated union — every caller gets exhaustive `ok: true | false`
 * checks at the type level. No `any`, no `try/catch` boilerplate at the
 * call site beyond the dispatcher's outer safety net.
 */
export type SkillResult =
  | {
      ok: true;
      /** PDF buffer ready to attach to the draft email. Optional —
       * not every skill produces a PDF (e.g. simple status replies). */
      pdf?: Buffer;
      /** The draft email body (markdown or plain text) that should be
       * persisted to the agentMessages row for Jeff's review / auto-send. */
      draftBody: string;
      /** Skill-specific metadata captured for the audit log + selfRetrospective.
       * Examples: `{ optionsFound: 5, supplierCodes: ["LION-12345"] }`. */
      meta: Record<string, unknown>;
    }
  | {
      ok: false;
      /** Caller (dispatcher) escalates to Jeff with this reason. */
      reason: string;
      /** True if human intervention required (vs. transient/retryable).
       * Dispatcher uses this to decide retry vs immediate escalation. */
      needsJeff: boolean;
    };

/**
 * The canonical orchestrator interface. Implementations live in
 * `server/agents/skills/<skillName>.ts` and are wired into the registry
 * via `server/agents/skills/registry.ts`.
 */
export type SkillOrchestrator = {
  /** Skill identifier — MUST match the corresponding SkillId in registry.ts. */
  id: string;
  /**
   * Execute the skill given a dispatch context.
   *
   * Contract (repeated here for callsite-grep visibility):
   *   - MUST NOT throw — catch every known failure mode and return
   *     `{ ok: false, reason, needsJeff }`.
   *   - SHOULD complete in under 90 seconds; the dispatcher applies a
   *     timeout matching that.
   *   - MUST NOT mutate `ctx` nor cause side effects beyond returning
   *     the pdf + draftBody (no email send, no DB write — those are the
   *     dispatcher's responsibility).
   */
  run(ctx: SkillContext): Promise<SkillResult>;
};

/**
 * Convenience: wraps an async function in the no-throw contract.
 * Use this when adapting an existing function that may throw — it
 * converts thrown errors into `{ ok: false }` results so the
 * `SkillOrchestrator.run` contract is preserved.
 *
 * Example:
 *   export const myOrchestrator: SkillOrchestrator = {
 *     id: "packgo-xxx",
 *     run: (ctx) => safelyRun(ctx, async (c) => { ... your logic ... }),
 *   };
 */
export async function safelyRun(
  ctx: SkillContext,
  body: (ctx: SkillContext) => Promise<SkillResult>,
): Promise<SkillResult> {
  try {
    return await body(ctx);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      needsJeff: true,
    };
  }
}
