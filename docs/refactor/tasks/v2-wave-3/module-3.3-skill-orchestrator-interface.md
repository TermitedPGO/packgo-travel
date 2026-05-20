# v2 · Wave 3 · Module 3.3 — Define SkillOrchestrator interface

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — supports Module 3.2 line 264 + 3.4)
**Audit ref:** v2-audit-2026-05-19.md §A lines 60–67 (skill registry abstraction)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3h AI + 0min Jeff

## Goal

Define the canonical `SkillOrchestrator` interface that **every** registered skill (current tour_comparison + future quote/flight/visa/deposit/confirmation) implements. This is the value-type the registry (module 3.2) maps to and the type the dispatcher (module 3.4) calls.

Without this interface, each skill has a bespoke signature — registry stays loosely-typed (`any`), tsc can't catch mismatches, and module 3.4's dispatcher has to switch-case on skill ID. With this interface, the dispatcher is a single `await entry.orchestrator.run(ctx)` call.

## Pre-requisites

- No code dependencies. Pure type-definition module. Can land before, in parallel with, or just-after module 3.2.
- Module 3.1 helpful (so `Intent` type is final) but not blocking — orchestrator interface is intent-agnostic.

## Inputs (read these before executing)

1. `server/agents/skills/tourComparison.ts` lines 1-200 — the canonical orchestrator already exists. Its `runTourComparison(req: CatalogRequest): Promise<CatalogResult>` signature is the de-facto model. The new interface must accommodate it (refactor tourComparison to match, OR define a wrapper).
2. `server/services/skills/quoteTemplate.ts` — pure renderer; no orchestrator wraps it yet. Module 3.4 dispatcher needs a wrapper.
3. `server/services/skills/depositTemplate.ts` — same as quote.
4. `server/agents/autonomous/inquiryAgent.ts` lines 38-90 (`InquiryAgentInput`/`Output` shapes) — the dispatch context will pass these to orchestrators.

## Scope (what this module owns)

- New file: `server/agents/skills/orchestrator.ts`
- Define `SkillOrchestrator` interface
- Define `SkillContext` (input) and `SkillResult` (output) types
- Refactor `runTourComparison` to conform (or wrap it)
- Vitest: `server/agents/skills/orchestrator.test.ts` with a fake orchestrator validating the interface

## Procedure

1. **Read `tourComparison.ts`** to confirm the de-facto signature. Note `CatalogRequest` has fields (`country`, `month`, `year`, `regionCount`, etc.) that are tour-comparison-specific. The generic interface needs a wider input type.

2. **Define `SkillContext`** — the input every orchestrator receives:
   ```ts
   import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";

   export type SkillContext = {
     /** The classified inquiry that triggered dispatch */
     inquiry: InquiryAgentOutput;
     /** The raw customer email/message (for entity extraction) */
     rawMessage: string;
     /** Customer email if known */
     senderEmail?: string;
     /** Customer profile ID if known (links to customerProfiles row) */
     customerProfileId?: number;
     /** Reply language preference from inquiry classifier */
     language: "zh-TW" | "zh-CN" | "en";
     /** Correlation ID for logging */
     correlationId: string;
   };
   ```

3. **Define `SkillResult`**:
   ```ts
   export type SkillResult =
     | {
         ok: true;
         /** PDF buffer ready to attach to a draft email */
         pdf?: Buffer;
         /** Markdown/HTML body suggested for the draft email */
         draftBody: string;
         /** Skill-specific metadata for audit log */
         meta: Record<string, unknown>;
       }
     | {
         ok: false;
         /** Caller should escalate to Jeff with this reason */
         reason: string;
         /** True if Jeff intervention required (vs retryable transient) */
         needsJeff: boolean;
       };
   ```

4. **Define `SkillOrchestrator`**:
   ```ts
   export type SkillOrchestrator = {
     /** Skill identifier (matches SkillId in registry.ts) */
     id: string;
     /**
      * Execute the skill given a dispatch context.
      * MUST be deterministic given identical context (modulo LLM stochasticity);
      * MUST NOT throw — return { ok: false, reason } for known failure modes.
      * MUST complete in < 90 seconds (caller has timeout enforcement).
      */
     run(ctx: SkillContext): Promise<SkillResult>;
   };
   ```

