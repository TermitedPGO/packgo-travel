# Phase 1 · Module 3 · Cluster B — routers.ts tsc Drift

**Parent plan:** docs/refactor/plan.md (Phase 1 · tsc Error Cleanup)
**Audit ref:** P0-3, P0-1 (touches routers.ts but does NOT split it)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.3 h Jeff review

## Goal
Eliminate all tsc errors inside `server/routers.ts` — **9 errors** at known line numbers (7 owned by this module + 2 inherited resolutions from module 1). **Strictly no file splits, no restructuring.** routers.ts split is Phase 4's job; this module is a surgical type-fix only.

## Pre-requisites
- **Module 1 (tsconfig fix) MUST be merged first.** It clears 2 of this cluster's errors (`routers.ts:5912,5927` TS2802 MapIterator).
- Phase 0 complete, working tree clean.
- Runs in parallel with module 2 (autonomous) and module 4 (services + admin); zero file overlap.

## Inputs (read these before executing)
- `server/routers.ts` — but DO NOT read the whole file (10,122 LOC). Use targeted reads at the error line ranges below.
  - L2440-2540 (suggest procedure for tour search)
  - L4180-4200 (booking followup with priceUsd)
  - L5210-5230 (emergency inquiry creation)
  - L5900-5940 (ModelRow Map iteration — auto-resolves with module 1)
  - L7895-7910 (poster generation field access)
- `drizzle/schema.ts` lines 395-460 — tours columns (no `priceUsd`; canonical is `price`)
- `server/db.ts` — confirm whether `listTours` exists or whether the canonical name is different (e.g., `getAllTours`, `listActiveTours`)
- `drizzle/schema.ts` — find inquiry-category enum (the line 5219 error: `"emergency"` not in union `"other" | "general" | "custom_tour" | "visa" | "group_booking" | "complaint"`)

## The 9 errors this module owns (verify each is cleared)

### B1. `routers.ts:2453` — `db.listTours` does not exist (1 error)
- TS2339 `Property 'listTours' does not exist on type 'typeof import(".../server/db")'.`

**Fix decision:** Code-stale. The caller expects `db.listTours()`. Two options:
  - **Option A (recommended):** Check `server/db.ts` for the actual list-tours function name. Likely candidates: `getAllTours`, `getTours`, `listActiveTours`, or a direct Drizzle query like `db.select().from(tours)`. Replace the call. Likely fix: `const allTours = await getAllTours();` or inline the Drizzle query.
  - **Option B:** Add `export async function listTours()` to `server/db.ts`. Only if no equivalent exists OR if the audit P1-4 db.ts split discussion (deferred to v2) suggests a stable name to add here.

**Recommendation:** Option A. Per audit P1-4, db.ts is 3,474 LOC monolith and we should NOT add to it without a corresponding cleanup pass. Look up the actual existing function.

### B2. `routers.ts:2454` — implicit-any on `t` (1 error)
- TS7006: `Parameter 't' implicitly has an 'any' type.`

**Fix decision:** This is downstream of B1 — once `db.listTours()` (or whatever) returns a typed `Tour[]`, the `.filter((t) => ...)` callback at L2454 will infer correctly. If still failing post-B1, add `(t: Tour)` annotation.

### B3. `routers.ts:2508` — implicit-any on `x` (1 error)
- TS7006: `Parameter 'x' implicitly has an 'any' type.`

**Fix decision:** Same pattern as B2 — read L2500-2515 to see what `x` ranges over. Likely also a downstream effect of B1 or another untyped array. Add explicit annotation.

### B4. `routers.ts:2532` — implicit-any on `t` (1 error)
- TS7006: `Parameter 't' implicitly has an 'any' type.`

**Fix decision:** Same as B2.

### B5. `routers.ts:4190` — `tour.priceUsd` does not exist (1 error)
- TS2339 `Property 'priceUsd' does not exist on type '{ ... tours ... }'.`

