# v2 · Wave 1 · Module 1.9 — Admin rate-limit verification + tests (mostly already done)

**Parent plan:** docs/refactor/v2-plan.md (Wave 1 · Module 1.7)
**Audit ref:** v2-audit-2026-05-19.md §G "Admin mutation rate-limit gaps" (lines 425-432) — claim was "29 admin router files have no rate-limit on their mutations"

**IMPORTANT: The middleware already exists.** A scope check (`server/_core/trpc.ts` lines 31-63) shows `adminProcedure` ALREADY auto-throttles all mutations via `checkAdminMutationRateLimit` (60 req/min per admin user). Comment cites "QA audit 2026-05-11 Phase 6 P0". The audit's "29 files" claim is **stale** (was true pre-Phase 6, false now). The middleware lives at the **shared `adminProcedure` definition**, so every admin router inherits throttling without per-file edits.

**This module's actual scope is reduced:** confirm middleware is correctly applied, write the Vitest test that doesn't yet exist, and update CLAUDE.md to reflect the real state.

**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5h AI (was 4h in plan; reduced because primary work is done)

## Goal
Verify and document the already-implemented admin mutation rate-limit middleware. Add the Vitest test specified in plan §1.7 (61st request in a minute → `TOO_MANY_REQUESTS`). Update CLAUDE.md to reflect that `adminProcedure` auto-throttles mutations — this prevents future devs from rebuilding what's already there. Confirm no `adminProcedure` bypass exists in the 29 router files audit flagged.

## Pre-requisites
- Working tree clean.
- No dependency on other Wave 1 modules.
- **Redis available in test env.** Confirm `pnpm test` has Redis mocked OR uses a test-mode early-return in `checkRateLimit` (verified: `server/rateLimit.ts` lines 24-26 early-returns `{ allowed: true }` when `VITEST` or `NODE_ENV=test`). **Tests must temporarily disable this bypass** to exercise the rate-limit branch.

## Inputs (read these before executing)
- `server/_core/trpc.ts` (full 64 LOC) — the canonical adminProcedure definition. Lines 31-63 contain the rate-limit middleware. Read in full to understand:
  - Trigger: only on `type === "mutation"` (queries pass through).
  - Function: `checkAdminMutationRateLimit(ctx.user.id)` from `../rateLimit`.
  - Failure: throws `TRPCError({ code: "TOO_MANY_REQUESTS", ... })`.
- `server/rateLimit.ts` lines 263-280 — `checkAdminMutationRateLimit`:
  - Limit: 60 req/minute (line 277).
  - Window: 60 seconds.
  - Bucket key: `admin-mutation:user:${userId}`.
- `server/rateLimit.ts` lines 22-26 — the test-mode early return that test cases must bypass.
- All 37 files in `server/routers/*.ts` that use `adminProcedure` — verify NONE of them define their own non-shared `adminProcedure` variant. If any router redefines `adminProcedure` (extremely unlikely but worth a grep), that's a bypass.
- Audit ref `v2-audit-2026-05-19.md` lines 425-432 (§G "Admin mutation rate-limit gaps") — **this section is stale**. Module's CLAUDE.md update notes that.
- Plan §1.7 lines 97-101 — what Module 1.9 was supposed to do (mostly done).

## Scope (what this module owns)
1. **Audit the 37 admin routers** — confirm none redefine `adminProcedure` or use a non-rate-limited alternative:
   ```bash
   grep -rn "publicProcedure.use.*role.*admin\|t.procedure.use.*admin" server/routers/
   # MUST return 0 matches (no router should define its own adminProcedure equivalent).
   ```
   If any file does, escalate to supervisor — this is a security gap.
2. **Write Vitest test** at `server/_core/trpc.test.ts` (NEW) asserting:
   - 60 mutations from same user → all allowed.
   - 61st mutation → `TRPCError({ code: "TOO_MANY_REQUESTS" })`.
   - Query (not mutation) → no rate-limit applied (101 queries in a row → all allowed).
3. **Update CLAUDE.md §三 3.2** — explicitly document:
   ```
   - **Admin Rate-Limit：** 自動套用 — `adminProcedure` middleware
     已在 server/_core/trpc.ts 包含 60 req/min throttle（QA audit 2026-05-11
     Phase 6 P0）。新增 admin router 時無需手動加 rate-limit。
   ```
4. **Update CLAUDE.md §四 禁止事項:**
   ```
   // ❌ 禁止：在 admin router 重新定義自己的 procedure
   //   應直接使用 server/_core/trpc.ts 的 adminProcedure（自動 rate-limit）
   ```
5. **Optional: per-router test smokes** — add 1 test per representative admin router asserting `expect(rate-limited)` after 60 mutations. **DECISION 2 below — recommended SKIP** (single shared test is sufficient; per-router would be 37 redundant tests).

