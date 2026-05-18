# Phase 1 · Module 1 · tsconfig downlevelIteration Fix

**Parent plan:** docs/refactor/plan.md (Phase 1 · tsc Error Cleanup)
**Audit ref:** P0-3
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 0.2 h AI + 0.1 h Jeff review

## Goal
Add `"downlevelIteration": true` (or bump `target` to `ES2015+`) in `tsconfig.json` so that `Set` / `Map` / `RegExpStringIterator` / `MapIterator` iteration becomes valid. This single config change closes 9 of the 40 tsc errors (all 9 TS2802 "downlevelIteration" errors) automatically, with zero source-code edits.

## Pre-requisites
- Phase 0 complete (clean working tree, `git status --short` returns 0 lines).
- Baseline tsc error count captured: 40 errors across 16 files.
- **This module is the sequential blocker for modules 2, 3, 4.** Run this FIRST; the supervisor must verify modules 2/3/4 see an updated error count before dispatching them.

## Inputs (read these before executing)
- `/Users/jeff/Desktop/網站/tsconfig.json` (full file, 23 lines)
- Current effective TS `target` — verify with: `npx tsc --showConfig | grep -E '"target"|"downlevelIteration"'`
- TS docs reference: any `target` >= `ES2015` natively supports Set/Map iteration; `downlevelIteration: true` is the alternative when staying on `ES5`.

## The 9 errors this module clears (all TS2802; verify each disappears post-edit)
1. `server/agents/autonomous/selfRetrospective.ts:219` — `Type 'MapIterator<[string, Outcome[]]>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.`
2. `server/agents/calibrationAgent.ts:519` — `Type 'Set<string>' can only be iterated…`
3. `server/agents/calibrationAgent.ts:526` — same
4. `server/agents/calibrationAgent.ts:527` — same
5. `server/routers.ts:5912` — `Type 'MapIterator<ModelRow>' can only be iterated…`
6. `server/routers.ts:5927` — same
7. `server/services/lionTravelApiService.ts:492` — `Type 'RegExpStringIterator<RegExpExecArray>' can only be iterated…`
8. `server/services/yearEndExportService.ts:221` — `Type 'MapIterator<{ line: string; total: number; count: number; }>' can only be iterated…`
9. `server/services/yearEndExportService.ts:240` — `Type 'MapIterator<[string, { total: number; count: number; }]>' can only be iterated…`

**Bonus:** Implicit-any errors at `selfRetrospective.ts:220,224` may resolve concurrently because the iterator is now properly typed. Verify post-edit; if they remain, they belong to module 2.

## Procedure
1. **Inspect current tsconfig:**
   ```bash
   cat /Users/jeff/Desktop/網站/tsconfig.json
   ```
   Confirm there is no explicit `"target"` set (current state: only `module`, `strict`, `lib`, etc. are defined). Default `target` for TS 5.x with `module: ESNext` is `ES3` — that's the root cause.

2. **Choose ONE fix (prefer Option A; Option B is the fallback):**

   **Option A (preferred): Add `downlevelIteration: true`.** Minimum diff, no risk of changing emitted code shape for other paths.
   ```jsonc
   {
     "include": ["client/src/**/*", "shared/**/*", "server/**/*"],
     "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
     "compilerOptions": {
       "incremental": true,
       "tsBuildInfoFile": "./node_modules/typescript/tsbuildinfo",
       "noEmit": true,
       "module": "ESNext",
       "downlevelIteration": true,   // ← ADD THIS LINE
       "strict": true,
       ...
     }
   }
   ```

   **Option B (alternative): Add `"target": "ES2020"`.** Slightly more change — also affects how TS lowers async/await, optional chaining, etc. Since `noEmit: true` is set in this repo (vite handles the actual build), Option B is also safe but introduces an unnecessary degree of freedom for this phase. Use Option A unless Jeff opts in.

3. **Apply the edit** using `Edit` tool on `tsconfig.json` — add the `downlevelIteration: true` line after `noEmit`. Preserve existing JSON formatting.

4. **Verify the fix:**
   ```bash
   cd /Users/jeff/Desktop/網站
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -E "error TS" | wc -l
   ```
   Expected: **31 errors** (40 − 9). If module 1 also resolves selfRetrospective L220/L224 implicit-anys (because the iterator is properly typed), expect **29 errors**.

5. **Verify each of the 10 specific errors is gone:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -E "TS2802"
   ```
   Expected output: **empty** (TS2802 is the `downlevelIteration` error code).

6. **Check vite still builds** (sanity — confirms downlevelIteration doesn't break the runtime emit, even though `noEmit: true` means tsc itself emits nothing; vite uses esbuild's own target):
   ```bash
   pnpm build 2>&1 | tail -10
   ```
   Expected: clean build with no new warnings about iteration.

7. **Capture before/after evidence for the supervisor:**
   ```bash
   echo "BEFORE: 40 errors" > /tmp/phase1-mod1-evidence.txt
   echo "AFTER: $(NODE_OPTIONS='--max-old-space-size=6144' pnpm tsc --noEmit 2>&1 | grep -cE 'error TS') errors" >> /tmp/phase1-mod1-evidence.txt
   cat /tmp/phase1-mod1-evidence.txt
   ```

## Acceptance Criteria
- [ ] `tsconfig.json` contains `"downlevelIteration": true` in `compilerOptions`
- [ ] `pnpm tsc --noEmit 2>&1 | grep -cE "error TS"` returns **31** or fewer (40 − 9 minimum; possibly 29 if selfRetro implicit-anys also clear)
- [ ] `pnpm tsc --noEmit 2>&1 | grep -cE "TS2802"` returns **0**
- [ ] `pnpm build` exit 0 (no new emit warnings)
- [ ] `pnpm test` regression-anchor pass count unchanged

## Deliverable
- 1 modified file: `tsconfig.json` (+1 line)
- Commit message:
  ```
  fix(tsconfig): enable downlevelIteration to clear 9 TS2802 errors

  Default target ES3 was rejecting Set/Map/RegExpStringIterator iteration
  in 5 files (calibrationAgent, selfRetrospective, lionTravelApiService,
  yearEndExportService, routers). downlevelIteration=true is the minimum
  diff fix; noEmit means runtime emit is unchanged (vite/esbuild handle
  bundling and use their own target).

  Refs: docs/refactor/plan.md Phase 1 · Module 1
  Closes: 9/40 tsc errors (P0-3)
  ```

## Rollback
- Single-line revert: `git revert <SHA>` or manually remove the `downlevelIteration` line.
- No data risk (config-only change).

## Manual intervention
- **None.** This is a pure mechanical config change. No schema decisions, no behavior change.
- Jeff sees the commit in normal review flow but does not need to manually approve.

## Test plan
- No new Vitest tests required (config-only change, zero runtime behavior delta).
- Regression anchor: `pnpm test` pass count must equal Phase 0 baseline.
- Iteration code paths exercised by existing tests (if any cover yearEndExportService / calibrationAgent / routers map iteration) will continue to behave identically — `downlevelIteration` only affects what tsc accepts, not what gets executed (since `noEmit: true`).