**Fix decision:** Schema has `price` (TWD int) + `priceCurrency` (varchar 3, default "TWD"). There is NO `priceUsd` column. Context at L4185-4195:
```ts
const isUsd = (departure as any).currency === "USD" || tour.priceUsd != null;
```
Options:
  - **Option A (recommended):** The intent is "is this a USD-priced tour?" — replace with `tour.priceCurrency === "USD"`. Equivalent semantics, uses canonical column.
  - **Option B:** Add `priceUsd` column. Only justified if there's a legacy data field that holds a different value than `price` does. Per schema comment, `price` already supports `priceCurrency` — Option A is correct.

**Recommendation:** Option A.

### B6. `routers.ts:5219` — `"emergency"` not in inquiry-category union (1 error)
- TS2322 `Type '"emergency"' is not assignable to type '"other" | "general" | "custom_tour" | "visa" | "group_booking" | "complaint"'.`

**Fix decision:** Code-vs-schema mismatch. Two options:
  - **Option A:** Code-side — change `inquiryType: "emergency"` to one of the allowed enum values. Look at surrounding context (L5214-5225): the inquiry is for a customer's emergency-while-traveling case. Closest match: `"complaint"` or `"other"`. Neither captures urgency.
  - **Option B (recommended):** Schema-side — add `"emergency"` to the inquiry-category enum in `drizzle/schema.ts`. This is a real domain category (emergency support inquiries exist as a product feature per surrounding code). Requires:
    1. Edit `drizzle/schema.ts` to extend the `mysqlEnum` for the inquiry category column
    2. New migration `drizzle/0070_add_emergency_inquiry_category.sql`:
       ```sql
       ALTER TABLE inquiries
         MODIFY COLUMN inquiryType ENUM('other','general','custom_tour','visa','group_booking','complaint','emergency')
         NOT NULL DEFAULT 'general';
       ```
    3. Jeff approves migration before merge

**Recommendation:** Option B. Code at L5214-5225 already includes an "Emergency · {label}" subject line, an `inquiryType: "emergency"` field, and treats it as a distinct customer-facing flow. Forcing it into `"complaint"` would mis-categorize and break downstream filters. **THIS REQUIRES SUPERVISOR ESCALATION** — sub-agent flags + waits.

### B7. `routers.ts:5912` — `MapIterator<ModelRow>` (1 error)
- TS2802. **Auto-resolves via module 1.** Verify with: `pnpm tsc --noEmit 2>&1 | grep "routers.ts:5912"` → expect empty.

### B8. `routers.ts:5927` — `MapIterator<ModelRow>` (1 error)
- TS2802. **Auto-resolves via module 1.**

### B9. `routers.ts:7902` — `string | null` not assignable to `string` (1 error)
- TS2322 `Type 'string | null' is not assignable to type 'string'.`

**Fix decision:** Null-narrowing. Context at L7895-7910 (poster generation):
```ts
destination: tour.destination,
```
And per schema (L415): `destination: text("destination"), // v81: legacy nullable`. So `tour.destination` is `string | null`, but the consuming function expects `string`.

Options:
  - **Option A (recommended):** Null-guard: `destination: tour.destination ?? tour.destinationCity ?? ""` — falls back through canonical columns. `destinationCity` is `notNull` per schema (L411), so the chain is safe.
  - **Option B:** Make the consuming function accept `string | null`. More invasive (poster service signature change).

**Recommendation:** Option A.

## Procedure
1. **Read targeted sections of routers.ts** (do NOT read the whole 10K-LOC file):
   - L2440-2540 in one Read call
   - L4180-4200
   - L5210-5230
   - L7895-7910

2. **Read `server/db.ts` targeted** — look for `listTours` or similar exports:
   ```bash
   grep -n "export.*function.*Tour\|export.*Tours\|listTours\|getAllTours\|getTours" /Users/jeff/Desktop/網站/server/db.ts
   ```

3. **Read schema.ts L395-460 and L5219-relevant inquiry enum** to confirm canonical column/enum shapes.

4. **Apply fixes in order B1 → B2-B4 (downstream) → B5 → B6 (with escalation) → B9.** B7/B8 are no-ops (handled by module 1).

