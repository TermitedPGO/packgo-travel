# Phase 1 · Module 4 · Cluster C — Services + Admin tsc Drift

**Parent plan:** docs/refactor/plan.md (Phase 1 · tsc Error Cleanup)
**Audit ref:** P0-3, P1-5 (touches ToursTab/AutonomousAgentsTab but does NOT structurally split), P1-10
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.4 h Jeff review

## Goal
Eliminate all tsc errors in `server/services/*`, `server/_core/*`, `server/marketingWorker.ts`, and `client/src/components/admin/{ToursTab,AutonomousAgentsTab}.tsx` — **13 errors** across 8 files (11 owned by this module + 2 inherited resolutions from module 1). NO file splits, NO restructuring (full structural splits for ToursTab/AutonomousAgentsTab/supplierSyncService land in Phase 5).

## Pre-requisites
- **Module 1 (tsconfig fix) MUST be merged first.** It clears 2 of this cluster's errors automatically (`yearEndExportService.ts:221,240` TS2802 Map iteration).
- Phase 0 complete, working tree clean.
- Runs in parallel with module 2 (autonomous) and module 3 (routers); zero file overlap.

## Inputs (read these before executing)
- `server/_core/requireAdmin.ts` lines 25-110 (express type augmentation + `req.authUser` access)
- `server/_core/stripeWebhook.ts` lines 795-830 (tier === "free" narrowing)
- `server/services/supplierSyncService.ts` lines 215-230 and 505-520 (Date assignment)
- `server/services/tourMapGenerator.ts` lines 380-395 (`db` null check)
- `server/services/yearEndExportService.ts` lines 215-245 (auto-resolves via module 1)
- `server/marketingWorker.ts` lines 85-95 (string|null narrowing)
- `client/src/components/admin/ToursTab.tsx` lines 625-645 (`tour.destination` null check)
- `client/src/components/admin/AutonomousAgentsTab.tsx` lines 130-145 (`urgency: number | null` not assignable to `PendingItem.urgency: number`) and lines 1935-1950 (object key indexing with `any`)
- `drizzle/schema.ts` line 415 (`destination` nullable text)
- Type defs for express request augmentation — likely `server/_core/types.d.ts` or `server/types.d.ts`

## The 13 errors this module covers (11 owned + 2 inherited from module 1)

### C1. `server/_core/requireAdmin.ts:29,82,105` — Express type augmentation broken (3 errors)
- L29 TS2664: `Invalid module name in augmentation, module 'express-serve-static-core' cannot be found.`
- L82 TS2339: `Property 'authUser' does not exist on type 'Request<...>'.`
- L105 TS2339: same `authUser`

**Fix decision:** Express type augmentation is failing because `@types/express` / `@types/express-serve-static-core` isn't installed or is named differently. Two options:
  - **Option A (recommended):** Verify `@types/express` is in devDependencies. If not, supervisor adds it (sub-agent has no install authority). If present, the augmentation block at L29 likely uses wrong module name — try `declare module 'express'` instead of `declare module 'express-serve-static-core'`, or use the global form:
    ```ts
    declare global {
      namespace Express {
        interface Request {
          authUser?: { id: number; role: string; ... };
        }
      }
    }
    ```
  - **Option B:** Cast inline at usage sites: `(req as Request & { authUser: AuthUser }).authUser`. Code smell but works as a stopgap.

**Recommendation:** Option A with the global `Express.Request` augmentation form (TS docs preferred). If `@types/express` is missing, escalate to supervisor to add it.

### C2. `server/_core/stripeWebhook.ts:824` — `tier !== "free"` redundant check (1 error)
- TS2367 `This comparison appears to be unintentional because the types 'PaidTier' and '"free"' have no overlap.`

**Fix decision:** Code-stale. By L824, `tier` has been narrowed to `PaidTier` (probably `"plus" | "concierge"`) — earlier in the function. The `if (tier !== "free")` check is dead code. Options:
  - **Option A (recommended):** Remove the `if (tier !== "free") {` wrapper. The body inside it always runs now.
  - **Option B:** Widen `tier`'s upstream type to include `"free"` so the guard becomes meaningful. Doesn't match the apparent intent (later code only handles paid tiers).

