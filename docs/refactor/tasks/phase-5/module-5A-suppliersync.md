# Phase 5 · Module 5A · supplierSyncService Split + Date Fix + Tests

**Parent plan:** docs/refactor/plan.md (Phase 5 · Selected P1 Cleanup)
**Audit ref:** P1-10
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6-8 h AI + 1 h Jeff review
**Deploy window:** Tue/Wed morning 9-11am PT (financial-adjacent — wrong dates → wrong prices → refund liability)

## Goal

Split `server/services/supplierSyncService.ts` (810 LOC, 2.7× CLAUDE.md limit) into a `server/services/supplierSync/` subdirectory (lion / uv / shared / index), fix the two Phase 1 string→Date residue spots, and add rigorous Vitest covering happy-path sync, malformed-payload rejection, and the full enumerated set of date-parsing edge cases. Behavior MUST stay identical — this is structural + type-safety, not feature work.

## Pre-requisites

- Phase 0 complete (clean `git status`)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0; the line 224 / 511 string-assignment-to-Date errors have already been resolved in Cluster C of Phase 1)
- Phase 4 in flight or complete — `server/routers/suppliersRouter.ts` already imports `getRecentSyncRuns` + `getSuppliersOverview` and must keep working through the split
- Confirmed external importers of the service (4 sites, must NOT break):
  - `server/routers/suppliersRouter.ts:24-26` — imports `getRecentSyncRuns`, `getSuppliersOverview`
  - `server/queues/supplierSyncQueue.ts:22-25` — imports `syncAllSuppliers`, `syncLionCatalog`, `syncUvCatalog`
  - `server/_core/index.ts:883` — comment reference only (queue boot)
  - `server/services/uvBulkImportService.ts:6` — comment reference only

## Inputs (read these before executing)

- `server/services/supplierSyncService.ts` — 810 LOC, three sections separated by banner comments:
  - Lines 1-63: header docstring + imports
  - Lines 64-145: shared helpers (`jitter`, `getSupplierIdByCode`, `openRun`, `closeRun`)
  - Lines 147-163: `SyncResult` interface
  - Lines 165-465: Lion section (`lionToProductInsert`, `lionGroupToDeparture`, `syncLionCatalog`)
  - Lines 467-719: UV section (`uvToProductInsert`, `uvRowToDeparture`, `syncUvCatalog`)
  - Lines 721-810: orchestration (`getRecentSyncRuns`, `getSuppliersOverview`, `syncAllSuppliers`)
