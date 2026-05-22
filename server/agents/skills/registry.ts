/**
 * v2 Wave 3 Module 3.2 — static skill registry.
 *
 * D3 locked decision: inline `Map<InquiryClassification, SkillRegistryEntry>`.
 * NOT DB-driven, NOT YAML-driven. Reasons:
 *   - v2 ships ≤ 7 skills total; a Map is the right level of complexity
 *   - DB-driven invites runtime-edit drift (Jeff editing prod DB to test);
 *     locked-in-code is auditable via git
 *   - Static map = tsc gate catches typos at build time
 *
 * Consumers:
 *   - `gmailPipeline.ts` (module 3.4 auto-dispatch) calls `lookupSkill(intent)`
 *     and then `entry.orchestrator.run(ctx)` if non-null
 *   - admin UI / debug tooling calls `listRegisteredIntents()` to enumerate
 *
 * Two intents are deliberately NOT registered:
 *   - `refund_request` — always escalates per RefundAgent's
 *     `alwaysEscalate: true` constitution + DEFAULT_INQUIRY_POLICY
 *   - `complaint`     — always escalates per DEFAULT_INQUIRY_POLICY
 * `lookupSkill()` returns null for these, signaling the dispatcher to take
 * the escalate path rather than auto-dispatch.
 *
 * `flight_inquiry` and `visa_inquiry` carry `isPorted: false` until
 * modules 3.6 / 3.7 (or a follow-up) wire their orchestrators in. While
 * `isPorted: false`, `lookupSkill` returns null and the dispatcher
 * escalates — same behavior as a missing entry, but the entry stays in
 * the registry so it's visible via `listRegisteredIntents()`.
 */

import type { InquiryClassification } from "../autonomous/inquiryAgent";
import type { SkillOrchestrator } from "./orchestrator";
import { tourComparisonOrchestrator } from "./tourComparisonOrchestrator";

/**
 * The canonical list of server-ported PACK&GO skill IDs. Locked tight —
 * adding a new SkillId requires a new orchestrator landing first, so tsc
 * catches "registered but not implemented" mismatches at build time.
 */
export type SkillId =
  | "packgo-quote"
  | "packgo-flight-ticket"
  | "packgo-tour-comparison"
  | "packgo-china-visa"
  | "packgo-deposit-receipt"
  | "packgo-tour-confirmation";

export type SkillRegistryEntry = {
  skillId: SkillId;
  /** Human-readable name for admin UI / debug logs. zh-TW + (en) format. */
  displayName: string;
  /** The orchestrator instance — see `./orchestrator.ts`. */
  orchestrator: SkillOrchestrator;
  /**
   * `false` while an orchestrator hasn't been written yet (modules 3.6 / 3.7
   * pending). `lookupSkill` returns null for unported entries, so the
   * dispatcher escalates instead of auto-running an undefined skill.
   */
  isPorted: boolean;
};

/**
 * Placeholder orchestrator used for `isPorted: false` registry entries.
 * Never executed (the registry `isPorted` guard means `lookupSkill` returns
 * null before the dispatcher ever calls `.run`), but the type system needs
 * a value of shape `SkillOrchestrator`. If a coding bug ever bypasses the
 * guard, this orchestrator returns a clear ok=false so we don't crash.
 */
const PLACEHOLDER_NOT_PORTED: SkillOrchestrator = {
  id: "placeholder-not-ported",
  async run() {
    return {
      ok: false,
      reason:
        "Skill not yet ported server-side — should have been guarded by isPorted check. This is a registry bug if you see it.",
      needsJeff: true,
    };
  },
};

/**
 * The map. Static — every entry is known at compile time. Adding a new
 * intent requires:
 *   1. Adding the intent to `InquiryClassification` (module 3.1's enum)
 *   2. Writing an orchestrator (module 3.3 contract)
 *   3. Adding the SkillId here (literal-strict, so tsc enforces all 3)
 *   4. Adding the entry below
 */
export const skillRegistry: ReadonlyMap<
  InquiryClassification,
  SkillRegistryEntry
> = new Map<InquiryClassification, SkillRegistryEntry>([
  [
    "tour_comparison_request",
    {
      skillId: "packgo-tour-comparison",
      displayName: "區域行程比較 (Tour Comparison)",
      orchestrator: tourComparisonOrchestrator,
      isPorted: true,
    },
  ],
  // `new_inquiry` is the broad catch-all from the legacy 7-intent set —
  // when a customer's email doesn't match any specific sub-intent but
  // they're clearly asking about travel, fall back to the catalog skill
  // so they at least get a useful PDF instead of pure escalation.
  [
    "new_inquiry",
    {
      skillId: "packgo-tour-comparison",
      displayName: "區域行程比較 (default fallback for new_inquiry)",
      orchestrator: tourComparisonOrchestrator,
      isPorted: true,
    },
  ],
  // Pending orchestrators — keep entries visible in listRegisteredIntents()
  // so the admin UI can show "skill X is registered but pending v2.X port",
  // but lookupSkill returns null because of isPorted: false.
  [
    "quote_request",
    {
      skillId: "packgo-quote",
      displayName: "報價單 (Quote Generator) — pending port",
      orchestrator: PLACEHOLDER_NOT_PORTED,
      isPorted: false,
    },
  ],
  [
    "flight_inquiry",
    {
      skillId: "packgo-flight-ticket",
      displayName: "機票 PDF (Flight Ticket) — pending port",
      orchestrator: PLACEHOLDER_NOT_PORTED,
      isPorted: false,
    },
  ],
  [
    "visa_inquiry",
    {
      skillId: "packgo-china-visa",
      displayName: "中國簽證 (China Visa) — pending module 3.6",
      orchestrator: PLACEHOLDER_NOT_PORTED,
      isPorted: false,
    },
  ],
  [
    "deposit_inquiry",
    {
      skillId: "packgo-deposit-receipt",
      displayName: "訂金收據 (Deposit Receipt) — pending port",
      orchestrator: PLACEHOLDER_NOT_PORTED,
      isPorted: false,
    },
  ],
  // refund_request / complaint deliberately NOT registered — they always
  // escalate per RefundAgent + DEFAULT_INQUIRY_POLICY.alwaysEscalate.
]);

/**
 * Returns the registry entry for an intent IF the skill is ported.
 * Returns null when:
 *   - Intent is not in the registry (e.g. refund_request, complaint)
 *   - Intent IS in the registry but `isPorted: false` (pending port)
 *
 * The dispatcher uses this null signal to take the escalate path.
 */
export function lookupSkill(
  intent: InquiryClassification,
): SkillRegistryEntry | null {
  const entry = skillRegistry.get(intent);
  if (!entry) return null;
  if (!entry.isPorted) return null;
  return entry;
}

/**
 * Returns every registered intent regardless of port status. Used by:
 *   - Admin UI: show "5 skills registered, 4 pending port"
 *   - Debug logs: enumerate skill coverage
 *   - Vitest: assert the registry contains the expected entries
 */
export function listRegisteredIntents(): Array<{
  intent: InquiryClassification;
  skillId: SkillId;
  ported: boolean;
}> {
  return Array.from(skillRegistry.entries()).map(([intent, entry]) => ({
    intent,
    skillId: entry.skillId,
    ported: entry.isPorted,
  }));
}
