# Phase 1 · Module 2 · Cluster A — Autonomous Agents tsc Drift

**Parent plan:** docs/refactor/plan.md (Phase 1 · tsc Error Cleanup)
**Audit ref:** P0-3, P0-5
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.3 h Jeff review

## Goal
Eliminate all tsc errors under `server/agents/autonomous/*` and `server/agents/contentAnalyzerAgent.ts` — **14 errors** across 5 files (13 owned by this module + 1 inherited resolution from module 1). All schema drift or LLM-shape drift. NO file splits, NO restructuring; this module is a surgical type-fix.

## Pre-requisites
- **Module 1 (tsconfig fix) MUST be merged first.** It clears 4 of this cluster's errors automatically (`selfRetrospective.ts:219-224` TS2802 + implicit-anys).
- Phase 0 complete, working tree clean.
- This module runs in parallel with module 3 (routers.ts) and module 4 (services + admin); no file overlap.

## Inputs (read these before executing)
- `server/agents/autonomous/agentTools.ts` lines 280-310 (the failing `list_recent_bookings` case)
- `server/agents/autonomous/opsActions.ts` lines 300-325 (`bookings.notes` write)
- `server/agents/autonomous/opsAgent.ts` lines 265-280 (`tours.days`) and lines 405-420 (`InvokeResult.content`)
- `server/agents/autonomous/selfRetrospective.ts` lines 215-230 (Map iteration + implicit anys)
- `server/agents/contentAnalyzerAgent.ts` lines 230-245 (single implicit-any)
- `drizzle/schema.ts` lines 395-715 — **canonical bookings + tours schema**. Confirmed columns:
  - `bookings`: `bookingStatus` (NOT `status`), `numberOfAdults` (NOT `adults`), `customerEmail` (NOT `contactEmail`), `customerName` (NOT `contactName`), `message` (NOT `notes`)
  - `tours`: `duration` (NOT `days`), `price` (NOT `priceUsd`)