5. **Refactor `tourComparison.ts`** so it exposes an object matching `SkillOrchestrator`:
   ```ts
   // Append to tourComparison.ts:
   export const tourComparisonOrchestrator: SkillOrchestrator = {
     id: "packgo-tour-comparison",
     async run(ctx) {
       // Extract country/month/year from ctx.rawMessage via inquiryAgent's
       // extractedCustomer fields OR a thin LLM extractor call.
       // For v2 minimum: if extraction fails, return { ok: false, needsJeff: true }.
       try {
         const req = await extractCatalogRequest(ctx);
         if (!req) return {
           ok: false,
           reason: "Could not extract country/month from inquiry",
           needsJeff: true,
         };
         const result = await runTourComparison(req);
         return {
           ok: true,
           pdf: result.pdf,
           draftBody: buildDraftBody(ctx, result),
           meta: result.meta,
         };
       } catch (err) {
         return {
           ok: false,
           reason: err instanceof Error ? err.message : String(err),
           needsJeff: true,
         };
       }
     },
   };
   ```
   The `extractCatalogRequest` and `buildDraftBody` helpers live in the same file (private). Future skills (modules 3.6, 3.7) will follow this same wrapper pattern.

6. **Write `orchestrator.test.ts`** validating the interface with a fake skill:
   - Case 1: a passing fake orchestrator → `result.ok === true`
   - Case 2: failing fake orchestrator → `result.ok === false` with `needsJeff: true`
   - Case 3: timeout/throw inside `run` is caught and converted to `{ ok: false }` (test the wrapper helper if one is added)
   - Case 4: tourComparisonOrchestrator.run with mocked deps returns shaped result

## Acceptance Criteria

- [ ] `server/agents/skills/orchestrator.ts` exists with `SkillContext`, `SkillResult`, `SkillOrchestrator` types
- [ ] `tourComparison.ts` exports `tourComparisonOrchestrator` matching the interface
- [ ] No `any` in the interface definitions
- [ ] `SkillResult` is a discriminated union (`ok: true` / `ok: false`), so callers get exhaustive checks
- [ ] `server/agents/skills/orchestrator.test.ts` exists with 4+ passing Vitest cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test orchestrator` passes
- [ ] `runTourComparison` original signature still callable (back-compat for `tools.generateTourComparison` admin endpoint)

## Deliverable

- New: `server/agents/skills/orchestrator.ts` (~80 LOC)
- New: `server/agents/skills/orchestrator.test.ts` (~80 LOC, 4+ cases)
- Modified: `server/agents/skills/tourComparison.ts` (+ ~50 LOC for orchestrator wrapper + helpers)

Commit message:
```
feat(agents): Wave 3 Module 3.3 — SkillOrchestrator interface + tourComparison conform

Defines the canonical SkillOrchestrator interface every registered skill
implements. Discriminated SkillResult union lets the dispatcher (module
3.4) handle ok/fail cases exhaustively without try/catch boilerplate.

Refactors tourComparison.ts to export `tourComparisonOrchestrator` — the
first orchestrator instance. runTourComparison's original signature kept
intact for back-compat with admin tools.generateTourComparison endpoint.

4+ Vitest cases per CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.3-skill-orchestrator-interface.md
```

## Rollback

- Single revert. New file + back-compat-preserving change to tourComparison.ts. Zero risk to runTourComparison's existing callers.

## Manual intervention

- **None.** Fully autonomous.

## Test plan

- Interface conformance tests + tourComparison wrapper smoke (mocked Lion API).

## Decisions needed (Jeff)

1. **Skill timeout default** — 90s proposed (matches LLM call ceiling + PDF render). Tunable per-skill via an optional `timeoutMs` field on `SkillRegistryEntry` (defer to v3 if not needed yet). Default: 90s, enforced by caller (module 3.4).
2. **PDF as `Buffer` vs `Uint8Array`** — Node-native is `Buffer`. RN-shared types in Wave 4 may prefer `Uint8Array`. For v2, **`Buffer`** is fine; v3 Wave 4 can re-type if needed.

(Module proceeds with proposed defaults if Jeff defers.)