## Procedure
1. **Read** `server/_core/trpc.ts` end-to-end (confirm understanding of middleware).
2. **Read** `server/rateLimit.ts` lines 22-26 (the test-bypass) and lines 263-280 (the admin limiter).
3. **Audit for bypass routers:**
   ```bash
   cd /Users/jeff/Desktop/網站
   grep -rn "publicProcedure.use.*admin\|t.procedure.use.*admin" server/routers/ server/agents/ server/services/
   ```
   Expect 0 hits (besides the canonical definition in `_core/trpc.ts`). If hits, **STOP and escalate** — likely a security gap to fix in a separate task.
4. **Confirm every `adminProcedure` import in `server/routers/*.ts` resolves to `../_core/trpc`:**
   ```bash
   grep -rn "adminProcedure" server/routers/*.ts | grep -v "_core/trpc"
   ```
   Each line should be a USE of `adminProcedure` (calling it, e.g., `adminProcedure.mutation(...)`), not an import from anywhere else.
5. **Write `server/_core/trpc.test.ts`:**
   - Mock `checkAdminMutationRateLimit` from `../rateLimit` to control the rate-limit branch.
   - Test 1: 60 mutations → all succeed.
   - Test 2: 61st mutation → `TRPCError` with code `TOO_MANY_REQUESTS`.
   - Test 3: query (not mutation) → 101 queries pass without rate-limit.
   - Test 4 (admin guard regression): non-admin user → `FORBIDDEN` (the guard at line 35-37; ensures rate-limit didn't break the role check).
6. **Update CLAUDE.md** §三 + §四 as described.
7. **Run** `pnpm tsc --noEmit` + `pnpm test trpc`.

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` all green (+ new tests in `server/_core/trpc.test.ts`)
- [ ] **Per CLAUDE.md §九:** Vitest test exists at `server/_core/trpc.test.ts` with the 4 cases above. Required.
- [ ] Audit confirms no router redefines `adminProcedure` (grep returns 0 matches).
- [ ] CLAUDE.md §三 3.2 documents auto-rate-limit.
- [ ] CLAUDE.md §四 禁止事項 documents the new forbidden pattern.
- [ ] Manual smoke (optional): trigger 61 rapid admin mutations on staging via a test endpoint → assert 61st returns `TOO_MANY_REQUESTS` HTTP code. Defer to Jeff manual.

## Deliverable
- **New files:**
  - `server/_core/trpc.test.ts`
- **Modified files:**
  - `CLAUDE.md`
- **NO code changes** to `server/_core/trpc.ts` (middleware already correct).
- **NO new file** `server/_core/adminRateLimit.ts` (plan called for this — **the helper already lives at `server/rateLimit.ts:274` as `checkAdminMutationRateLimit`**; no relocation needed).
- **Expected commit message:**
  ```
  test(security): Vitest cases for adminProcedure rate-limit

  - new server/_core/trpc.test.ts: 4 cases asserting the 60-req/min
    admin mutation throttle (added 2026-05-11 Phase 6 P0 in
    server/_core/trpc.ts:43-54). Cases: 60 ok, 61st throws
    TOO_MANY_REQUESTS, queries unthrottled, non-admin still FORBIDDEN
  - CLAUDE.md §三 3.2: document auto-rate-limit so new admin routers
    don't reimplement it; §四 禁止事項: forbid router-local
    adminProcedure redefinition

  Module 1.9 scope reduced from plan: the middleware itself was
  already implemented in v1 Phase 6, before v2 audit was written.
  Audit §G claim of "29 routers lack rate-limit" was stale. This
  module verifies + tests + documents what exists.

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.7
  ```

## Rollback
- Single `git revert <SHA>` removes the new test file + CLAUDE.md edits. No production behavior change.

## Manual intervention
- **None.** All work is automated. Optional Jeff manual smoke on staging post-deploy (~2min) to confirm rate-limit fires for real.

## Test plan
- **`server/_core/trpc.test.ts`** (NEW):
  - Setup: mock `checkAdminMutationRateLimit` from `../rateLimit` using `vi.mock`. Default mock returns `{ allowed: true }`.
  - Case 1 (60 ok): mock returns `{ allowed: true }` 60 times; assert all 60 mutation calls succeed.
  - Case 2 (61st throws): mock returns `{ allowed: false }` on 61st call; assert `TRPCError` thrown with `code: "TOO_MANY_REQUESTS"`.
  - Case 3 (queries unthrottled): make 101 query calls; mock NOT called (verify via `vi.mocked(checkAdminMutationRateLimit).not.toHaveBeenCalled()`).
  - Case 4 (non-admin FORBIDDEN): set `ctx.user.role = "user"`; assert any procedure call throws `FORBIDDEN` regardless of rate-limit state.

## Decisions needed (Jeff)
1. **Audit-level: confirm no router redefines `adminProcedure`.** Procedure step 3 grep. Default: if 0 matches, proceed; if matches, escalate.
2. **Per-router smoke tests.** Default: SKIP (the canonical test in `trpc.test.ts` is sufficient; 37 duplicate tests = noise). Confirm.
3. **Rename `server/rateLimit.ts:274` `checkAdminMutationRateLimit` → move to `server/_core/adminRateLimit.ts`?** Plan §1.7 called for this. Default: SKIP. The helper is fine where it is, alongside other rate-limit helpers. Moving = churn for zero gain.