- `server/_core/llm.ts` — confirm `InvokeResult` shape (does it have `.content`? if not, what's the field name — `.text`? `.output`?)

## The 14 errors this module owns (verify each is cleared — 13 owned + 1 inherited from module 1)

### A1. `server/agents/autonomous/agentTools.ts` — bookings schema drift (5 errors)
- **L291:** `bookings.status` → should be `bookings.bookingStatus`
- **L297:** `bookings.status` (in `.select({})`) → `bookings.bookingStatus` (rename projection key too, or rename caller field)
- **L299:** `bookings.adults` → `bookings.numberOfAdults`
- **L301:** `bookings.contactEmail` → `bookings.customerEmail`
- **L302:** `bookings.contactName` → `bookings.customerName`

**Fix decision:** Code-stale. Schema is canonical. Rename code references.

**Caveat:** The `.select({ status: ..., adults: ..., contactEmail: ..., contactName: ... })` shape determines the runtime row shape returned to the LLM agent. Changing the projection KEYS (left-hand side) would alter the JSON the agent reads. Decide between:
  - **Option A (recommended):** Keep the projection keys as `status/adults/contactEmail/contactName` (agent-facing API stays stable) but point the right-hand side at the correct columns: `status: bookings.bookingStatus`, `adults: bookings.numberOfAdults`, etc. This preserves the autonomous agent prompts that already reference those keys.
  - **Option B:** Rename projection keys too (`bookingStatus: bookings.bookingStatus`). Cleaner but breaks the agent's expected JSON shape — would need to grep prompts/tools for any string mention of `"status"`, `"adults"`, etc. and update them.

**Recommendation:** Option A. Add a comment above the `.select` noting "projection keys are agent-facing tool API names; right-hand side is canonical schema column".

### A2. `server/agents/autonomous/opsActions.ts:316` — booking insert with non-existent `notes` field (2 errors)
- TS2353 `Object literal may only specify known properties, and 'notes' does not exist in type ...`
- TS2339 `Property 'notes' does not exist on type ...`

**Fix decision:** Schema has `message` (text) and `payments.notes`; bookings table itself has no `notes`. Two options:
  - **Option A (recommended):** Replace `notes:` with `message:` in the insert object at line 316 — matches existing usage convention.
  - **Option B (schema-side):** Add `notes` column to `bookings` table (drizzle/0070_add_bookings_notes.sql). Justified only if the `notes` use-case differs semantically from `message` (e.g., admin-only operational notes vs customer message). Requires Jeff approval and a migration.

**Recommendation:** Read the surrounding context at opsActions.ts:300-325 — if the `notes` value is sourced from a customer-facing field (inquiry text), use `message`. If it's an admin-action audit string, escalate to supervisor for Option B decision.

### A3. `server/agents/autonomous/opsAgent.ts:273` — `tours.days` (1 error)
- TS2339 `Property 'days' does not exist on type ... tours ...`

**Fix decision:** Code-stale. Schema column is `duration` (line 418, `int notNull, in days`). Replace `tours.days` → `tours.duration`. Verify the call site reads the value as "number of days" — it does (the schema comment says `// in days`).

### A4. `server/agents/autonomous/opsAgent.ts:411` — `InvokeResult.content` (1 error)
- TS2339 `Property 'content' does not exist on type 'InvokeResult'.`

**Fix decision:** LLM-shape drift. Read `server/_core/llm.ts` to find the canonical field name of `InvokeResult`. Likely `.text` or `.output`. Replace the property access with the correct one. If multiple possible fields exist (e.g., `.text` for plain output, `.toolCalls` for structured), choose based on what the surrounding code does with the value (string concat? JSON.parse?).

**Caveat:** This is a "code path that would crash at runtime if executed" (per audit P0-3 note). If `opsAgent.ts` line 411 is in an active code path, fixing the type also fixes a real runtime bug. Add a 1-line Vitest if a regression-anchor test is cheap (mock LLM, call the function, assert returned content shape is read correctly).

### A5. `server/agents/autonomous/selfRetrospective.ts:219,220,224,224` — Map iteration + implicit any (4 errors)
- L219 TS2802: `MapIterator<[string, Outcome[]]>` (cleared by module 1's downlevelIteration)
- L220 TS7006: implicit-any on `o`
- L224 TS7006: implicit-any on `s` and `o`

**Fix decision:** L219 auto-resolves with module 1. L220+L224 are implicit-any in `.reduce` / `.filter` callbacks. After module 1 lands, re-run tsc:
```bash
pnpm tsc --noEmit 2>&1 | grep selfRetrospective
```
If L220/L224 remain, add explicit type annotations to the callback parameters. Read the Map's value type — `Outcome[]` per L219 — so callbacks should annotate `o: Outcome`, `s: SomeAccumulatorType`.

### A6. `server/agents/contentAnalyzerAgent.ts:236` — implicit-any on `s` (1 error)
- TS7006: `Parameter 's' implicitly has an 'any' type.`

**Fix decision:** Read the surrounding context at line 230-245. Likely a `.filter`/`.map`/`.reduce` callback on an array whose element type isn't being inferred. Annotate `s: <ElementType>` explicitly. If the source array's type is itself `any[]`, follow the chain back to find where the typing breaks down — that's where the real fix belongs.

## Procedure
1. **Read all 4 source files in full** (don't trust line numbers blindly — actual code may have shifted since this plan was written):
   - `server/agents/autonomous/agentTools.ts`
   - `server/agents/autonomous/opsActions.ts`
   - `server/agents/autonomous/opsAgent.ts`
   - `server/agents/autonomous/selfRetrospective.ts`
   - `server/agents/contentAnalyzerAgent.ts`

2. **Read schema.ts** (lines 395-715) to confirm bookings + tours columns.

3. **Read `server/_core/llm.ts`** to confirm `InvokeResult` shape.

4. **Apply fixes in order A1 → A2 → A3 → A4 → A5 → A6.** Each fix should be its own Edit tool call (no batching across error sites) so the diff is auditable.

5. **For A2 specifically:** before editing, look at the surrounding 20 lines and decide Option A (use `message`) vs Option B (add `notes` column). If Option B, STOP and escalate to supervisor — schema changes are NOT within this sub-agent's authority.

6. **Verify cluster cleanup:**
   ```bash
   cd /Users/jeff/Desktop/網站
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | \
     grep -E "server/agents/autonomous|server/agents/contentAnalyzerAgent" | wc -l
   ```
   Expected: **0** (post module 1 + this module).

7. **Verify no new errors elsewhere:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -cE "error TS"
   ```
   Expected: error count = (40 − 9 from module 1 − 13 from this module) = **18** remaining (for modules 3 + 4 to handle). If higher, this module introduced new errors — investigate the diff.

## Acceptance Criteria
- [ ] All 14 errors in the A1-A6 inventory above are cleared (13 owned + 1 from module 1)
- [ ] No new tsc errors introduced anywhere in the repo
- [ ] `pnpm tsc --noEmit 2>&1 | grep "server/agents/autonomous"` returns empty
- [ ] `pnpm tsc --noEmit 2>&1 | grep "server/agents/contentAnalyzerAgent"` returns empty
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] No schema changes (drizzle/schema.ts unmodified) — if a schema change was needed for A2, this module is BLOCKED and supervisor must apply schema delta + migration

## Deliverable
- Modified files: agentTools.ts, opsActions.ts, opsAgent.ts, selfRetrospective.ts, contentAnalyzerAgent.ts
- Expected total diff: roughly 12-20 lines changed (1-3 lines per error site)
- Commit message:
  ```
  fix(tsc): resolve cluster A — autonomous agents schema/LLM drift

  Closes 13 tsc errors in server/agents/autonomous/* and contentAnalyzerAgent
  (+1 additional auto-resolved by module 1's downlevelIteration):
  - agentTools.ts: rename bookings column refs (status→bookingStatus,
    adults→numberOfAdults, contactEmail→customerEmail, contactName→customerName);
    preserved agent-facing projection keys for prompt stability
  - opsActions.ts: notes → message (bookings has no notes column)
  - opsAgent.ts: tours.days → tours.duration; InvokeResult.content → <correct field>
  - selfRetrospective.ts: explicit-any annotations on .reduce/.filter callbacks
  - contentAnalyzerAgent.ts: explicit type on callback parameter

  No schema changes. No runtime behavior change (all paths previously
  unreachable due to typecheck failure — fix exposes them but does not
  alter the logic).

  Refs: docs/refactor/plan.md Phase 1 · Module 2
  Closes: 13/40 tsc errors (P0-3)
  ```

## Rollback
- Single revert (this lands as one commit): `git revert <SHA>`.
- No data risk (type-level changes only; nothing executed yet has changed shape).

## Manual intervention
- **None for code-stale fixes (A1, A3, A4, A5, A6).**
- **YES escalate for A2 if Option B (schema column add) is the correct fix.** Supervisor (not this sub-agent) owns schema.ts and creates `drizzle/0070_add_bookings_notes.sql` migration if approved.

## Test plan
- Type-only fixes; no new tests required.
- **EXCEPTION — A4 (`InvokeResult.content`)**: if the opsAgent code path at L411 was previously crashing at runtime (the audit flags it as such), add a 1-line happy-path Vitest as regression anchor:
  - File: `server/agents/autonomous/opsAgent.test.ts` (new) or appended to existing
  - Mock `invokeLLM` to return an `InvokeResult` with the correct field
  - Assert opsAgent reads the field without throwing
- **EXCEPTION — A1**: if Option B (rename projection keys) was chosen over Option A, add a snapshot test of `list_recent_bookings` return shape so future agent-prompt drift is caught at test time.