5. **For B6 (emergency inquiry category) ESCALATE TO SUPERVISOR.** Sub-agent posts the recommendation (Option B schema enum extension) + the proposed migration SQL. Supervisor decides + applies schema change. Sub-agent waits.

6. **Verify cluster cleanup** (after supervisor lands B6 schema delta if approved):
   ```bash
   cd /Users/jeff/Desktop/網站
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep "server/routers.ts" | wc -l
   ```
   Expected: **0**.

7. **Verify no new errors elsewhere:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -cE "error TS"
   ```
   Expected: error count drops by 7 net (B7+B8 were already cleared by module 1; B1-B6+B9 = 7 newly cleared). So after modules 1+3: 40 − 9 − 7 = 24; after modules 1+2+3 combined: 40 − 9 − 13 − 7 = 11 remaining; final after module 4 lands its 11: **0**.

## Acceptance Criteria
- [ ] All 9 errors in the B1-B9 inventory above are cleared
- [ ] No new tsc errors introduced anywhere
- [ ] `pnpm tsc --noEmit 2>&1 | grep "server/routers.ts"` returns empty
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] B6 schema enum extension migration (if approved by supervisor) lands as separate commit BEFORE this module's commit, and matches existing migration naming convention

## Deliverable
- Modified file: `server/routers.ts` (~9 line edits, no structural changes)
- IF B6 approved: also a new `drizzle/0070_add_emergency_inquiry_category.sql` migration (created by supervisor, not this sub-agent)
- Commit message (this module's primary commit):
  ```
  fix(tsc): resolve cluster B — routers.ts type drift

  Closes 7 tsc errors in server/routers.ts without restructuring
  (+2 additional auto-resolved by module 1's downlevelIteration):
  - L2453: db.listTours → <canonical existing fn name from db.ts>
  - L2454,2508,2532: explicit type annotations on callback params
  - L4190: tour.priceUsd → tour.priceCurrency === "USD" check
  - L5219: inquiryType "emergency" — handled by schema migration 0070
    (extends inquiryType enum; lands as separate commit)
  - L5912,5927: auto-resolved by module 1 downlevelIteration
  - L7902: null-guard tour.destination with destinationCity fallback

  No file splits — routers.ts split is Phase 4 scope. This commit
  surgically removes the type drift and exposes the routes to type
  checking; no runtime behavior change.

  Refs: docs/refactor/plan.md Phase 1 · Module 3
  Closes: 7/40 tsc errors (P0-3)
  ```

## Rollback
- Single-commit revert: `git revert <SHA>` for the code change
- If B6 migration committed separately, revert the migration commit too (in reverse order: code first, then migration). The migration's MODIFY COLUMN is forward-compatible — old code that doesn't use `"emergency"` still works post-migration.

## Manual intervention
- **B6 requires Jeff approval** before supervisor lands the schema migration. Production DB ALTER COLUMN on `inquiries.inquiryType` is non-destructive (enum extension is backward-compatible) but Jeff approves all schema deltas per CLAUDE.md §八.
- All other B1-B9 fixes are code-only — no Jeff touch point.

## Test plan
- Type-only fixes; no new tests required.
- **EXCEPTION — B1**: if `db.listTours()` replacement uses a different existing function, verify by manually tracing one call site that the runtime shape is unchanged. If shape differs, add a 1-line happy-path Vitest covering the `tours.suggest` procedure.
- **EXCEPTION — B6**: if the schema migration lands, add a Vitest case for emergency inquiry creation:
  - Mock-create an inquiry with `inquiryType: "emergency"`
  - Assert it persists and reads back as `"emergency"` (catches enum-rollback drift)
  - File: `server/inquiriesEmergency.test.ts` (new)
- **EXCEPTION — B9**: poster generation path now has a null-fallback chain — add a 1-line happy-path test mocking a tour with `destination: null` and `destinationCity: "Tokyo"`, assert poster receives `"Tokyo"`.
