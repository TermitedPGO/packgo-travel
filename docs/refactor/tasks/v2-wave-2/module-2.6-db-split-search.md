# v2 · Wave 2 · Module 2.6 — Split `server/db.ts` (search/index domain extraction)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.1 D2 split, 6th of 7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 139-160; v2-plan.md line 149 ("search index, browsingHistory, favorites")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (blocked on Module 2.5)
**Est. effort:** 1.5 h AI + 10 min Jeff review
**Risk tier:** LOW-MEDIUM — search hits homepage + tour listing; high read volume.
**Deploy window:** any morning after 2.5 stable for ≥4h.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.5 committed AND green.

## Goal

Extract **search-tier helpers** (image library + price comparisons + competitor data + destinations + filter helpers not already moved) from `server/db.ts` into `server/db/search.ts` (≤500 LOC). Shim. Vitest smoke.

**Note on naming:** v2-plan.md line 149 says "search index, browsingHistory, favorites" go in this file. But browsingHistory + favorites were already moved to `db/user.ts` (Module 2.3) since they're per-user data. Module 2.6 re-scopes to: image library + competitor tours (search-tier discovery) + destinations + tour price comparisons. If Jeff prefers strict v2-plan naming, rename to `db/discovery.ts` or `db/index.ts` (latter conflicts with `db/index.ts` barrel pattern — avoid).

## Pre-requisites

- Modules 2.1-2.5 committed; tests green
- `server/db/{booking,tour,user,payment,log}.ts` exist
- Shim block has 5 `export *` lines

## Inputs (read these before executing)

1. **Post-2.5 `server/db.ts`** — grep remaining functions.
2. **`drizzle/schema.ts`** — `imageLibrary`, `destinations`, `competitorTours`, `competitorDepartures`, `competitorPriceHistory`, `competitorAlerts`, `tourPriceComparisons`. Confirm tables.
3. Previous extractions for pattern.

## Scope (what this module owns)

| File | Action | Target LOC |
|---|---|---|
| `server/db/search.ts` (new) | Image library + destinations + competitor + price comparisons | ≤500 |
| `server/db/search.test.ts` (new) | 1+ Vitest | ≤80 |
| `server/db.ts` (modified) | Delete moved bodies; add 6th shim line | reduces ~600 LOC |

### Functions to extract (sub-agent grep first)

Expected:

**Image library** (was db.ts L1567-2349 with gaps):
- `getImageLibrary(options)`
- `addImageToLibrary(image)`
- `deleteImageFromLibrary(id, userId)`
- `incrementImageUsage(id)`
- `getImageById(id)`
- `addToImageLibrary` (alias re-export of addImageToLibrary)
- `searchImageLibrary(...)`
- `getImagesByTourId(tourId)`
- `updateImageLibraryItem(...)`

**Destinations** (was L1780-1913):
- `getAllDestinations`
- `getActiveDestinations`
- `getDestinationById`
- `createDestination`
- `updateDestination`
- `deleteDestination`
- `reorderDestinations`

**Competitor tours** (was L2466-2848):
- `createCompetitorTour`
- `getCompetitorTours`
- `getCompetitorTourById`
- `getActiveCompetitorTours`
- `updateCompetitorTour`
- `deleteCompetitorTour`
- `updateCompetitorTourScrapeStatus`
- `getLatestDepartures`
- `upsertCompetitorDepartures`
- `insertPriceHistory`
- `getPriceHistory`
- `insertCompetitorAlerts`
- `getCompetitorAlerts`
- `getUnreadAlertCount`
- `markAlertAsRead`
- `markAllAlertsAsRead`
- `deleteOldAlerts`

**Price comparisons** (was L3298-3349):
- `upsertTourPriceComparison`
- `getTourPriceComparison`
- `getAllPriceComparisons`
- `deleteTourPriceComparison`

**Homepage content** (was L1713-1771):
- `getHomepageContent`
- `getAllHomepageContent`
- `upsertHomepageContent`

**Total: ~32 functions, ~600 LOC.**

### Out of scope

- **Marketing campaigns** (`createMarketingCampaign` etc. L2856+) — those are NOT search-tier; leave residual or extract to `db/accounting.ts` (Module 2.7) since marketing spend ties to accounting; OR a new `db/marketing.ts` if Jeff wants it. Default: residual.
- **Visa applications** — residual (or own file in 2.7).
- **Affiliate clicks** — residual (or own file in 2.7).

