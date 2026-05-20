# v2 · Wave 3 · Module 3.10 — Vitest smokes for 10 remaining autonomous agents

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.7 line 313)
**Audit ref:** v2-audit-2026-05-19.md §A line 80 + §I lines 519-527 (15 autonomous agents, ZERO tests)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 12h AI + 0min Jeff

## Goal

Create Vitest test files for the **10 remaining** autonomous agent files (modules 3.1/3.8 already cover `inquiryAgent`; module 3.5 created `refundAgent.test.ts` with Stripe-wire cases; this module **extends** refundAgent and creates the remaining 9). After this module lands, every file in `server/agents/autonomous/` has a `.test.ts` sibling.

Per **§九 hard requirement** + audit §A P0: every autonomous agent must have at least 1 happy-path + 1 failure-mode test.

## Agent inventory (post-module-3.5 baseline)

Confirmed via `ls server/agents/autonomous/` at 2026-05-19:

| Agent file | LOC | Already covered? | This module's responsibility |
|---|---|---|---|
| `inquiryAgent.ts` | 391 | ✅ modules 3.1 + 3.8 (10 cases) | skip |
| `gmailPipeline.ts` | 567 | ❌ | **2 cases** here |
| `selfRetrospective.ts` | 358 | ❌ | **2 cases** here |
| `agentReport.ts` | 301 | ❌ | **2 cases** here |
| `accountingAgent.ts` | 281 | ❌ | **2 cases** here |
| `followupAgent.ts` | 122 | ❌ | **2 cases** here |
| `marketingAgent.ts` | 139 | ❌ | **2 cases** here |
| `reviewAgent.ts` | 182 | ❌ | **2 cases** here |
| `refundAgent.ts` | 173 | ⚠️ module 3.5 (Stripe-wire 3 cases) | **+ 2 generic cases** here |
| `opsAgent.ts` | (large) | ❌ | **2 cases** here |
| `opsAgentStream.ts` | (paired) | ❌ | **1 case** here (light coverage; non-autonomous, admin chat UI) |
| `opsActions.ts` | (paired) | ❌ | **2 cases** here |
| `agentChat.ts` | 320 | ❌ | **1 case** here (light; non-autonomous, admin chat UI) |
| `agentTools.ts` | 485 | ❌ | **2 cases** here (tool registry validation) |
| `officeAssistant.ts` | 83 | ❌ | **1 case** here (light; non-autonomous, office UI) |

**Total new cases: ~25** across 12 new test files + 1 extended (`refundAgent.test.ts`).

## Pre-requisites

- **Module 3.5 must land first** (creates `refundAgent.test.ts`).
- **Module 3.1 + 3.8** must land first (creates `inquiryAgent.test.ts`).
- Source files are stable (no Wave 2 splits touch autonomous agents, per Wave 2 §C scope).

## Inputs (read these before executing)

For EACH agent, read the source file in full (these are 100-600 LOC each — manageable) and find:
1. The public entry function (e.g., `runAccountingAgent`, `runReviewAgent`)
2. Required input shape
3. Output shape
4. LLM call site(s) — these are the `vi.mock` targets
5. DB call site(s) — also mocked
6. The success path return
7. The failure path return (some agents throw; some return `{ok: false}`)

Reference patterns:
- `server/_core/stripeWebhookIdempotency.test.ts` — mock-DB style
- `server/agents/autonomous/inquiryAgent.test.ts` (post-3.1) — LLM-mock style

## Scope (what this module owns)

12 new test files + 1 extension:

1. `server/agents/autonomous/gmailPipeline.test.ts` (NEW)
2. `server/agents/autonomous/selfRetrospective.test.ts` (NEW)
3. `server/agents/autonomous/agentReport.test.ts` (NEW)
4. `server/agents/autonomous/accountingAgent.test.ts` (NEW)
5. `server/agents/autonomous/followupAgent.test.ts` (NEW)
6. `server/agents/autonomous/marketingAgent.test.ts` (NEW)
7. `server/agents/autonomous/reviewAgent.test.ts` (NEW)
8. `server/agents/autonomous/refundAgent.test.ts` (EXTEND — +2 generic cases)
9. `server/agents/autonomous/opsAgent.test.ts` (NEW)
10. `server/agents/autonomous/opsAgentStream.test.ts` (NEW)
11. `server/agents/autonomous/opsActions.test.ts` (NEW)
12. `server/agents/autonomous/agentChat.test.ts` (NEW)
13. `server/agents/autonomous/agentTools.test.ts` (NEW)
14. `server/agents/autonomous/officeAssistant.test.ts` (NEW)

Each: 1 happy-path test + 1 failure-mode test (except officeAssistant + opsAgentStream + agentChat which get 1 each due to lower-risk status).

Does NOT:
- Modify source code (read-only test addition)
- Touch `inquiryAgent.test.ts` (modules 3.1, 3.8 own)

## Procedure

**For EACH of the 12 NEW test files**, follow this template:

1. **Read the source file in full.**
2. **Identify** the public entry function + its input/output types.
3. **Identify** mock targets: LLM calls, DB calls, queue calls, gmail calls.
4. **Build minimal fixtures** for the happy path input.
5. **Write 1-2 cases:**
   - **Happy path:** mock everything to succeed → assert output shape.
   - **Failure path:** mock LLM to throw OR mock DB to error → assert agent catches it gracefully (returns `{ok: false}` or throws cleanly, depending on agent's design).
6. **Verify** the test runs in isolation: `pnpm test <agentName>`.

**Per-agent test sketches** (sub-agent should refine per actual source):

### gmailPipeline.test.ts (2 cases)
- **Happy:** mock `listUnreadMessages` → 1 email; mock `runInquiryAgent` → `auto_draft` outcome; verify `applyLabel` called + `customerInteractions` insert called once.
- **Failure:** mock `listUnreadMessages` to throw → returns `{ok: false}` with `errors[0]` populated; no inserts attempted.

### selfRetrospective.test.ts (2 cases)
- **Happy:** mock DB to return 50 interactionOutcomes for past week; mock LLM to return policy diff; verify `agentPolicies` update called.
- **Failure:** LLM returns invalid JSON → no policy update; `notifyOwner` mock called.

### agentReport.test.ts (2 cases)
- **Happy:** mock DB to return 50 outcomes; agent generates report; `notifyOwner` mock called with email payload containing summary.
- **Failure:** zero outcomes → report still generates ("quiet week") without crashing.

### accountingAgent.test.ts (2 cases)
- **Happy:** mock 10 uncategorized Plaid txns + LLM returns categorizations → all txns updated in DB.
- **Failure:** mid-batch LLM throw → partial batch saved + remaining queued for retry.

### followupAgent.test.ts (2 cases)
- **Happy:** mock 3 bookings overdue for follow-up → 3 emails drafted in queue (NOT sent — draft-first).
- **Failure:** booking row missing customer email → skipped silently + logged.

### marketingAgent.test.ts (2 cases)
- **Happy:** mock prompt → LLM returns marketing copy + image URL → entry persisted in marketing queue.
- **Failure:** LLM returns empty string → agent escalates.

### reviewAgent.test.ts (2 cases)
- **Happy:** mock 2 past-trip bookings → 2 review-request drafts; per draft-first, never sent.
- **Failure:** review request already sent (idempotency) → skip + log.

### refundAgent.test.ts EXTEND (+ 2 cases on top of module 3.5's 3)
- **Generic happy:** customer rawMessage from email → LLM returns triage with severity=high → output shape correct, no email sent.
- **Generic failure:** LLM returns malformed tool_call → throws cleanly.

### opsAgent.test.ts (2 cases)
- **Happy:** mock admin command "show last 5 bookings" → DB returns 5 rows → agent formats markdown response.
- **Failure:** unknown command → agent returns help message; doesn't crash.

### opsAgentStream.test.ts (1 case)
- **Happy:** stream emits chunks; final chunk closes stream cleanly.

### opsActions.test.ts (2 cases)
- **Happy:** action `update_booking_status` → DB update called once with right params.
- **Failure:** invalid action name → returns `{ok: false, error: "unknown_action"}`.

### agentChat.test.ts (1 case)
- **Happy:** user message in → LLM mock returns reply → `agentMessages` row persisted.

### agentTools.test.ts (2 cases)
- **Happy:** call `list_recent_bookings` tool → returns 5 rows from mocked DB.
- **Failure:** call `update_booking_status` with non-existent booking → returns `{ok: false, error: "not_found"}`.

### officeAssistant.test.ts (1 case)
- **Happy:** task input → agent returns suggested action list.

## Acceptance Criteria

- [ ] 12 new test files created (one per agent listed above)
- [ ] 1 file extended (`refundAgent.test.ts` += 2 cases)
- [ ] Each agent file has ≥ 1 happy-path Vitest case
- [ ] Each non-trivial agent has ≥ 1 failure-mode Vitest case (officeAssistant, opsAgentStream, agentChat exempted at 1 case each)
- [ ] All tests use `vi.mock` for LLM + DB; no real network calls
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test server/agents/autonomous/` runs all tests in < 10 seconds
- [ ] After this module + 3.1 + 3.5 + 3.8: **`find server/agents/autonomous/ -name "*.test.ts" | wc -l` returns 14** (one per source file in autonomous/) — **§九 satisfied**

## Deliverable

- 12 new `.test.ts` files (~80-150 LOC each, ~1,200 LOC total)
- 1 extended `refundAgent.test.ts` (+ ~80 LOC)
- Estimated total: ~25 new Vitest cases across the batch

Commit message:
```
test(agents): Wave 3 Module 3.10 — Vitest smokes for 12 autonomous agents

Per CLAUDE.md §九 hard requirement + audit §A P0: zero of 15 autonomous
agents had tests pre-v2. Modules 3.1/3.5/3.8 covered inquiryAgent and
refundAgent. This module covers the rest:

  gmailPipeline, selfRetrospective, agentReport, accountingAgent,
  followupAgent, marketingAgent, reviewAgent, opsAgent, opsAgentStream,
  opsActions, agentChat, agentTools, officeAssistant

Each agent: 1 happy + 1 failure-mode case (except light agents at 1 each).
All LLM + DB calls mocked via vi.mock; no real network.

Per D4 mock-strategy lock: vi.mock("../_core/llm") returning
deterministic InvokeResult fixtures.

Post-module: find server/agents/autonomous -name "*.test.ts" | wc -l
returns 14 (matches 14 .ts source files; inquiryAgent + refundAgent
shared from earlier modules).

~25 new Vitest cases. Total Wave 3 agent-test count: ~45.

Refs: docs/refactor/tasks/v2-wave-3/module-3.10-vitest-autonomous-agents-batch.md
```

## Rollback

- Single revert (one commit per agent OR one large commit; supervisor decides at land time).
- Per v2-plan parallelism contract: this module's sub-agent commits sequentially; do not race.
- Rollback risk = zero (tests only).

## Manual intervention

- **None** for happy paths.
- **YES escalate** for any agent whose public entry function is unclear from source reading. Sub-agent should escalate per-agent, not bulk.

## Test plan

- ~25 Vitest cases as enumerated. Each must pass.

## Decisions needed (Jeff)

- **None** mechanical (mock targets are obvious from source).
- One **potential escalation per agent** if its public API is genuinely ambiguous — supervisor handles case-by-case.

(Module proceeds without Jeff input.)

## Dispatch hint to supervisor

This is the largest single module in Wave 3 (~12h estimated). Supervisor should consider:
- **Split into 12 parallel sub-tasks**, one per agent? Yes — they're independent, but the commit-sequentialization contract from v1 still applies (sub-agents return diffs; supervisor merges). With 12 sub-tasks at ~1h each, parallel dispatch is sensible.
- OR a single AI sub-agent runs all 12 sequentially? Acceptable if supervisor's queue is congested.

Recommend: **parallel dispatch, sequential merge**.