- `server/suppliers/lionClient.ts` — source of `LionNormGroup`, `LionGroupEntry`. `GoDate` is **`"YYYY/MM/DD"` string** (Lion's native format), normalized in `lionGroupToDeparture` line 207-209 via regex.
- `server/suppliers/uvClient.ts` — source of `UvProductListItem`, `UvDepartureRow`. `groupDate` is **already `"YYYY-MM-DD"` ISO**, defensive `.slice(0, 10)` at line 497.
- `server/suppliers/types.ts` — `SupplierApiError`, `deriveAvailability`.
- `drizzle/schema.ts` — `supplierDepartures.departureDate` is a `date` column (Drizzle MySQL: stored as `YYYY-MM-DD` string at the wire level). Confirms the Phase 1 fix should be **keep the string, not coerce to Date** — schema accepts ISO date strings for `date` columns.
- `drizzle/0073_*.sql` — most recent supplier-related migration (style reference).

## Procedure

### Step 1: Confirm the Phase 1 string→Date resolution stance

Before any file move, audit lines 224 and 511 in their current (Phase 1-fixed) state:
- Line 224 (`departureDate: dateStr` inside `lionGroupToDeparture`) — `dateStr` is `"YYYY-MM-DD"` string built from regex match.
- Line 511 (`departureDate: dateStr` inside `uvRowToDeparture`) — `dateStr` is `row.groupDate.slice(0, 10)` string.

The Drizzle `supplierDepartures.departureDate` column type is `date`. Drizzle's `date` column inserts accept ISO-8601 `"YYYY-MM-DD"` strings natively — **no `new Date(...)` coercion is required or desired** (coercing to `Date` introduces timezone drift; the string form is timezone-safe).

**Decision:** the Phase 1 fix should already have aligned the InsertSupplierDeparture type to accept `string` for `departureDate`. Verify by running `pnpm tsc --noEmit` against the current code. If errors remain, the right fix is to align the Drizzle schema's inferred type, NOT to wrap with `new Date()`.

If a `new Date(...)` wrapper got introduced in Phase 1 (wrong fix), revert it in this module and align the schema type instead. Add a comment block at each call site explaining why the string form is intentional.

### Step 2: Create the new directory structure

Create `server/services/supplierSync/` with five files:

```
server/services/supplierSync/
  index.ts          ≤120 LOC  — public surface + syncAllSuppliers orchestration
  shared.ts         ≤100 LOC  — jitter, getSupplierIdByCode, openRun, closeRun, SyncResult type
  lion.ts           ≤260 LOC  — lionToProductInsert + lionGroupToDeparture + syncLionCatalog
  uv.ts             ≤260 LOC  — uvToProductInsert + uvRowToDeparture + syncUvCatalog
  reporting.ts      ≤100 LOC  — getRecentSyncRuns, getSuppliersOverview (admin queries)
```

Sizes total 820 LOC max (current 810 + ~10 LOC re-export boilerplate). Each file ≤300 LOC per CLAUDE.md §1.

### Step 3: Preserve the public import surface

The existing four importers expect named exports off `server/services/supplierSyncService`. Two options:

**Option A (preferred — zero-churn for callers):** Keep `server/services/supplierSyncService.ts` as a 20-line re-export shim:

```ts
/**
 * supplierSyncService — re-export shim.
 *
 * The implementation lives in ./supplierSync/. This shim exists so the
 * four pre-existing import sites (suppliersRouter, supplierSyncQueue,
 * _core/index comment, uvBulkImportService comment) don't need rewrites.
 * Delete this shim in v2 once all importers point at supplierSync/index.
 */
export {
  syncLionCatalog,
  syncUvCatalog,
  syncAllSuppliers,
  getRecentSyncRuns,
  getSuppliersOverview,
  type SyncResult,
} from "./supplierSync";
```

**Option B (cleaner — minor caller churn):** Delete the old file, update the 2 import-site files (`suppliersRouter.ts`, `supplierSyncQueue.ts`).

Pick Option A. Rationale: matches v1 refactor scope (structural-only); v2 can drop the shim.

### Step 4: Split + move (4 atomic sub-steps inside the single module commit)

For each move, preserve every comment line — the docstring blocks (lines 1-39, 164-194, 198-219, 467-487, 489-520) are load-bearing for future humans.

1. **Create `shared.ts`** — copy lines 41-163 (imports, jitter, getSupplierIdByCode, openRun, closeRun, SyncResult). Adjust imports: `getDb` becomes `../../db`, `drizzle/schema` becomes `../../../drizzle/schema`.
2. **Create `lion.ts`** — copy lines 41-50 (Lion imports only) + 165-465 (Lion-specific code). Imports from `./shared` for `jitter`, `getSupplierIdByCode`, `openRun`, `closeRun`, `SyncResult`.
3. **Create `uv.ts`** — same pattern for UV: lines 56-62 + 467-719.
4. **Create `reporting.ts`** — lines 721-785 (`getRecentSyncRuns`, `getSuppliersOverview`).
5. **Create `index.ts`** — re-export public surface + `syncAllSuppliers` (lines 793-810). The orchestrator imports from `./lion` and `./uv`.
6. **Replace `supplierSyncService.ts`** with the re-export shim (step 3 Option A).

### Step 5: Verify behavior identity

- `pnpm tsc --noEmit` exit 0
- `pnpm test` — existing tests pass (no supplier-sync tests exist yet; that's step 6)
- `grep -rn "from.*supplierSyncService\|from.*supplierSync"` returns the same set of importers, all type-checking
- Run the daily worker entry path manually: `pnpm tsx -e "import('./server/queues/supplierSyncQueue').then(m => console.log(typeof m.triggerManualSync))"` — should print `function` without error

### Step 6: Add Vitest (rigorous per Q6 — money-adjacent)

Create three test files. Use the Drizzle in-memory mock pattern that Phase 2 module 1 established (`server/_core/stripeMocks.ts` precedent). For supplier-sync, mock the supplier HTTP clients (`lionClient`, `uvClient`) so tests are deterministic and offline.

**File 1: `server/services/supplierSync/lion.test.ts` (≤200 LOC)**

Test cases:

1. **Happy sync — Lion canonical payload**: feed a 2-product / 6-departure synthetic Lion response into `syncLionCatalog`; assert `productsAdded === 2`, `departuresUpdated === 6`, `status === "success"`, `newProductCodes.length === 2`, and `db.select` on supplierProducts returns 2 active rows with the expected `externalProductCode` set.

2. **Malformed-payload rejection — missing `NormGroupID`**: payload contains 3 NormGroups but one has `NormGroupID: ""`. Assert: the bad row is skipped at `lionToProductInsert` (returns `null`), no crash, `productsAdded === 2`, the bad row does NOT appear in `supplierProducts`.

3. **Malformed-payload pending flag — missing `TourName` but has `NormGroupID`**: this triggers the lines 311-326 pending-write path. Assert: a row with `status: "pending"` and the original `NormGroupID` appears in `supplierProducts`, run-level `productsScanned` increments, no crash.

4. **Date parsing — unparseable `GoDate`**: GroupList contains one entry with `GoDate: "2026-13-45"` (invalid month/day) and another with `GoDate: "garbage"`. Both fail the regex at line 207. Assert: `lionGroupToDeparture` returns `null` for both, `departuresUpdated` does NOT count them, no exception.

5. **Date parsing — `GoDate` with single-digit month/day**: `"2026/3/5"` (no zero-pad). Assert: `lionGroupToDeparture` produces `departureDate: "2026-03-05"` (zero-padded by `.padStart(2, "0")` at line 209), inserted row matches.

6. **Partial run on supplier API mid-page failure**: first page succeeds, second page throws `SupplierApiError`. Assert: `status === "partial"`, `errorMessage` populated, first page's products are still saved.

7. **Stale detection — full sync marks disappeared products inactive**: pre-seed supplierProducts with 4 rows; sync returns 3 of them. Assert: 1 row is updated to `status: "inactive"`, `productsDeactivated === 1`.

**File 2: `server/services/supplierSync/uv.test.ts` (≤200 LOC)**

Test cases:

1. **Happy sync — UV canonical payload**: 2-product / 4-departure synthetic UV response. Assert counts.

2. **Date edge case — `groupDate` already ISO `"YYYY-MM-DD"`**: `.slice(0, 10)` returns intact string; assert `departureDate` matches.

3. **Date edge case — `groupDate` is `"YYYY-MM-DDTHH:mm:ss"` (datetime with time component)**: `.slice(0, 10)` extracts just the date portion. Assert `departureDate === "YYYY-MM-DD"` with the time stripped.

4. **Date edge case — `groupDate` with timezone offset `"YYYY-MM-DD+08:00"`**: `.slice(0, 10)` extracts the date portion before the offset. Assert correct date preservation (UV publishes in Asia/Taipei; we store the local date, no UTC conversion — verify a 2026-12-31 Taipei date stays "2026-12-31" not "2026-12-30").

5. **Date edge case — leap year `"2024-02-29"`**: assert correctly accepted (leap year is valid).

6. **Date edge case — non-leap-year Feb 29 `"2026-02-29"`**: Drizzle/MySQL `date` column will accept this lexically; document expected behavior (we trust supplier feed; downstream catalog renders will surface impossible dates as red flags but the sync MUST NOT crash).

7. **Date edge case — DST transition date `"2026-03-08"` (US "spring forward")**: assert stored as plain `YYYY-MM-DD` string with NO timezone-induced shift. This is the regression anchor against any future temptation to wrap in `new Date(...)`.

8. **Date edge case — Y2K-ish boundary `"2026-12-31"` and `"2027-01-01"`**: assert both stored verbatim; no year-rollover bug.

9. **Date edge case — empty `groupDate`**: returns `null` from `uvRowToDeparture` (line 495 guard). Assert no insert, no crash.

10. **Spare seats calculation**: `groupStock: 20, groupSaleStock: 5` → `spareSeats: 15`. Edge: `groupSaleStock > groupStock` → `Math.max(0, ...)` clamps to 0. Both asserted.

11. **`stockStatus !== 200` closed-flag**: closed UV departure marked as the correct availability bucket via `deriveAvailability`.

**File 3: `server/services/supplierSync/index.test.ts` (≤100 LOC)**

Test cases:

1. **`syncAllSuppliers` — Lion succeeds, UV throws**: result array length 2; first entry `supplier: "lion"`, second `supplier: "uv"` with `status: "failed"`. Confirms one supplier's failure does NOT bypass the other (lines 799-808 try/catch pattern preserved).

2. **`getRecentSyncRuns` — limit + ordering**: pre-seed 25 runs; query with `limit=10`; assert returns 10 rows ordered by `startedAt desc`.

3. **`getSuppliersOverview` — counts roll up**: pre-seed 5 products (3 active, 1 inactive, 1 pending) for one supplier; assert returned `counts` object matches `{active: 3, inactive: 1, pending: 1, hidden: 0, total: 5}`.

**Test fixtures location:** `server/services/supplierSync/__fixtures__/` (gitignore-friendly subdirectory):
- `lion-happy.json` — canonical Lion response
- `lion-malformed-missing-normgroupid.json`
- `lion-malformed-bad-date.json`
- `uv-happy.json`
- `uv-edge-dates.json` (parameterized cases 2-9)

Fixtures should be derived from known production-history payloads where possible — if Jeff has a prod payload that previously caused a crash, embed it verbatim (with sensitive fields redacted) as a regression anchor.

## Acceptance Criteria

- [ ] `server/services/supplierSync/{shared,lion,uv,reporting,index}.ts` exist; each ≤300 LOC
- [ ] `server/services/supplierSyncService.ts` reduced to ≤25 LOC re-export shim
- [ ] All 4 external import sites continue to type-check (`pnpm tsc --noEmit` exit 0)
- [ ] Lines 224 / 511 carry an explanatory comment locking in the "string not Date" stance
- [ ] `server/services/supplierSync/lion.test.ts` exists with 7 cases, all pass
- [ ] `server/services/supplierSync/uv.test.ts` exists with 11 cases, all pass
- [ ] `server/services/supplierSync/index.test.ts` exists with 3 cases, all pass
- [ ] `server/services/supplierSync/__fixtures__/` populated with fixture JSON
- [ ] `pnpm test` — regression-anchor pass count unchanged + 21 new cases pass
- [ ] Manual: trigger one staging sync against a known-good payload, verify same row counts pre/post-split
- [ ] Manual: trigger one staging sync against a known-malformed payload (from prod history if available), verify clean rejection / pending flag (no crash)

## Deliverable

- New: `server/services/supplierSync/index.ts`, `shared.ts`, `lion.ts`, `uv.ts`, `reporting.ts`
- New: `server/services/supplierSync/lion.test.ts`, `uv.test.ts`, `index.test.ts`
- New: `server/services/supplierSync/__fixtures__/*.json` (≥5 fixture files)
- Modified: `server/services/supplierSyncService.ts` → ≤25 LOC re-export shim
- Single commit:
  ```
  refactor(supplier-sync): Phase 5 module 5A — split + tests + lock string-date stance

  - Split 810 LOC supplierSyncService.ts into supplierSync/{shared,lion,uv,reporting,index}.ts
  - Original file retained as a 25-LOC re-export shim (zero-churn for the
    4 existing import sites)
  - Lock in string (not Date) for supplierDepartures.departureDate at the
    two Phase 1-touched sites with explanatory comments
  - 21 new Vitest cases: 7 Lion (incl 4 date-edge), 11 UV (incl 7 date-edge:
    ISO/datetime/timezone-offset/leap/non-leap-Feb29/DST/year-boundary),
    3 orchestration
  - Fixtures captured from known-good + known-bad prod payloads

  Money-adjacent → rigorous depth per Q6 of plan.
  ```

## Rollback

**Code rollback (if a regression surfaces post-deploy):**
- Single `git revert <commit-SHA>` restores the 810-LOC monolith plus removes the new test files. All 4 import sites continue working because they imported from `supplierSyncService` (the shim) — but pre-shim was also `supplierSyncService` directly, so the revert leaves them pointed at the restored monolith.
- No DB schema change in this module → no migration to roll back.
- The BullMQ daily worker (`supplierSyncQueue`) is unaffected by the split — it consumes the same public function signatures.

**Down-rollback strategy if a sync regression hits prod:**
1. **Immediate (within 5 min):** revert the deploy commit, redeploy prior bundle. The daily 03:00 UTC cron will run on the prior code on its next tick.
2. **If the bad code already ran and wrote bad rows:** the table that gets corrupted is `supplierDepartures` (departure dates). Recovery: re-run a full sync on the prior (reverted) code — the upsert pattern (`onDuplicateKeyUpdate`) self-corrects on the next clean run; no manual SQL needed.
3. **If the BullMQ worker is mid-run during the revert:** the in-flight run will complete on the new (faulty) code path, but the next-cycle run on reverted code will overwrite. Maximum data corruption window: ~24h (one daily cron cycle). No customer-facing impact during that window if the corruption is on `supplierDepartures` only (customer sees PACK&GO `tours` rows which are rewritten by the LLM bulk-import step downstream, not the raw mirror).
4. **Test fixtures retained on revert:** the `__fixtures__/` directory is data, not code — leaving it in place doesn't hurt anything and lets the v1.1 re-attempt reuse the corpus.

**Catastrophic rollback (if dates got coerced to JS `Date` and the timezone shift wrote wrong calendar days to live `tours.startDate`):** identify affected `tours` rows by joining `supplierDepartures` → `tourSourceMappings` → `tours`, regenerate from the source `supplierProducts.rawProductJson` blob, manually overwrite the corrupted `tours.startDate` and `tours.endDate`. Document this drill in the deploy plan so Jeff doesn't have to invent it under pressure.

## Manual intervention

- **Jeff:** approve the re-export shim approach (Option A) vs deleting the old file (Option B) before module starts. Recommend A.
- **Jeff:** review the test fixtures for sensitive data before commit (`__fixtures__/*.json` should not contain real customer PII).
- **Supervisor (not Jeff):** trigger the two staging syncs (one happy, one malformed) before the Tue/Wed morning prod deploy and confirm row counts.
- **Jeff:** be available 30 min post-deploy on the Tue/Wed morning window to watch the 03:00 UTC cron tick the next day (since it's a delayed-trigger code path).

## Test plan

`pnpm test server/services/supplierSync` — 21 new cases:

**Lion (7):**
1. Happy 2-product / 6-departure sync
2. Missing `NormGroupID` skip
3. Missing `TourName` with valid `NormGroupID` → pending flag
4. Unparseable `GoDate` regex fail → row skipped
5. Single-digit month/day `GoDate` zero-padding
6. Mid-page `SupplierApiError` → `status: "partial"`
7. Stale-detection deactivation on full sync

**UV (11) — six are date-edge enumerations:**
1. Happy 2-product / 4-departure sync
2. ISO `"YYYY-MM-DD"` slice intact
3. Datetime `"YYYY-MM-DDTHH:mm:ss"` slice extracts date
4. Timezone-offset `"YYYY-MM-DD+08:00"` slice extracts date (no UTC drift)
5. Leap year `"2024-02-29"` accepted
6. Non-leap-year `"2026-02-29"` documented behavior (sync MUST NOT crash; downstream surfaces as anomaly)
7. DST date `"2026-03-08"` stored as plain string (regression anchor against `new Date()` regression)
8. Year boundary `"2026-12-31"` + `"2027-01-01"` stored verbatim
9. Empty `groupDate` returns `null`, no insert, no crash
10. Spare-seats arithmetic + negative-clamp
11. `stockStatus !== 200` closed-flag bucket mapping

**Orchestration (3):**
1. `syncAllSuppliers` — one supplier fails, the other still runs
2. `getRecentSyncRuns` — limit + ordering
3. `getSuppliersOverview` — counts roll up correctly

Plus the regression anchor: re-run full `pnpm test` and confirm pre-existing pass count unchanged.

**Manual staging smoke (Jeff or supervisor):**
- Run `triggerManualSync('lion')` against staging, compare row deltas to pre-split baseline
- Run `triggerManualSync('uv')` against staging, same comparison
- Feed one known-bad prod-history payload, verify clean rejection + admin UI pending-count increment
