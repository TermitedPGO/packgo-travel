# v2 · Wave 2 · Module 2.5 — Split `server/db.ts` (log/audit domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 5th of 7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160; v2-plan.md line 148 ("auditLog, llmCallLog, agentActionLog")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.4)
**Est. effort:** 1.5 h AI + 10 min Jeff review
**Risk tier:** LOW — log helpers are write-mostly; reads are admin-only.
**Deploy window:** any morning after 2.4 stable for ≥4h.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.4 committed (or explicitly skipped per D2.4-a no-op decision) AND green.

## Goal

Extract **log/audit helpers** (auditLog + llmCallLog + agentActionLog + agent retrospective records + email send logs) from `server/db.ts` into `server/db/log.ts` (≤300 LOC). Shim. Vitest smoke.

## Pre-requisites

- Modules 2.1-2.4 committed (or 2.4 documented as no-op)
- `server/db/{booking,tour,user,payment}.ts` exist
- Shim block has 4 `export *` lines

## Inputs (read these before executing)

1. **Post-2.4 `server/db.ts`** — grep for log/audit functions.
2. **`drizzle/schema.ts`** — `auditLogs`, `llmCallLogs`, `agentActionLogs`, `agentActionOutcomes`, `emailSendLogs`, `policyProposals`, `agentMonitorMetrics`. Confirm tables.
3. **`server/_core/auditLog.ts`** (if exists) — confirm log helpers are not already in a service.
4. Previous extractions for pattern.

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/log.ts` (new) | Audit + LLM call + agent action + email send + retrospective records | ≤300 |
| `server/db/log.test.ts` (new) | 1+ Vitest | ≤80 |
| `server/db.ts` (modified) | Delete moved bodies; add 5th shim line | reduces ~200 LOC |

### Functions to extract (sub-agent grep first)

Expected based on schema (re-confirm by grepping):

- `createAuditLog(...)` / `getAuditLogs(...)` — admin audit trail
- `recordLlmCall(...)` / `getLlmCallLogs(...)` — LLM call telemetry
- `recordAgentAction(...)` / `updateAgentActionOutcome(...)` — autonomous agent action log
- `recentAgentOutcomes(...)` — admin agent monitoring read
- `createEmailSendLog(...)` / `updateEmailSendLog(...)` / `getEmailSendLogs(...)` — at L2935+ (currently inline)
- Policy proposal helpers (if exists)
- Agent monitor metric helpers (if exists)

## Procedure

### Step 1 — Verification grep

```bash
grep -nE "^export async function" server/db.ts | grep -iE "audit|llm|agent|log|outcome|policy|metric|retrospective"
wc -l server/db.ts  # expect ~2,040
```

### Step 2 — Create `server/db/log.ts`

```ts
// server/db/log.ts — extracted from server/db.ts in v2 Wave 2 Module 2.5.
//
// Owns: auditLog + llmCallLog + agentActionLog + agentActionOutcomes +
// emailSendLog + retrospective/policy/monitor records. All write-mostly;
// reads are admin-only.

import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { /* schema imports */ } from "../../drizzle/schema";
import { getDb } from "../db";

// === Audit log ===
// ...
```

### Step 3 — Modify `server/db.ts`

1. Delete moved bodies.
2. Add 5th shim line:

```ts
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";
export * from "./db/payment";
export * from "./db/log";
```

3. Verify `wc -l server/db.ts` ≤1,840.

### Step 4 — Smoke test

```ts
// server/db/log.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import { /* extracted exports */ } from "./log";

describe("db/log", () => {
  it("exports audit + LLM + agent-action log functions", () => {
    // Verify exports based on what was actually extracted
  });

  it("log read function returns [] when DB not init", async () => {
    // Pick a reader; assert it returns [] safely
  });
});
```

### Step 5 — Verify

```bash
pnpm tsc --noEmit
pnpm test server/db/log.test.ts
pnpm test
```

### Step 6 — Smoke

- Boot `pnpm dev`
- Trigger any admin action that writes an audit log → confirm row created
- Trigger any LLM call → confirm `llmCallLogs` row created
- Open agent monitor admin tab → confirm recent outcomes render

## Acceptance Criteria

- [ ] `server/db/log.ts` exists with extracted exports
- [ ] `server/db/log.ts` ≤300 LOC
- [ ] `server/db/log.test.ts` exists with 1+ passing test
- [ ] `server/db.ts` has 5 `export * from` lines
- [ ] `server/db.ts` reduces ≥150 LOC
- [ ] No export collisions
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` green
- [ ] Manual: admin action writes audit log; agent monitor tab renders

## Deliverable

- New: `server/db/log.ts`, `server/db/log.test.ts`
- Modified: `server/db.ts`

**Commit:**
```
refactor(db): v2 Wave 2 Module 2.5 — extract log domain from db.ts

Fifth sub-task in the D2-locked 7-file db.ts split.

- server/db/log.ts: auditLog + llmCallLog + agentActionLog +
  emailSendLog + retrospective helpers verbatim.
- server/db/log.test.ts: smoke + null-DB.
- server/db.ts: ~2,040 → ~1,840 LOC; 5 shim lines.

Audit ref: v2-audit §C; v2-plan.md Module 2.1 line 148.
```

## Rollback

`git revert <SHA>`. Low risk.

## Manual intervention

- **Jeff:** review commit.
- **Supervisor:** name-collision grep.

## Test plan

- 1 Vitest, 2+ cases
- Full regression
- Manual: admin action → audit log row

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.5-a | Email send logs — group with `log.ts` (current plan) or with `db/payment.ts` (since email triggers around payment events)? | **log.ts.** Email sends are observability, not financial. |
| D2.5-b | Policy proposals (autonomous agent governance) — extract here or leave residual? | **Extract here** if exists. They're an audit-style record. |

**Must be committed before Module 2.6 starts.**