**Recommendation:** Option A. Read the function from L795 to confirm `tier` is `PaidTier`-typed (not `Tier`); remove the guard; preserve the inner body.

**Caveat:** This intersects with Phase 2 (Stripe webhook hardening). If Phase 2 hasn't started yet, fix it here. If Phase 2 sub-agents have started touching stripeWebhook.ts in parallel, ESCALATE to supervisor — only one cluster should be editing this file at a time. Per plan, Phase 1 lands BEFORE Phase 2, so this is the correct phase.

### C3. `server/services/supplierSyncService.ts:224,511` — `string` not assignable to `Date` (2 errors)
- L224 TS2322 `Type 'string' is not assignable to type 'Date'.`
- L511 TS2322 same

> 🚨 **CROSS-PHASE WARNING (added by supervisor 2026-05-18 post-Stage-3):**
>
> Phase 5 module-5A's discovery audit determined that **the Drizzle column for
> `supplierDepartures.departureDate` is type `date` (not `timestamp`), which
> NATIVELY accepts ISO `YYYY-MM-DD` strings**. Wrapping with `new Date(dateStr)`
> would introduce **timezone drift** — Asia/Taipei (UTC+8) vs UTC + DST handling —
> and could **corrupt live calendar dates on production**.
>
> **Before executing this task, the Stage 4 sub-agent MUST:**
> 1. Read `docs/refactor/tasks/phase-5/module-5A-suppliersync.md` first
> 2. Verify the actual Drizzle column type at `drizzle/schema.ts` for `supplierDepartures.departureDate`
> 3. If column type is `date` (ISO string-native): do NOT use `new Date()`. Use Option C below.
> 4. If column type is `timestamp` (Date object): Option A may apply but verify timezone explicitly with `date-fns-tz`.
>
> Phase 5A includes a DST regression test + the revert pattern if a wrong-direction fix landed.