## Procedure

### Step 1 — Verification grep

```bash
grep -nE "^export async function" server/db.ts | \
  grep -iE "image|destination|competitor|comparison|homepage|alert"
wc -l server/db.ts  # expect ~1,840
```

### Step 2 — Create `server/db/search.ts`

```ts
// server/db/search.ts — extracted from server/db.ts in v2 Wave 2 Module 2.6.
//
// Owns: imageLibrary + destinations + homepageContent + competitor tours +
// price comparisons. These are search-tier discovery + content-presentation
// helpers — read-heavy, cache-friendly.

import { eq, and, desc, gte, lte, like, or, sql, inArray } from "drizzle-orm";
import { /* schema imports */ } from "../../drizzle/schema";
import { getDb } from "../db";

// === Image Library ===
// ... verbatim
```

### Step 3 — Modify `server/db.ts`

1. Delete bodies.
2. Add 6th shim line:

```ts
export * from "./db/booking";
export * from "./db/tour";
export * from "./db/user";
export * from "./db/payment";
export * from "./db/log";
export * from "./db/search";
```

3. Verify `wc -l server/db.ts` ≤1,240.

### Step 4 — Smoke test

```ts
// server/db/search.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, getDb: vi.fn().mockResolvedValue(null) };
});

import { getImageLibrary, getAllDestinations, getCompetitorTours } from "./search";

describe("db/search", () => {
  it("exports image library + destination + competitor functions", () => {
    expect(typeof getImageLibrary).toBe("function");
    expect(typeof getAllDestinations).toBe("function");
    expect(typeof getCompetitorTours).toBe("function");
  });

  it("getAllDestinations returns [] when DB not init", async () => {
    expect(await getAllDestinations()).toEqual([]);
  });
});
```

### Step 5 — Verify

```bash
pnpm tsc --noEmit
pnpm test server/db/search.test.ts
pnpm test
```

### Step 6 — Smoke

- Homepage renders (destinations + image library reads)
- Search results page renders
- Admin competitor monitor tab renders
- Admin image library tab renders

## Acceptance Criteria

- [ ] `server/db/search.ts` exists with ~32 named exports
- [ ] `server/db/search.ts` ≤500 LOC
- [ ] `server/db/search.test.ts` exists with 1+ passing test
- [ ] `server/db.ts` has 6 `export * from` lines
- [ ] `server/db.ts` reduces ≥550 LOC
- [ ] No export collisions
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` green
- [ ] Manual: homepage + search + admin competitor tabs render

## Deliverable

- New: `server/db/search.ts`, `server/db/search.test.ts`
- Modified: `server/db.ts`

**Commit:**
```
refactor(db): v2 Wave 2 Module 2.6 — extract search/discovery from db.ts

Sixth sub-task in the D2-locked 7-file db.ts split.

- server/db/search.ts: imageLibrary + destinations + competitor tours +
  price comparisons + homepageContent verbatim. ~32 functions, ~600 LOC.
- server/db/search.test.ts: smoke covering image + destination + competitor.
- server/db.ts: ~1,840 → ~1,240 LOC; 6 shim lines.

Marketing + visa + affiliate helpers DEFERRED to Module 2.7 (final residual
decision) — they're not search-tier and don't fit cleanly here.

Audit ref: v2-audit §C; v2-plan.md Module 2.1 line 149.
```

## Rollback

`git revert <SHA>`.

## Manual intervention

- **Jeff:** review.
- **Supervisor:** name-collision grep.
- **Supervisor:** verify homepage renders before Module 2.7 starts (search is the biggest customer-facing read path in the split).

## Test plan

- 1 Vitest, 2+ cases
- Full regression
- Manual: homepage + search + admin competitor

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.6-a | File name: `db/search.ts` (current) vs `db/discovery.ts` (more accurate, since image library + destinations aren't "search" per se)? | **`db/search.ts`** per v2-plan line 149 verbatim. Rename in v3 if Jeff disagrees. |
| D2.6-b | Marketing campaigns: leave residual or extract here? | **Leave residual.** Module 2.7 final residual decides. |

**Must be committed before Module 2.7 starts.**
