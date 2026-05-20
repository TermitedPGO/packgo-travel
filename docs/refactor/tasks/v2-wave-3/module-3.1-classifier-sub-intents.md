# v2 · Wave 3 · Module 3.1 — Add 5 sub-intents to InquiryAgent classifier

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Autonomy Thesis, Module 3.1 line 253)
**Audit ref:** v2-audit-2026-05-19.md §A lines 41–58 ("InquiryAgent sub-intent gap")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8h AI + 30min Jeff review

## Goal

Extend the InquiryAgent's classification enum from 7 → **12 sub-intents** (5 NEW values, D1-locked) so the classifier output is usable as a registry key for skill auto-dispatch (module 3.4). Existing enum values stay untouched; this is **purely additive**. Also update the system prompt with one fixture example per new intent so the LLM has concrete grounding, and extend the policy `classifications` block so each new intent has its own `minConfidence` and `action`.

The 5 new values (locked at v2-plan Stage 2 entry, do NOT re-debate):

- `quote_request` — customer asks "how much for X tour / Y dates / Z people"
- `flight_inquiry` — customer asks about flights, tickets, or compares fares
- `tour_comparison_request` — customer asks for a region catalog ("台灣 X 月有什麼團")
- `visa_inquiry` — customer asks about visa requirements or wants help applying
- `deposit_inquiry` — customer asks about deposits, payment receipts, or proofs of payment

## Pre-requisites