**Fix decision:** Read schema first. The column type determines the correct fix.

  - **Option A (only if column is `timestamp`):** Convert string → Date at the assignment site: `departureDate: new Date(dateStr)`. Verify `dateStr` is ISO-8601 (Lion + UV APIs return what format? Look at upstream parsing). If not ISO-8601, normalize first via `date-fns/parse`. **EXPLICITLY handle timezone** with `date-fns-tz` — do not rely on `new Date()`'s local-time parsing.
  - **Option B:** Change the schema column from `timestamp` to `varchar`. **Reject** — loses date-comparison semantics, breaks downstream queries.
  - **Option C (recommended if column is `date`):** Adjust the TypeScript type expectation on the call site. The tsc error means a TypeScript shape mismatch — the fix is to make the inferred type accept `string` (Drizzle's `date` column type signature). May require a type assertion `departureDate: dateStr as any` (last resort) OR re-import the column type so Drizzle's string inference is preserved.

**Recommendation:** Verify column type FIRST, then pick A or C. **Caveat from audit P1-10:** "If the sync writes wrong dates into the catalog mirror, the customer sees wrong departure dates → wrong prices → real refund liability." This is financial-impact code. Verify the parse is correct with a unit test (Phase 5A will add full coverage; this phase only fixes the type and adds a 1-line regression).

### C4. `server/services/tourMapGenerator.ts:385` — `db` possibly null (1 error)
- TS18047 `'db' is possibly 'null'.`

**Fix decision:** `getDb()` returns `Database | null`. Code at L385:
```ts
const db = await getDb();
await db.update(tours)...   // ← null check missing
```
Options:
  - **Option A (recommended):** Add null guard immediately after `getDb()`:
    ```ts
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    ```
    Matches the pattern used in stripeWebhook.ts:800-801.
  - **Option B:** Non-null assertion `db!`. Worse — silently crashes at runtime if `getDb()` returns null.

**Recommendation:** Option A.

### C5. `server/services/yearEndExportService.ts:221,240` (2 errors)
- TS2802 MapIterator. **Auto-resolves via module 1.** Verify with `pnpm tsc --noEmit 2>&1 | grep yearEndExport` → expect empty post-module-1.

### C6. `server/marketingWorker.ts:89` — `string | null` not assignable to `string` (1 error)
- TS2322

**Fix decision:** Same shape as B9 (routers.ts:7902). Context at L85-95: the marketingWorker also reads `tour.destination` and passes it to a function expecting `string`. Apply the same fix: null-coalesce with `destinationCity`:
```ts
destination: tour.destination ?? tour.destinationCity ?? "",
```

**Recommendation:** Option A only.

### C7. `client/src/components/admin/ToursTab.tsx:633` — `tour.destination` possibly null (1 error)
- TS18047

**Fix decision:** Same pattern as B9 + C6. Add null guard or fallback:
```tsx
{tour.destination ?? tour.destinationCity ?? "—"}
```
**Caveat:** This is a render path; the UI should display SOMETHING. Empty string is OK; "—" (em dash placeholder) is friendlier. Per existing Admin UI patterns (see surrounding ToursTab.tsx code), pick whichever already exists locally.

### C8. `client/src/components/admin/AutonomousAgentsTab.tsx:137` — `urgency: number | null` vs `urgency: number` (1 error)
- TS2322 `Types of property 'urgency' are incompatible. Type 'number | null' is not assignable to type 'number'.`

**Fix decision:** Mismatch between the tRPC procedure's return type (urgency nullable in DB) and the local `PendingItem` interface (urgency required). Two options:
  - **Option A (recommended):** Loosen the `PendingItem` interface to `urgency: number | null` (or `urgency: number | null | undefined`). Matches reality.
  - **Option B:** Coalesce at the mapping site: `urgency: r.urgency ?? 0`. Forces a sentinel value but discards the "no urgency rating" signal.

**Recommendation:** Option A. Find the `PendingItem` interface declaration (likely in same file or `client/src/components/admin/types.ts`) and add `| null`. Downstream consumers in `PendingInbox` should already handle the null case for ranking.

### C9. `client/src/components/admin/AutonomousAgentsTab.tsx:1941` — indexed access on object with `any` key (1 error)
- TS7053 `Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ critical: string; high: string; medium: string; low: string; }'.`

**Fix decision:** Dynamic indexing with an untyped key. Read L1935-1950 to find the index expression. Likely:
```tsx
const color = URGENCY_COLORS[item.severity];   // item.severity is any
```
Fix by typing the key:
```tsx
const color = URGENCY_COLORS[item.severity as keyof typeof URGENCY_COLORS] ?? URGENCY_COLORS.low;
```
Or trace back to where `item.severity` got typed `any` and fix it at the source.

**Recommendation:** Local `as keyof typeof X` cast — minimal blast radius. If `item.severity` originates from tRPC return type, deeper fix at the procedure boundary is cleaner but out of scope for this surgical phase.

## Procedure
1. **Read the 8 source files at the targeted line ranges** (do not read full files; some are large):
   - `server/_core/requireAdmin.ts` L1-110 (small file, full read OK)
   - `server/_core/stripeWebhook.ts` L795-830
   - `server/services/supplierSyncService.ts` L215-230 + L505-520
   - `server/services/tourMapGenerator.ts` L375-395
   - `server/services/yearEndExportService.ts` L210-250 (sanity check post-module-1)
   - `server/marketingWorker.ts` L80-100
   - `client/src/components/admin/ToursTab.tsx` L625-645
   - `client/src/components/admin/AutonomousAgentsTab.tsx` L125-150 + L1935-1950

2. **Check whether `@types/express` is in package.json devDependencies:**
   ```bash
   grep -E '"@types/express"' /Users/jeff/Desktop/網站/package.json
   ```
   If absent, ESCALATE to supervisor (sub-agent has no install authority). Supervisor runs `pnpm add -D @types/express` + commits.

3. **Apply fixes in order C1 → C2 → C3 → C4 → C6 → C7 → C8 → C9.** C5 is a no-op (handled by module 1).

4. **Verify cluster cleanup:**
   ```bash
   cd /Users/jeff/Desktop/網站
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | \
     grep -E "server/services|server/_core|server/marketingWorker|admin/ToursTab|admin/AutonomousAgentsTab" | wc -l
   ```
   Expected: **0** post module 1 + this module.

5. **Verify no new errors elsewhere:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -cE "error TS"
   ```
   Expected: **0** total (40 − 9 module 1 − 13 module 2 − 7 module 3 − 11 module 4 = 0). If non-zero, investigate the offending lines — either a new error was introduced, or one of modules 2/3 left a leftover.

## Acceptance Criteria
- [ ] All 13 errors in the C1-C9 inventory above are cleared (11 owned + 2 from module 1)
- [ ] No new tsc errors introduced anywhere
- [ ] `pnpm tsc --noEmit` exit code: **0** (zero errors across the whole repo)
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] `@types/express` confirmed in devDependencies (either was there, or supervisor added it as a precursor commit)

## Deliverable
- Modified files: requireAdmin.ts, stripeWebhook.ts, supplierSyncService.ts, tourMapGenerator.ts, marketingWorker.ts, ToursTab.tsx, AutonomousAgentsTab.tsx (7 files; yearEndExportService is no-op)
- IF C1 required: supervisor's `package.json` + `pnpm-lock.yaml` install commit (precursor)
- Commit message (this module's primary commit):
  ```
  fix(tsc): resolve cluster C — services + admin type drift

  Closes 11 tsc errors across services, _core, and admin client files
  (+2 additional auto-resolved by module 1's downlevelIteration):
  - requireAdmin.ts: switch to global Express.Request augmentation;
    fix L29 module-not-found and L82/L105 req.authUser access
  - stripeWebhook.ts L824: remove redundant tier !== "free" guard
    (tier is PaidTier-narrowed at this point — guard is dead code)
  - supplierSyncService.ts L224,L511: new Date(dateStr) — schema
    column is timestamp, supplier API returns ISO string
  - tourMapGenerator.ts L385: null guard on getDb() return
  - marketingWorker.ts L89, ToursTab.tsx L633: null-fallback through
    destinationCity for tour.destination
  - AutonomousAgentsTab.tsx L137: PendingItem.urgency allows null
  - AutonomousAgentsTab.tsx L1941: keyof-cast on URGENCY_COLORS index
  - yearEndExportService.ts: auto-resolved by module 1 downlevelIteration

  No file splits — ToursTab + AutonomousAgentsTab + supplierSyncService
  full structural cleanup is Phase 5 scope. This commit surgically clears
  the type drift; runtime behavior unchanged except:
  - supplierSyncService now writes correct Date objects (previously the
    typecheck would have rejected the build entirely — runtime impact
    is "previously unreachable, now functions correctly")

  Refs: docs/refactor/plan.md Phase 1 · Module 4
  Closes: 11/40 tsc errors (P0-3) — final cluster
  ```

## Rollback
- Per-file revert possible if a specific fix introduces regression. Prefer single revert of this whole commit and re-attempt.
- supplierSyncService Date fix is the only one with non-zero runtime risk; if rolled back, the file fails typecheck again — acceptable while debugging.

## Manual intervention
- **C1 requires supervisor approval** if `@types/express` install is needed (adds a dependency to package.json). Routine for Jeff to approve.
- **C3 has financial-impact undertones** (per audit P1-10) — Jeff should be aware in review that this fix exposes the supplier sync date-write path. Add a code-review checkbox: "verify dateStr is ISO-8601 for both Lion and UV sources before this commit merges".
- All other fixes are routine type cleanup; no Jeff touch point beyond the standard commit review.

## Test plan
- Type-only fixes; no new tests required.
- **EXCEPTION — C3 (supplierSyncService Date)**: add a 1-line happy-path Vitest covering the date parse. Phase 5A will expand coverage, but this regression anchor needs to land NOW because the fix unblocks a previously-broken runtime path:
  - File: `server/services/supplierSyncService.test.ts` (new) or append if exists
  - Test: given an ISO-8601 dateStr, assert `new Date(dateStr).toISOString()` round-trips correctly
  - Test: given a malformed string, assert the code rejects cleanly (no `Invalid Date` silent pass-through)
- **EXCEPTION — C2 (stripeWebhook tier guard removal)**: this code path was previously syntactically dead (the `if (false)` body never ran). Removing the guard makes the body live. Add a 1-line Vitest in stripeWebhook.test.ts (Phase 2 territory — coordinate with Phase 2 supervisor): mock a paid-tier subscription transition, assert the membershipTrials write happens.
- **EXCEPTION — C4 (tourMapGenerator db null guard)**: previously would have crashed at runtime with `Cannot read properties of null`. Add a 1-line test: mock `getDb()` to return null, assert the function throws cleanly with the expected error message.
