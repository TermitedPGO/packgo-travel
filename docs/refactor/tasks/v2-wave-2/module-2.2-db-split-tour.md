# v2 · Wave 2 · Module 2.2 — Split `server/db.ts` (tour domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 2nd of 7 sub-tasks)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160 + line 186 (db.ts split plan); v2-plan.md line 146
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.1 commit)
**Est. effort:** 2 h AI + 10 min Jeff review
**Risk tier:** MEDIUM — tours queries hit homepage + search + tour detail + admin tour CRUD; high read-volume but lower mutation risk than booking.
**Deploy window:** any morning after 2.1 is stable for ≥4h.

> **CRITICAL SEQUENCING:** This module starts ONLY after Module 2.1 is committed AND `pnpm tsc --noEmit + pnpm test` green on the supervisor's tree. Wave 2 modules 2.1 → 2.7 are sequential per v1 lesson 1.

## Goal

Extract the **tour-domain query helpers** from `server/db.ts` (now ~3,210 LOC post-2.1) into a new `server/db/tour.ts` (≤500 LOC). Add `export * from "./db/tour"` to the shim. Add Vitest smoke.

## Pre-requisites

- Module 2.1 committed; `git log -1 --oneline` shows the booking-extraction commit
- `server/db/booking.ts` + `server/db/booking.test.ts` exist and tests green
- `server/db.ts` already contains `export * from "./db/booking"` near top
- Working tree clean
- `pnpm tsc --noEmit` exit 0 at HEAD

## Inputs (read these before executing)

1. **Post-2.1 `server/db.ts`** — confirm current line ranges via `grep -nE "^export async function" server/db.ts`. Tour-domain functions will have shifted up by ~370 LOC.
2. **`server/db/booking.ts`** — template for the new file's header comment + import style.
3. **`drizzle/schema.ts`** — `tours`, `tourDepartures` table definitions.
4. **Module 2.1's commit diff** — the shim pattern. Module 2.2 reuses it identically.

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/tour.ts` (new) | Move tour + tourDeparture CRUD here | ≤500 |
| `server/db/tour.test.ts` (new) | 1 happy-path Vitest | ≤80 |
| `server/db.ts` (modified) | Delete moved bodies; add `export * from "./db/tour"` next to the booking shim line | reduces ~600 LOC |

### Functions to extract → `server/db/tour.ts`

Re-grep `db.ts` before executing to get current line numbers. Expected set (from pre-Module-2.1 audit; line numbers post-2.1 will shift):

**Tours core CRUD:**
- `getAllTours(filters)` — was L399
- `getTourById(id)` — was L478
- `createTour(tour)` — was L492
- `updateTour(id, updates)` — was L527
- `deleteTour(id)` — was L588
- `batchDeleteTours(ids)` — was L667

**Tour departures:**
- `getTourDepartures(tourId)` — was L690
- `getDepartureById(id)` — was L704
- `tryReserveDepartureSlots(...)` — was L729 (the money-path slot-reservation)
- `releaseDepartureSlots(...)` — was L771
- `createDeparture(departure)` — was L791
- `updateDeparture(id, updates)` — was L811
- `deleteDeparture(id)` — was L830

**Calibration helpers (tour-state machine):**
- `saveCalibrationResult(...)` — was L2365
- `getCalibrationResultByTourId(...)` — was L2385
- `getPendingReviewTours()` — was L2403
- `approveTour(tourId)` — was L2427
- `rejectTour(tourId)` — was L2444

**Filter / search helpers (tour-side):**
- `getFilterOptions()` — was L1921
- `searchTours(filters)` — was L1407
- `getDepartureCities()` — was L2291

**Total: ~21 functions, approx ~600 LOC.**

### What this module does NOT touch

- **Destinations** (L1780+) — small enough to leave in `db.ts` per v2-plan.md line 153 ("NEW domains NOT in 7-file split: visa queries, inquiries, customTourRequests, agents → leave inside db.ts"). Destinations is one such residual. Document in 2.7's final cleanup.
- **Tour-price-comparison helpers** (`upsertTourPriceComparison` etc. at L3298+) — move to `db/search.ts` (Module 2.6) since they're competitor-comparison concerns.
- **Image library helpers** — move to `db/search.ts` (Module 2.6, since search-tier features all colocate).

## Procedure

### Step 1 — Verification grep

```bash
cd /Users/jeff/Desktop/網站
grep -nE "^export async function" server/db.ts > /tmp/2.2-db-exports-before.txt
wc -l server/db.ts  # expect ~3,210 (post-2.1)
```

Confirm the 21 function names listed above all exist in `db.ts` and identify their current line numbers.

### Step 2 — Create `server/db/tour.ts`

Mirror the header/import pattern of `server/db/booking.ts` (created in 2.1):

```ts
// server/db/tour.ts — extracted from server/db.ts in v2 Wave 2 Module 2.2 (D2 locked split).
//
// Owns: tours CRUD + tourDepartures CRUD + calibration state-machine + search/filter helpers
// that read from `tours`. Booking/payments live in db/booking.ts. Search-index +
// price-comparison + image-library helpers live in db/search.ts (Module 2.6).

import { eq, and, gte, lte, desc, like, or, sql, inArray, ne } from "drizzle-orm";
import {
  tours, InsertTour, Tour,
  tourDepartures, InsertTourDeparture, TourDeparture,
  calibrationResults, CalibrationResult, InsertCalibrationResult,
} from "../../drizzle/schema";
import { getDb, type DrizzleTx } from "../db";