- Wave 1 already shipped (`logger.ts` from Module 1.2 will be the logging surface)
- Wave 2.1 `db.ts` split is **NOT required** for this module — InquiryAgent does not query `db.ts` itself; the call path is `gmailPipeline.ts → runInquiryAgent`. The gmailPipeline split into Wave 3 happens in module 3.4. So this module is parallel-safe with Wave 2.
- Schema check: `drizzle/schema.ts` line 811-815 `inquiryType` enum is unrelated (that's the inbound inquiry form type, NOT the agent classification). The agent classification is currently a plain string stored on `customerInteractions.classification` (varchar) — **no schema migration needed** for adding 5 sub-intent values. Verify by `grep -n "classification" drizzle/schema.ts | grep customerInteractions`.

## Inputs (read these before executing)

1. `server/agents/autonomous/inquiryAgent.ts` **in full** (391 LOC; the LLM tool definition at lines 124–192, the policy at lines 96–118, the system prompt at lines 194–245, and the post-LLM gate at lines 318–340 all need updates).
2. `drizzle/schema.ts` line ~600 `customerInteractions.classification` (confirm it's a varchar, not an enum). If it IS an enum, escalate — that would require a migration.
3. `server/agents/autonomous/selfRetrospective.ts` line ~150-220 — the weekly report aggregates by `classification`. New intents must appear in the report (likely zero-volume initially) — verify the aggregation isn't enum-bound.
4. `server/agents/autonomous/gmailPipeline.ts` line 240-260 — the `urgencyMap` and downstream consumers of `decision.classification`. None should break with new enum values, but confirm.

## Scope (what this module owns)

This module owns ALL of:
- Adding 5 enum values to the LLM tool schema
- Adding 5 entries to `DEFAULT_INQUIRY_POLICY.classifications` with sensible defaults
- Updating the system prompt with one example email per new intent
- Adding 5 fixture emails to a NEW `server/agents/autonomous/inquiryAgent.fixtures.ts` (or appending to existing if present)
- Writing 5 new Vitest cases (one per intent) in `server/agents/autonomous/inquiryAgent.test.ts` (NEW file — this is also module 3.8 scope; see "Coordination" below)

This module does NOT touch:
- The skill registry (module 3.2 owns)
- The dispatch wiring (module 3.4 owns)
- The DB enum for `inquiries.inquiryType` (different field; not related)

## Coordination with module 3.8

Module 3.8 owns the broader `inquiryAgent.test.ts` Vitest smoke (escalation + happy path cases). This module 3.1 contributes 5 sub-intent cases to the SAME test file. Coordination: **module 3.1 lands first** and creates the test file; **module 3.8 extends it** with escalation + classification-failure cases. The supervisor must dispatch 3.1 before 3.8.

## Procedure

1. **Read the inputs in full.** Verify no surprises (the enum block hasn't moved since the v2-audit citation).
2. **Verify schema is NOT enum-bound** for `customerInteractions.classification`:
   ```bash
   grep -A 3 "customerInteractions = mysqlTable" /Users/jeff/Desktop/網站/drizzle/schema.ts | head -30
   grep -B 2 -A 5 "classification" /Users/jeff/Desktop/網站/drizzle/schema.ts | grep -A 4 "customerInteractions\|mysqlEnum.*classification"
   ```
   If `classification` is `mysqlEnum`, **STOP and escalate** — this becomes a 2-step module (migration + code).
3. **Extend the LLM tool schema** at `inquiryAgent.ts:131-141`:
   ```ts
   classification: {
     type: "string",
     enum: [
       "new_inquiry",
       "booking_question",
       "complaint",
       "refund_request",
       "general_info",
       "spam",
       "other",
       // v2 Wave 3 module 3.1 — sub-intents enabling skill auto-dispatch
       "quote_request",
       "flight_inquiry",
       "tour_comparison_request",
       "visa_inquiry",
       "deposit_inquiry",
     ],
   },
   ```
4. **Extend `DEFAULT_INQUIRY_POLICY.classifications`** (line ~104) with 5 new entries. Recommended defaults (sensible starting point — Jeff can tune via selfRetrospective):
   ```ts
   quote_request: { action: "draft_reply", minConfidence: 75 },
   flight_inquiry: { action: "draft_reply", minConfidence: 75 },
   tour_comparison_request: { action: "draft_reply", minConfidence: 70 },
   visa_inquiry: { action: "draft_reply", minConfidence: 75 },
   deposit_inquiry: { action: "draft_reply", minConfidence: 80 },
   ```
   Rationale: `deposit_inquiry` slightly higher because financial; `tour_comparison_request` slightly lower because the catalog skill handles ambiguity well. None go to `escalate` by default; auto-dispatch (module 3.4) gates execution separately on the confidence threshold.
5. **Update the system prompt** at `inquiryAgent.ts:215-245` to enumerate all 12 sub-intents with one short example email per new intent. Keep concise — every example must fit on one line. Example block to append after line 230:
   ```
   - quote_request: 客人問「8 月帶 4 人去芝加哥要多少錢」、明確要報價單
   - flight_inquiry: 客人問「比較聯航 vs 達美的價格」、要機票截圖
   - tour_comparison_request: 客人問「日本 9 月有什麼團」、要看幾條路線
   - visa_inquiry: 客人問「中國簽證怎麼辦」、要簽證 checklist
   - deposit_inquiry: 客人問「我訂金付了嗎」、要 receipt 證明
   ```
6. **Update `selfRetrospective.ts`** if it has any hardcoded list of intents to track (e.g., a stats table). If it just `.groupBy(classification)` on the DB, no code change needed — new intents will appear automatically when they show up in data. Verify by reading lines 130–250 of `selfRetrospective.ts`.
7. **Create `server/agents/autonomous/inquiryAgent.fixtures.ts`** with one fixture per new intent:
   ```ts
   export const FIXTURE_QUOTE_REQUEST = {
     from: "test@example.com",
     subject: "請問芝加哥報價",
     body: "您好,想請問 8 月 22 日 4 大人芝加哥 5 天行程的報價,謝謝!",
   };
   // ... 4 more
   ```
8. **Create `server/agents/autonomous/inquiryAgent.test.ts`** (NEW file) with 5 Vitest cases:
   - Each case mocks `invokeLLM` to return a tool_call with the expected classification
   - Each case asserts `runInquiryAgent(fixture).classification === expectedIntent`
   - Mock pattern: `vi.mock("../../_core/llm", () => ({ invokeLLM: vi.fn() }))`
   - Reuse the mock-shape from `server/_core/stripeWebhookIdempotency.test.ts` lines 17-100 for style.

## Acceptance Criteria

- [ ] All 12 enum values present in `inquiryAgent.ts` LLM tool schema (7 existing + 5 new)
- [ ] All 5 new policy entries present in `DEFAULT_INQUIRY_POLICY.classifications`
- [ ] System prompt mentions all 5 new sub-intents with one example each
- [ ] `server/agents/autonomous/inquiryAgent.fixtures.ts` exists with 5 fixtures
- [ ] `server/agents/autonomous/inquiryAgent.test.ts` exists with **5 passing Vitest cases** (one per new intent) — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test inquiryAgent` passes
- [ ] `selfRetrospective.ts` unchanged OR change is documented (new intents naturally flow through `.groupBy`)
- [ ] No schema migration was needed (or one was created if `classification` was enum-bound — escalate if so)

## Deliverable

- Modified: `server/agents/autonomous/inquiryAgent.ts` (~20 lines added across 3 sites)
- New: `server/agents/autonomous/inquiryAgent.fixtures.ts` (~30 lines)
- New: `server/agents/autonomous/inquiryAgent.test.ts` (~60 lines, 5 cases)
- (Conditional) Modified: `server/agents/autonomous/selfRetrospective.ts` (if hardcoded list)

Commit message:
```
feat(agents): Wave 3 Module 3.1 — add 5 sub-intents to InquiryAgent classifier

Adds quote_request / flight_inquiry / tour_comparison_request /
visa_inquiry / deposit_inquiry to the LLM tool schema and policy defaults
so the classifier output is usable as a registry key for module 3.4
auto-dispatch. System prompt updated with one fixture example per new
intent. All 7 existing intents and behaviors preserved.

New Vitest test file inquiryAgent.test.ts with 5 cases (one per new intent),
mocking invokeLLM. Per CLAUDE.md §九 hard requirement.

No schema migration (customerInteractions.classification is varchar, not enum).

Refs: docs/refactor/tasks/v2-wave-3/module-3.1-classifier-sub-intents.md
```

## Rollback

- Single revert (one commit): `git revert <SHA>`.
- The 5 new intents are additive; no existing code path is altered. If the LLM somehow keeps emitting a new intent after rollback, the downstream code's `default: action: "escalate"` (line 322) catches the unknown classification safely.

## Manual intervention

- **None** if the schema check (step 2) returns "not enum-bound" — fully autonomous.
- **YES escalate** if `customerInteractions.classification` IS a `mysqlEnum` — supervisor must add a migration (`drizzle/0079_classification_subintents.sql`) before this module's code change can land.

## Test plan

- 5 new Vitest cases (each fixture → expected classification, mocked LLM)
- Optional regression: re-run existing inquiryAgent integration smoke (if Wave 2 added one)
- Manual staging smoke (deferred to Wave 3 gate): send a real `quote_request`-style email to staging Gmail integration → confirm classifier emits `quote_request`. This is a Wave 3 gate check, not a per-module ask.

## Decisions needed (Jeff)

1. **Default `minConfidence` per new intent** — values proposed above (70-80 range). If Jeff has strong opinions (e.g., wants visa_inquiry at 85 because Chinese visa missteps are costly), lock them at module dispatch.
2. **System-prompt example wording** — the 5 example email phrasings above are stylistic guesses based on Jeff's typical inbox. If Jeff has actual examples to quote, swap them in.

(Module proceeds with defaults if Jeff defers — both decisions are tunable later via selfRetrospective.)
