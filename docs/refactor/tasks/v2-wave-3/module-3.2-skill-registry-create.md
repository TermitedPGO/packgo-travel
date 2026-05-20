# v2 · Wave 3 · Module 3.2 — Create static skill registry

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.2 line 264)
**Audit ref:** v2-audit-2026-05-19.md §A lines 60–67 ("Skill registry abstraction")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4h AI + 0min Jeff

## Goal

Create `server/agents/skills/registry.ts` — a **single inline TypeScript file** that maps the 12 InquiryAgent classification intents (post-module 3.1) to skill orchestrator IDs. This is the lookup table that module 3.4 (auto-dispatch) calls right after classification.

Per **D3 (locked)**: static `Map<Intent, SkillRegistryEntry>` — NOT DB-driven, NOT YAML-driven. Inline because:
- v2 ships ≤ 7 skills total; a Map is the right level of complexity
- DB-driven invites runtime-edit drift (Jeff editing prod DB to test); locked-in-code is auditable via git
- Static map = tsc gate catches typos at build time

## Pre-requisites

- **Module 3.1 must land first.** This registry references the 5 new intents from 3.1's enum extension. If 3.1 isn't merged, the `Intent` type won't include them and tsc fails.
- **Module 3.3 (orchestrator interface) must land in parallel or first.** The registry's value type is `SkillRegistryEntry` which references `SkillOrchestrator` from 3.3. Recommended order: 3.1 → 3.3 → 3.2 → 3.4. Supervisor may dispatch 3.2 and 3.3 in parallel if the orchestrator-interface dispatch is ready.

## Inputs (read these before executing)

1. Post-3.1 `server/agents/autonomous/inquiryAgent.ts` lines 131-141 (the extended 12-value enum)
2. `server/agents/skills/tourComparison.ts` — the only existing orchestrator. Skim the `runTourComparison` signature; the new `SkillOrchestrator` interface (module 3.3) must accommodate it.
3. `server/services/skills/` directory — confirm which skills are server-ported:
   ```bash
   ls server/services/skills/
   # Expected: quoteTemplate.ts, depositTemplate.ts, tourComparisonTemplate.ts (+ infra)
   ```
4. `docs/refactor/v2-plan.md` Module 3.2 line 264-281 (registry code skeleton).

## Scope (what this module owns)

- New file: `server/agents/skills/registry.ts`
- New type definitions: `SkillId` enum and `SkillRegistryEntry` interface (or import from module 3.3 if 3.3 lands first)
- Static `skillRegistry` Map keyed by Intent → SkillRegistryEntry
- Helper functions: `lookupSkill(intent) → entry | null` and `listRegisteredIntents()`
- Vitest test: `server/agents/skills/registry.test.ts`

This module does NOT:
- Implement any orchestrator (modules 3.6, 3.7 do)
- Call any orchestrator (module 3.4 does)
- Modify InquiryAgent (module 3.1 owns)

## Procedure

1. **Define the `SkillId` enum** (or string-union) — the canonical list of server-ported skill IDs:
   ```ts
   export type SkillId =
     | "packgo-quote"
     | "packgo-flight-ticket"
     | "packgo-tour-comparison"
     | "packgo-china-visa"
     | "packgo-deposit-receipt"
     | "packgo-tour-confirmation";
   ```
   Note: `packgo-marketing-engine`, `packgo-flight-confirmation`, `packgo-social-image` are deferred (per audit §B). Do NOT add them to `SkillId` until they're ported — keeping the type strict means tsc catches "registered but not implemented" errors.

2. **Define `SkillRegistryEntry`**:
   ```ts
   import type { SkillOrchestrator } from "./orchestrator"; // from module 3.3

   export type SkillRegistryEntry = {
     skillId: SkillId;
     displayName: string;          // e.g. "報價單 (Quote Generator)" — for Jeff's UI
     orchestrator: SkillOrchestrator;
     /** v2 ports server-side; if false, lookup returns null and inquiry escalates */
     isPorted: boolean;
   };
   ```
   If module 3.3 hasn't landed yet, temporarily inline the orchestrator signature here with a TODO and `// @ts-expect-error pending module 3.3` comment.

