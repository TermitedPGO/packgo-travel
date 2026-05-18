# Phase 4B · Read-Only Admin (Sub-PR 2 of 5)

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2-3 h AI + 0.5 h Jeff review
**Risk tier:** LOW — admin-only, all read-only procedures, no mutations
**Deploy window:** Any weekday morning

## Goal
Extract the top-level `admin` domain (currently 100% read-only analytics/stats procedures) from `server/routers.ts` into one or more `server/routers/admin*.ts` files. The plan.md called for `analytics/audit/monitor/stats` splits, but the actual `admin` domain has 9 procedures all of which are admin-protected read-only — they sub-group naturally into "user lookup", "platform stats", "LLM cost", "agent ops monitoring". Validates the admin-only split pattern before any mutation-tier domain.

## Pre-requisites
- Phase 0 + Phase 1 + Phase 2 + Phase 3 complete (same as 4A)
- Module 4A merged — 4B builds on the `server/_core/inputSchemas.ts` extraction that 4A introduced
- This module lands as one squash-merge commit
- MAY proceed in parallel with 4C (different file regions) but supervisor sequences to avoid `routers.ts` merge conflicts

## Inputs (read these before executing)

- `server/routers.ts` L5431-6222 — entire `admin: router({ ... })` block, 792 LOC, 9 procedures
- Procedure-level breakdown (confirmed via grep):

| Procedure | Line range | LOC | Access | Notes |
|---|---|---|---|---|
| `admin.lookupUserByEmail` | 5438-5469 | 32 | admin | User-id lookup helper |
| `admin.getStats` | 5470-5545 | 76 | admin | Platform overview stats (users, bookings, revenue) |
| `admin.getRiskMetrics` | 5546-5606 | 61 | admin | Anti-fraud risk dashboard |
| `admin.getAnalytics` | 5607-5652 | 46 | admin | Time-series analytics |
| `admin.getLlmStats` | 5653-5787 | 135 | admin | LLM usage + cost stats |
| `admin.llmCostReport` | 5788-5971 | 184 | admin | Detailed LLM cost report (largest single procedure) |
| `admin.getAgentDailyLogs` | 5972-6047 | 76 | admin | Autonomous-agent daily logs |
| `admin.getAgentOfficeStatus` | 6048-6146 | 99 | admin | Agent operational status |
| `admin.getTaskHistory` | 6147-6221 | 75 | admin | Admin task history |

- Existing canonical example: `server/routers/tourMonitorRouter.ts` (admin-only, isolated, already extracted)
- Client tRPC call inventory: `grep -rohE "trpc\.admin\.[a-zA-Z]+" client/src/`

## Domain Inventory (this PR only)

| Domain | Current LOC in routers.ts | Source line range | Target file(s) | Target LOC after split |
|---|---|---|---|---|
| admin (top-level) | 792 | 5431-6222 | `server/routers/adminPlatform.ts` + `server/routers/adminLlm.ts` + `server/routers/adminAgents.ts` | ≤300 each |

**Split decision (why three files, not one):**

The `admin` domain has 9 procedures totaling 792 LOC — barely over the 300 LOC limit if kept whole. Per CLAUDE.md §3.2 it could land as a single file. But two of the procedures (`getLlmStats` at 135 LOC, `llmCostReport` at 184 LOC) form a clear "LLM cost" cluster, and `getAgentDailyLogs`+`getAgentOfficeStatus`+`getTaskHistory` form a clear "agent ops monitoring" cluster. Keeping LLM and agent-ops separate from platform stats makes 4E (where the agent-mutations live) easier to wire later.

**Three sub-files:**

- **`server/routers/adminPlatform.ts`** (~230 LOC):
  - `lookupUserByEmail` (32 LOC)
  - `getStats` (76 LOC)
  - `getRiskMetrics` (61 LOC)
  - `getAnalytics` (46 LOC)
- **`server/routers/adminLlm.ts`** (~325 LOC, documented exception OR split further):
  - `getLlmStats` (135 LOC)
  - `llmCostReport` (184 LOC)
  - **If combined exceeds 300 LOC:** split into `adminLlmStats.ts` + `adminLlmCostReport.ts`. Supervisor decides post-extraction based on exact LOC. **Default: keep as one with a documented exception**, since the two procedures share a lot of helper data structures (LLM usage queries, model cost matrix).
- **`server/routers/adminAgents.ts`** (~260 LOC):
  - `getAgentDailyLogs` (76 LOC)
  - `getAgentOfficeStatus` (99 LOC)
  - `getTaskHistory` (75 LOC)

**Composition pattern in `routers.ts` after 4B:**