// === Tours core CRUD ===
export async function getAllTours(filters?: {...}) { /* verbatim */ }
// ... etc
```

**Implementation rules** (same as 2.1):
- Verbatim copy of function bodies.
- Preserve every comment + banner inside the function block.
- Import `getDb` from `"../db"` (the shim) — lazy resolution works.
- If a function imports a helper still inline in `db.ts`, import via `"../db"` (until 2.7 final).

### Step 3 — Modify `server/db.ts`

1. Delete the 21 function bodies (use grep to confirm line ranges).
2. Delete the now-orphaned `// ============ Tours ============`, `// ============ Tour Departures ============`, `// ============ Calibration ============` banner lines.
3. Add the second shim line below the 2.1 shim:

```ts
// === v2 Wave 2 — domain extractions ===
export * from "./db/booking";
export * from "./db/tour";  // ← new in Module 2.2
```

4. Verify `wc -l server/db.ts` ≤2,610 (was ~3,210 post-2.1; minus ~600).

### Step 4 — Create the smoke test

```ts
// server/db/tour.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import { getTourById, getAllTours, getFilterOptions } from "./tour";

describe("db/tour", () => {
  it("exports core tour functions", () => {
    expect(typeof getTourById).toBe("function");
    expect(typeof getAllTours).toBe("function");
    expect(typeof getFilterOptions).toBe("function");
  });

  it("getTourById returns undefined when DB not initialized", async () => {
    const result = await getTourById(1);
    expect(result).toBeUndefined();
  });
});
```

### Step 5 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/db/tour.test.ts
pnpm test  # full regression
```

### Step 6 — Smoke

- `pnpm dev` boots
- Visit homepage → tours list renders (`getAllTours` hits)
- Visit a tour detail page → renders (`getTourById` hits)
- Admin tour list page → renders (`getPendingReviewTours` or similar)

## Acceptance Criteria

- [ ] `server/db/tour.ts` exists; the 21 named exports listed in Scope above are exported
- [ ] `server/db/tour.ts` ≤500 LOC (if it exceeds 500, sub-agent should re-evaluate scope — calibration helpers could spin to `db/log.ts` Module 2.5 instead)
- [ ] `server/db/tour.test.ts` exists with 1+ happy-path Vitest cases, all passing
- [ ] `server/db.ts` contains `export * from "./db/tour"` line (alongside booking shim)
- [ ] `server/db.ts` reduces by ≥550 LOC (post-2.1 ~3,210 → post-2.2 ≤2,660)
- [ ] All 21 extracted function bodies are DELETED from `db.ts`
- [ ] No new exports collision warnings from tsc (verify both `db/booking.ts` and `db/tour.ts` don't export same name)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count + new tests pass
- [ ] Manual smoke: homepage + tour detail + admin tour list all render in dev mode

## Deliverable

- New: `server/db/tour.ts`, `server/db/tour.test.ts`
- Modified: `server/db.ts`

**Single commit:**

```
refactor(db): v2 Wave 2 Module 2.2 — extract tour domain from db.ts

Second sub-task in the D2-locked 7-file db.ts split.

- server/db/tour.ts: 21 functions (tours CRUD, tourDepartures, calibration
  state-machine, search/filter helpers) moved verbatim. ~600 LOC.
- server/db/tour.test.ts: smoke + null-DB happy-path.
- server/db.ts: function bodies deleted; new `export * from "./db/tour"` added.
- db.ts: ~3,210 → ~2,610 LOC.

tryReserveDepartureSlots + releaseDepartureSlots move WITH the tour domain
(per slot-machine cohesion). Destinations + price-comparisons + image-library
stay for now → split in Module 2.6 (search) or kept in Module 2.7 final.

Audit ref: v2-audit §C; v2-plan.md Module 2.1 line 146.
```

## Rollback

- Single `git revert <SHA>` restores `db.ts` to its post-2.1 state. `db/tour.ts` orphans. `db/booking.ts` (from 2.1) stays intact.
- Modules 2.3-2.7 blocked until 2.2 succeeds or is reverted + retried.

## Manual intervention

- **Jeff:** review the commit diff (~600 LOC moved). Spot-check: confirm `tryReserveDepartureSlots` retained its `tx?` parameter (Phase 2 money-path atomicity).
- **Supervisor:** verify `db/booking.ts` + `db/tour.ts` exports don't collide. Run:
  ```bash
  grep -oE "^export (async )?function ([a-zA-Z]+)" server/db/booking.ts server/db/tour.ts \
    | sort -k3 | uniq -d -f2
  # expect empty
  ```
- **Supervisor:** before Module 2.3, confirm `pnpm test` green.

## Test plan

- 1 new Vitest with 2 cases (exports smoke + null-DB happy path)
- Full regression
- Manual: 3 customer pages + 1 admin tour page render

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.2-a | Calibration helpers (saveCalibrationResult, approveTour, rejectTour) — move with tours (current plan) OR move to `db/log.ts` (Module 2.5, since calibration is an audit-style record)? | **Move with tours.** They mutate `tours.calibrationStatus` and are read by tour-detail + admin tour review flow. v2-plan.md Module 2.1 line 146 says "tours, departures, regions" go in tour.ts → calibration is part of tour state. |
| D2.2-b | `searchTours()` at db.ts:1407 — does the full-text search FROM clause cross any other domain (bookings? user history?)? If yes, decompose; if no, keep in tour.ts. | **Keep in tour.ts.** Sub-agent grep-checks; reports back to supervisor. If cross-domain, escalate. |

**Must be committed before Module 2.3 starts.**