3. **Build the static map** keyed by intent strings:
   ```ts
   import type { InquiryClassification } from "../autonomous/inquiryAgent";

   export const skillRegistry: ReadonlyMap<InquiryClassification, SkillRegistryEntry> =
     new Map<InquiryClassification, SkillRegistryEntry>([
       ["quote_request", {
         skillId: "packgo-quote",
         displayName: "報價單 (Quote Generator)",
         orchestrator: /* import { runQuoteSkill } */ ...,
         isPorted: true,
       }],
       ["flight_inquiry", {
         skillId: "packgo-flight-ticket",
         displayName: "機票 PDF (Flight Ticket)",
         orchestrator: /* runFlightTicketSkill - module 3.6 */ ...,
         isPorted: false, // flip to true after module 3.6 ports
       }],
       ["tour_comparison_request", {
         skillId: "packgo-tour-comparison",
         displayName: "區域行程比較 (Tour Comparison)",
         orchestrator: runTourComparison, // already in server/agents/skills/tourComparison.ts
         isPorted: true,
       }],
       ["visa_inquiry", {
         skillId: "packgo-china-visa",
         displayName: "中國簽證 (China Visa)",
         orchestrator: /* runChinaVisaSkill - module 3.6 */ ...,
         isPorted: false,
       }],
       ["deposit_inquiry", {
         skillId: "packgo-deposit-receipt",
         displayName: "訂金收據 (Deposit Receipt)",
         orchestrator: /* runDepositSkill - thin wrapper around depositTemplate */ ...,
         isPorted: true, // template exists; orchestrator wraps it
       }],
       // Default — "new_inquiry" gets the broadest skill so even unclassified
       // inquiries trigger something useful.
       ["new_inquiry", {
         skillId: "packgo-tour-comparison",
         displayName: "區域行程比較 (default fallback)",
         orchestrator: runTourComparison,
         isPorted: true,
       }],
       // refund_request / complaint deliberately NOT registered — they
       // always escalate per inquiryAgent.policy.alwaysEscalate.
     ]);
   ```

4. **Export `lookupSkill(intent)`**:
   ```ts
   export function lookupSkill(
     intent: InquiryClassification
   ): SkillRegistryEntry | null {
     const entry = skillRegistry.get(intent);
     if (!entry) return null;
     // Not-yet-ported skills: return null so caller can escalate gracefully.
     // Log once per session (caller's responsibility) for Jeff visibility.
     if (!entry.isPorted) return null;
     return entry;
   }
   ```

5. **Export `listRegisteredIntents()`** for admin UI / debugging:
   ```ts
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
   ```

6. **Write Vitest `registry.test.ts`** with 7+ cases:
   - 5 cases: each new intent → expected `SkillId`
   - 1 case: `refund_request` → `null` (intentionally not registered)
   - 1 case: `spam` → `null`
   - 1 case: unported intent (e.g., flight_inquiry pre-3.6) → `null` (because `isPorted: false`)
   - 1 case: `new_inquiry` → falls back to tour-comparison
   - Bonus: `listRegisteredIntents()` returns ≥ 6 entries

## Acceptance Criteria

- [ ] `server/agents/skills/registry.ts` exists with the typed Map
- [ ] `SkillId` type is strict (only ported skills; no `string` fallback)
- [ ] `lookupSkill` returns `null` for unregistered AND unported intents
- [ ] All 5 new intents have a registry entry
- [ ] `refund_request` and `complaint` are deliberately NOT registered (escalate path)
- [ ] `server/agents/skills/registry.test.ts` exists with 7+ passing Vitest cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test registry` passes
- [ ] No `any` types in the file (audit §A: strict typing)

## Deliverable

- New: `server/agents/skills/registry.ts` (~80 LOC)
- New: `server/agents/skills/registry.test.ts` (~70 LOC, 7+ cases)

Commit message:
```
feat(agents): Wave 3 Module 3.2 — static skill registry for auto-dispatch

Per D3 locked decision: inline Map<Intent, SkillRegistryEntry> in
server/agents/skills/registry.ts. NOT DB-driven; static = auditable via
git and tsc-gated against typos.

Maps the 5 new sub-intents (module 3.1) to skill orchestrators. Unported
skills (flight_ticket, china_visa pending modules 3.6/3.7) carry
isPorted=false; lookupSkill returns null so caller escalates gracefully.
refund_request/complaint deliberately not registered (alwaysEscalate
path).

7+ Vitest cases per CLAUDE.md §九 hard requirement.

Refs: docs/refactor/tasks/v2-wave-3/module-3.2-skill-registry-create.md
```

## Rollback

- Single revert. New file, no existing code edited. Zero behavior change.

## Manual intervention

- **None.** Fully autonomous.

## Test plan

- 7+ Vitest cases as enumerated above. All run in-process; no LLM, no DB, no network.

## Decisions needed (Jeff)

1. **`displayName` strings** — used in any future admin UI showing "which skill ran on this inquiry". Examples above are 50/50 zh-TW/en. Jeff may want zh-TW-only or split into a translation file. Default: bilingual as shown.
2. **Default skill for `general_info`** — current draft skips it (no registry entry, will escalate). Alternative: route to `packgo-tour-comparison` so even informational asks get a catalog response. Recommend default: **skip** (don't auto-send a catalog to someone who just asked "how are you"; escalate to Jeff).

(Module proceeds with the proposed mapping if Jeff defers.)