```ts
admin: router({
  ...adminPlatformRouter._def.procedures,
  ...adminLlmRouter._def.procedures,
  ...adminAgentsRouter._def.procedures,
  // No remaining inline procedures in `admin:` — all 9 extracted
}),
```

Client continues to call `trpc.admin.getStats`, `trpc.admin.getLlmStats`, etc. — zero path change.

## Sub-Agent Strategy

**Sub-agent count for this PR: 3 (parallel).**

- **Sub-agent A — adminPlatform**: extract `lookupUserByEmail` + `getStats` + `getRiskMetrics` + `getAnalytics` (L5438-5652) → `server/routers/adminPlatform.ts` + `.test.ts`. ≤300 LOC.
- **Sub-agent B — adminLlm**: extract `getLlmStats` + `llmCostReport` (L5653-5971) → `server/routers/adminLlm.ts` + `.test.ts`. ~325 LOC with documented exception; if >400, sub-agent flags for supervisor sub-split.
- **Sub-agent C — adminAgents**: extract `getAgentDailyLogs` + `getAgentOfficeStatus` + `getTaskHistory` (L5972-6221) → `server/routers/adminAgents.ts` + `.test.ts`. ≤300 LOC.

**Supervisor coordination:**
1. Gate per sub-agent: target file LOC reported back; if any exceeds 400, escalate sub-split.
2. Disjoint source-range check (no overlap).
3. Stitch: delete L5431-6222 from `routers.ts`, add three imports, rewrite the `admin:` block to use the spread composition.
4. Run `pnpm tsc --noEmit` + `pnpm test` before squash-merge.

**Sub-agent constraints:**
- Sub-agents touch ONLY their target line range.
- Sub-agents do NOT modify `server/db.ts`.
- Sub-agents import `shortStr`/`mediumStr`/`longStr` from `server/_core/inputSchemas.ts` (4A extraction).
- All three sub-agents will likely need to import a common helper for LLM cost computation; if the helper lives in `server/routers.ts` (rare but possible), sub-agent flags it. Supervisor decides: extract to `server/_core/llmCostHelpers.ts` (new file) OR re-import from `routers.ts`. **Default: extract** since 4D's accounting domain probably also needs it.

## Client tRPC Call Audit

Verified by `grep -rohE "trpc\.admin\.[a-zA-Z]+" client/src/`. Expected procedures consumed by client that depend on this PR (sub-agents verify exhaustive list during extraction):

- `trpc.admin.lookupUserByEmail` — `client/src/components/admin/<some-admin-tool>.tsx`
- `trpc.admin.getStats` — admin dashboard overview tab
- `trpc.admin.getRiskMetrics` — admin risk dashboard
- `trpc.admin.getAnalytics` — admin analytics tab
- `trpc.admin.getLlmStats` — admin LLM stats dashboard
- `trpc.admin.llmCostReport` — admin LLM cost report tab
- `trpc.admin.getAgentDailyLogs` — admin agent ops view
- `trpc.admin.getAgentOfficeStatus` — admin office overview tab
- `trpc.admin.getTaskHistory` — admin task history

**Sub-agents MUST run `grep -rohE "trpc\.admin\.[a-zA-Z]+" client/src/ | sort -u`** to confirm the exhaustive set before declaring extraction complete. Any procedure called by client that's NOT in the 9 we're extracting → escalate (the `admin:` domain may have hidden cross-procedure callers; unlikely but verify).

**ZERO-BREAK CONSTRAINT:** After 4B merges, every `trpc.admin.<procedure>` call resolves identically — same input schema, same output, same `adminProcedure` gating.

## Procedure

1. **Supervisor (pre-fan-out, optional commit):** If sub-agents discover shared LLM-cost helpers in routers.ts (e.g., model cost matrix const, `formatLlmCost` helper), supervisor extracts them to `server/_core/llmCostHelpers.ts` as a prep commit. Skipped if not needed.

2. **Supervisor dispatches sub-agents A-C in parallel.** Each sub-agent receives:
   - Its source line range (exact)
   - Its target file path
   - "import shared types from `../db`, `../_core/trpc`, `../_core/inputSchemas`. Do NOT modify any of those."

3. **Per-sub-agent extraction recipe** (same as 4A):
   ```ts
   // server/routers/adminPlatform.ts (example)
   import { adminProcedure, router } from "../_core/trpc";
   import { TRPCError } from "@trpc/server";
   import { z } from "zod";
   import { shortStr } from "../_core/inputSchemas";
   import * as db from "../db";
   // ...other domain-specific imports as discovered during extraction...

   export const adminPlatformRouter = router({
     lookupUserByEmail: adminProcedure...,
     getStats: adminProcedure...,
     getRiskMetrics: adminProcedure...,
     getAnalytics: adminProcedure...,
   });
   ```

