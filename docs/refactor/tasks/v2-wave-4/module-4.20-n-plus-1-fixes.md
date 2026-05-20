# v2 · Wave 4 · Module 4.20 — Fix 3 confirmed N+1 queries

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.23)
**Audit ref:** v2-audit-2026-05-19.md §H lines 472-478 (3 confirmed N+1 in plaidRouter, skills, aiChatSkillService)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 15 min Jeff review
**Deploy window:** any weekday morning — server-side only; performance improvement

## Goal

Replace the 3 N+1 query patterns flagged in audit §H with `inArray()` batch queries. Reduces tail latency on Plaid sync, skill dependency resolution, and skill feedback recording.

## Pre-requisites

- Wave 2 Module 2.1 (db.ts split) merged — sub-routers' DB helpers live in `server/db/`.
- Wave 1 Module 1.2 (pino logger) merged — log query count assertions in Vitest.

## Inputs (read these before executing)

- `server/routers/plaidRouter.ts` — loops `for (const id of insertedIds)` + `await db.select` (audit §H line 474).
- `server/routers/skills.ts` — `for (const depId of dependsOn) { await skillDb.getSkillById(depId) }` (audit §H line 475).
- `server/services/aiChatSkillService.ts` — `for (const logId of usageLogIds) { await recordUserFeedback(...) }` (audit §H line 476).
- `drizzle-orm` `inArray` documentation.

## Scope (what this module owns)

- ✅ Fix the 3 confirmed N+1 patterns in those 3 files.
- ✅ Add Vitest assertions on query count for each fixed call site.
- ❌ NOT in scope: full N+1 audit (audit suggests 10-15 more exist; this module fixes only the 3 confirmed). File follow-up task if Jeff wants exhaustive sweep.

## Procedure

1. **Read the 3 inputs**, locate exact loop patterns.

2. **Fix 1: `server/routers/plaidRouter.ts`** — replace `for (const id of insertedIds) { await db.select... }`:
   ```ts
   import { inArray } from 'drizzle-orm';
   // Replace loop with single query:
   const rows = await db.select().from(table).where(inArray(table.id, insertedIds));
   ```

3. **Fix 2: `server/routers/skills.ts`** — replace `for (const depId of dependsOn) { await skillDb.getSkillById(depId) }`:
   ```ts
   // Add a batch helper to server/db/skills.ts (post-Wave-2 split):
   export async function getSkillsByIds(ids: number[]) {
     if (ids.length === 0) return [];
     return db.select().from(skills).where(inArray(skills.id, ids));
   }
   // Caller becomes:
   const deps = await skillDb.getSkillsByIds(dependsOn);
   ```

4. **Fix 3: `server/services/aiChatSkillService.ts`** — replace `for (const logId of usageLogIds) { await recordUserFeedback(...) }`:
   ```ts
   // Add bulk helper:
   export async function recordUserFeedbackBulk(logIds: number[], feedback: FeedbackInput) {
     if (logIds.length === 0) return;
     await db.update(usageLog).set({ feedback }).where(inArray(usageLog.id, logIds));
   }
   ```

5. **Add Vitest query-count assertions** — leverage Wave 1 pino structured logs OR mock Drizzle to count `select` calls. Example for fix 1:
   ```ts
   it('plaid sync runs a single batch query for N IDs', async () => {
     const mockSelect = vi.fn().mockResolvedValue([]);
     vi.spyOn(db, 'select').mockImplementation(() => ({ from: () => ({ where: mockSelect }) }) as any);
     await syncPlaidAccounts(['id1', 'id2', 'id3']);
     expect(mockSelect).toHaveBeenCalledTimes(1); // not 3
   });
   ```

6. **Run full test suite:** `pnpm test` — no regressions.

## Acceptance Criteria

- [ ] `server/routers/plaidRouter.ts` no longer contains `for (const ... await db.` pattern.
- [ ] `server/routers/skills.ts` same.
- [ ] `server/services/aiChatSkillService.ts` same.
- [ ] `getSkillsByIds(ids: number[])` exists in `server/db/skills.ts` (post-Wave-2 split file).
- [ ] `recordUserFeedbackBulk(logIds, feedback)` exists in aiChatSkillService.
- [ ] **Tests:** 3 new Vitest cases — one per fix, asserting query count or assertion of `inArray` use. **Required per CLAUDE.md §九.**
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.

## Deliverable

- Modified: `server/routers/plaidRouter.ts`, `server/routers/skills.ts`, `server/services/aiChatSkillService.ts`, `server/db/skills.ts` (or wherever skills DB helpers live), `server/routers/plaidRouter.test.ts` (extend), `server/routers/skills.test.ts` (extend), `server/services/aiChatSkillService.test.ts` (extend)

**Commit message:**

```
perf(n+1): Wave 4 module 4.20 — fix 3 confirmed N+1 query patterns

- plaidRouter: insertedIds loop → single inArray() batch
- skills: dependsOn loop → skillDb.getSkillsByIds([...]) batch helper
- aiChatSkillService: usageLogIds loop → recordUserFeedbackBulk batch
- 3 Vitest cases assert single-query path per fix

Audit §H impact: P95 latency drop on Plaid sync (proportional to insertedIds.length),
skill detail load (proportional to dependsOn.length), feedback batch (proportional
to usageLogIds.length).

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.20, audit §H lines 472-478
```

## Rollback

- Single revert restores loops. No data risk.

## Manual intervention

- **Jeff (~5 min):** post-deploy smoke — trigger a Plaid sync, a skill detail view, a feedback record. Verify pages load.

## Test plan

**Vitest:** 3 new cases (one per fix). Each mocks `db.select` / `db.update` and asserts called once with `inArray()` predicate.

**Regression anchor:** `pnpm test` count + 3 new cases.

## Decisions needed (Jeff)

1. **Exhaustive N+1 audit** — recommend file v3 task: full grep for `for ... await db.` + audit each. ~10-15 likely candidates per audit §H line 478.