4. **Per-sub-agent Vitest recipe:**
   ```ts
   // server/routers/adminPlatform.test.ts
   import { describe, it, expect, vi } from "vitest";
   import { adminPlatformRouter } from "./adminPlatform";
   import * as db from "../db";

   describe("adminPlatform router", () => {
     it("getStats happy-path: returns numeric counts", async () => {
       vi.spyOn(db, "getDb").mockResolvedValue({ /* mock counts */ } as any);
       const caller = adminPlatformRouter.createCaller({
         user: { id: 1, role: "admin" },
         /* ...other ctx... */
       } as any);
       const stats = await caller.getStats();
       expect(stats).toBeTruthy();
     });
   });
   ```

5. **Supervisor (post-fan-out, single commit):** apply the 3 sub-agent diffs as one squash-merge commit:
   - 3 new files in `server/routers/`
   - 3 new `*.test.ts` files
   - `server/routers.ts` shrinks by ~792 LOC; `admin:` block becomes a 3-spread composition
   - Verify `pnpm tsc --noEmit` + `pnpm test` green

6. **Smoke test (Jeff or supervisor):**
   - Open admin panel; navigate every read-only tab listed in client audit
   - Each tab must load WITHOUT a console error and WITHOUT a network 4xx/5xx
   - Verify LLM cost report's largest table renders the same row count as before

## Acceptance Criteria
- [ ] `server/routers/adminPlatform.ts` ≤300 LOC, exports `adminPlatformRouter`
- [ ] `server/routers/adminLlm.ts` ≤400 LOC (≤300 ideal, ≤400 documented exception); exports `adminLlmRouter`
- [ ] `server/routers/adminAgents.ts` ≤300 LOC, exports `adminAgentsRouter`
- [ ] Three `*.test.ts` files exist, each with at least one happy-path Vitest case, all passing
- [ ] `server/routers.ts` shrinks by ≥780 LOC (post-4A baseline → ≥780 less)
- [ ] All client `trpc.admin.*` paths resolve identically (smoke verified)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count UNCHANGED + 3 new test files pass
- [ ] `pnpm build` succeeds

## Deliverable
- Modified: `server/routers.ts` (792 LOC removed; 3 imports added; admin block rewritten)
- New:
  - `server/routers/adminPlatform.ts` + `.test.ts`
  - `server/routers/adminLlm.ts` + `.test.ts`
  - `server/routers/adminAgents.ts` + `.test.ts`
  - Conditionally: `server/_core/llmCostHelpers.ts` (if extracted)
- Single squash-merge commit:
  ```
  refactor(routers): Phase 4B — read-only admin split (platform/LLM/agents)

  Extracts the top-level `admin` domain (9 read-only procedures, 792 LOC)
  from routers.ts into three sub-files grouped by concern. Composition uses
  the spread pattern so client trpc.admin.* paths are preserved.

  - server/routers/adminPlatform.ts (lookupUserByEmail, getStats, getRiskMetrics, getAnalytics)
  - server/routers/adminLlm.ts (getLlmStats, llmCostReport)
  - server/routers/adminAgents.ts (getAgentDailyLogs, getAgentOfficeStatus, getTaskHistory)

  3 happy-path Vitest files. routers.ts shrinks ~792 LOC.
  Zero client trpc path breakage; admin smoke verified on staging.
  ```

## Rollback
- Single squash-merge commit: `git revert <merge-SHA>` restores the inlined `admin:` block. The 3 new files become orphans (no imports), bundle simply excludes them.
- If `server/_core/llmCostHelpers.ts` was extracted as a prep commit, that's an independent revert; would require re-inlining helpers in the new admin router files temporarily.

## Manual intervention
- **Jeff:** review the squash-merge commit and visit each admin read-only tab on staging before push. Smoke checklist takes ~10 minutes.
- **Supervisor:** verify the `grep -rohE "trpc\.admin\.[a-zA-Z]+"` result is exhaustively covered by the three new sub-routers' procedure names.

## Test plan
- **Sub-agent A (adminPlatform):** Vitest covers `getStats` happy path — mocked db returns user/booking/revenue counts; assert numeric shape.
- **Sub-agent B (adminLlm):** Vitest covers `llmCostReport` happy path — mocked LLM usage rows; assert cost-sum is a positive number.
- **Sub-agent C (adminAgents):** Vitest covers `getAgentDailyLogs` happy path — mocked logs table returns an array; assert ordering by timestamp.

After all three pass, run full `pnpm test` to confirm regression-anchor pass count unchanged. Then `pnpm tsc --noEmit` + `pnpm build`.
