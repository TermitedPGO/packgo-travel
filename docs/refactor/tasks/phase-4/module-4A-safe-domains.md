# Phase 4A · Safe Domains (Sub-PR 1 of 5)

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3-4 h AI + 0.5 h Jeff review
**Risk tier:** LOWEST — read-mostly customer-facing domains, no money, validates split mechanic
**Deploy window:** Any weekday morning

## Goal
Extract the four lowest-risk customer-facing domains (`newsletter`, `favorites`, `browsingHistory`, `tours-read`) from the 10,122-line `server/routers.ts` into individual `server/routers/<domain>.ts` files, each ≤300 LOC, each with a happy-path Vitest. Top-level `server/routers.ts` retains everything else unchanged — composition shell finalized in Module 4F.

## Pre-requisites
- Phase 0 complete (clean `git status` at HEAD)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0; husky pre-commit hook live)
- Phase 2 complete (Stripe webhook hardened — not load-bearing for 4A but the sequencing rule per plan.md "Dependency Graph" must be honored)
- Phase 3 complete (FloatingOpsAgent/TodayOverview deleted — smaller search surface)
- `server/routers/` directory already exists with five already-extracted routers (agentRouter, plaidRouter, suppliersRouter, toolsRouter, tourMonitorRouter) — they serve as the canonical extraction pattern; new files follow the same shape.
- This module lands as one squash-merge commit; modules 4B-4F MAY proceed in parallel only on domains 4A does NOT touch.

## Inputs (read these before executing)

- `server/routers.ts` lines 1-119 — module-level imports + bound-string helpers (`shortStr`, `mediumStr`, `longStr` at L34-38). **Critical: 4A's new files MUST import these helpers, not redefine them.** Supervisor decides at PR-merge whether to extract them to `server/_core/inputSchemas.ts` (recommended) or temporarily re-export from `routers.ts`.
- `server/routers.ts` L118-122 — the `appRouter = router({ ... })` open and `system: systemRouter` placement (alphabetic ordering convention).
- Existing canonical extractions (read one to confirm shape):
  - `server/routers/agentRouter.ts` (2,804 LOC — over-large but pattern is correct)
  - `server/routers/toolsRouter.ts` (smaller, cleaner example)
- Per-domain source ranges (exact line numbers from `grep -nE` on commit at refactor start):
  - **newsletter:** L5325-5430 (106 LOC, 1 routerKey)
  - **favorites:** L1486-1528 (43 LOC)
  - **browsingHistory:** L1529-1552 (24 LOC)
  - **tours-read:** L1553-3900 (2348 LOC TOTAL but only the read-procedures get split out; admin mutations + getRouteMap stay or split further — see Domain Inventory)
- `CLAUDE.md §九` (Vibe Coding workflow — sub-agent §9.4 pattern)
- Client tRPC call inventory: see "Client tRPC Call Audit" section below

## Domain Inventory (this PR only)

| Domain | Current LOC in routers.ts | Source line range | Target file(s) | Target LOC after split |
|---|---|---|---|---|
| newsletter | 106 | 5325-5430 | `server/routers/newsletter.ts` | ≤120 |
| favorites | 43 | 1486-1528 | `server/routers/favorites.ts` | ≤60 |
| browsingHistory | 24 | 1529-1552 | `server/routers/browsingHistory.ts` | ≤40 |
| tours (READ-ONLY paths) | ~700 of 2348 | see procedure map below | `server/routers/toursRead.ts` + `server/routers/toursRouteMap.ts` | ≤300 each |

**`tours` is too big to extract whole — split decision:**

The `tours` domain has 38 procedures totaling 2348 LOC. **Procedure `getRouteMap` alone is 763 LOC (L1618-2380)** — a single procedure containing the AI base-map SVG generator. Per CLAUDE.md §3.2 and Open Question Q4 in plan.md, the resolution at Phase 4A start is:

**Split `tours` into THREE files across PRs:**

- **In 4A (this PR):**
  - `server/routers/toursRead.ts` — public read paths: `list` (L1555-1569), `getById` (L1570-1583), `getFilterOptions` (L1584-1605), `getDepartureCities` (L2381-2389), `search` (L2390-2448), `suggest` (L2449-2566), `getSimilar` (L3633-3660), `getRecommended` (L3661-3694), `generatePdf` (L3389-3464). Estimated ~280 LOC.
  - `server/routers/toursRouteMap.ts` — solo: `getRouteMap` (L1618-2380, 763 LOC) + `regenerateAiMap` (L1606-1617). **This file will be ~775 LOC, exceeding the 300 LOC limit by design.** Per CLAUDE.md §九, that's acceptable when the procedure is a single coherent unit; we still split it out so the rest of the codebase stays ≤300, and the v2 refactor backlog gets an entry to attack `getRouteMap` itself (SVG render extraction). Document the exception with a header comment.
- **In 4E (admin tools PR):** All 27 remaining `tours.*` admin mutation procedures (create, update, patchField, delete, batchDelete, duplicate, generation lifecycle, calibration approve/reject, diagnose, llmStressTest, getExtractedDepartures, etc.) → `server/routers/toursAdmin.ts`.

This 4A PR DOES NOT touch admin mutation paths inside `tours.*`. They stay in routers.ts until 4E.

### Procedure-level map (this PR carves out)

| Procedure | Line range | LOC | Access | Target file |
|---|---|---|---|---|
| `tours.list` | 1555-1569 | 15 | public | toursRead.ts |
| `tours.getById` | 1570-1583 | 14 | public | toursRead.ts |
| `tours.getFilterOptions` | 1584-1605 | 22 | public | toursRead.ts |
| `tours.regenerateAiMap` | 1606-1617 | 12 | admin | toursRouteMap.ts |
| `tours.getRouteMap` | 1618-2380 | 763 | public | toursRouteMap.ts |
| `tours.getDepartureCities` | 2381-2389 | 9 | public | toursRead.ts |
| `tours.search` | 2390-2448 | 59 | public | toursRead.ts |
| `tours.suggest` | 2449-2566 | 118 | public | toursRead.ts |
| `tours.generatePdf` | 3389-3464 | 76 | public | toursRead.ts |
| `tours.getSimilar` | 3633-3660 | 28 | public | toursRead.ts |
| `tours.getRecommended` | 3661-3694 | 34 | public | toursRead.ts |

Total LOC extracted in 4A: ~106 (newsletter) + 43 (favorites) + 24 (browsingHistory) + 1150 (tours-read) ≈ **1323 LOC out of routers.ts**.

## Sub-Agent Strategy

**Sub-agent count for this PR: 5 (parallel).**

- **Sub-agent A — newsletter**: extract L5325-5430 → `server/routers/newsletter.ts` + `server/routers/newsletter.test.ts`. ≤120 LOC target.
- **Sub-agent B — favorites**: extract L1486-1528 → `server/routers/favorites.ts` + `.test.ts`. ≤60 LOC.
- **Sub-agent C — browsingHistory**: extract L1529-1552 → `server/routers/browsingHistory.ts` + `.test.ts`. ≤40 LOC.
- **Sub-agent D — toursRead**: extract the 10 public-read procedures listed above → `server/routers/toursRead.ts` + `.test.ts`. ≤300 LOC.
- **Sub-agent E — toursRouteMap**: extract `getRouteMap` + `regenerateAiMap` → `server/routers/toursRouteMap.ts` + `.test.ts`. ~775 LOC (documented exception).

**Supervisor coordination (Stage 4 main thread):**
1. Gate: each sub-agent reports back the exact line range it took, plus its new file LOC.
2. Supervisor verifies disjoint source ranges (no overlapping lines pulled twice).
3. Supervisor stitches the deletion from `server/routers.ts` (one big diff covering all 5 extracted ranges) + the import block + the `tours: router({ ...remaining })` rewrite to point to the new sub-routers.
4. Composition file rewrite is deferred to **Module 4F** — for 4A, `routers.ts` becomes:
   ```ts
   import { newsletterRouter } from "./routers/newsletter";
   import { favoritesRouter } from "./routers/favorites";
   import { browsingHistoryRouter } from "./routers/browsingHistory";
   import { toursReadRouter } from "./routers/toursRead";
   import { toursRouteMapRouter } from "./routers/toursRouteMap";
   // ...existing imports...
   export const appRouter = router({
     // ...
     favorites: favoritesRouter,
     browsingHistory: browsingHistoryRouter,
     newsletter: newsletterRouter,
     tours: router({
       ...toursReadRouter._def.procedures,
       ...toursRouteMapRouter._def.procedures,
       // ...remaining 27 admin procedures stay inline until 4E
     }),
     // ...
   });
   ```
   **Note:** The `...router._def.procedures` spread pattern is required because client expects `trpc.tours.list` (NOT `trpc.toursRead.list`). DO NOT change the public router key shape. If the spread approach errors at runtime, fall back to constructing `tours: router({ list: ..., getById: ..., ... })` by re-importing each procedure individually — supervisor decides.

**Sub-agent constraints:**
- Sub-agents touch ONLY their target line range in `server/routers.ts`.
- Sub-agents do NOT modify `server/db.ts` (out of scope; deferred to v2 per plan.md Q4).
- If a procedure cross-imports a helper still in `routers.ts` (e.g., `assertOwnsUsageLogs` at L80), sub-agent flags it; supervisor decides whether to extract the helper to `server/_core/<helper>.ts` OR temporarily re-import from `routers.ts`. Default: temporary re-import; helper extraction is its own commit if needed.
- Sub-agents import shared zod helpers (`shortStr`, `mediumStr`, `longStr`) from `server/routers.ts` (re-export from there for this PR) OR supervisor extracts them to `server/_core/inputSchemas.ts` as a prep commit before sub-agents start. **Recommendation: extract first.**

## Client tRPC Call Audit

Verified by `grep -rohE "trpc\.(newsletter|favorites|browsingHistory|tours)\.[a-zA-Z]+" client/src/`. Procedures consumed by client that depend on this PR:

**newsletter** (1 entry-point per pre-grep; verify):
- `trpc.newsletter.subscribe` — `client/src/components/NewsletterSection.tsx`

**favorites:**
- `trpc.favorites.list`, `trpc.favorites.add`, `trpc.favorites.remove`, `trpc.favorites.isFavorited` — used by tour-detail, account pages, header. Verify exact paths during sub-agent dispatch.

**browsingHistory:**
- `trpc.browsingHistory.record`, `trpc.browsingHistory.list` — used by tour detail (record on view) and account history page.

**tours (read paths confirmed in client):**
- `trpc.tours.list` — `client/src/components/SimilarTours.tsx`, `CompareBar.tsx:94`, `HomeWelcomeBack.tsx:56`, `home/HomeHero.tsx:33`, `home/HomeMomentsStrip.tsx`, `home/HomeFeaturedSpotlight.tsx`, `admin/TranslationsTab.tsx`, `admin/ToursTab.tsx:132`, `admin/SkillsTab.tsx:113`
- `trpc.tours.getById` — `client/src/pages/BookTour.tsx:60`, `client/src/pages/TourPrintView.tsx:71`
- `trpc.tours.getFilterOptions` — `client/src/pages/SearchResults.tsx:172`, `client/src/pages/Tours.tsx:529`, `client/src/pages/RegionPage.tsx`
- `trpc.tours.search` — `client/src/pages/CruisePage.tsx:81`, `client/src/pages/SearchResults.tsx:227`, `client/src/pages/Tours.tsx:551`
- `trpc.tours.suggest` — search dropdown autocomplete
- `trpc.tours.getSimilar` — `client/src/components/SimilarTours.tsx:16`
- `trpc.tours.getRouteMap` — `client/src/components/tour-detail/TourRouteMapSvg.tsx:99`
- `trpc.tours.getDepartureCities`, `trpc.tours.getRecommended`, `trpc.tours.generatePdf` — additional consumers; sub-agent D verifies exhaustive set with `grep -rohE "trpc\.tours\.[a-zA-Z]+" client/src/ | sort -u` before declaring done.

**ZERO-BREAK CONSTRAINT:** After this PR merges, **every one of these `trpc.<key>.<procedure>` paths must resolve identically** — same input schema, same output shape, same `protectedProcedure`/`publicProcedure` gating. The supervisor's stitch step preserves the `tours.*` namespace by using the spread pattern above.

## Procedure

1. **Supervisor (pre-fan-out, one commit):** Extract the three bound-string helpers (`shortStr`, `mediumStr`, `longStr` from L34-38 + the `CONTROL_CHARS`/`noControlChars` from L34-35) into `server/_core/inputSchemas.ts`. Re-export from `server/routers.ts` to preserve existing callers. This is a 1-file, ~15 LOC commit; lands first so sub-agents can import cleanly.

2. **Supervisor dispatches sub-agents A-E in parallel.** Each sub-agent receives:
   - Its source line range (exact)
   - Its target file path
   - Confirmation: "import shared types from `../db`, `../_core/trpc`, `../_core/inputSchemas`. Do NOT modify any of those."
   - Sub-agent reads the source range, copies procedure definitions verbatim into a new `router({ ... })` block, exports as `export const <domain>Router`, writes a `.test.ts` with one happy-path Vitest.

3. **Per-sub-agent extraction recipe:**
   ```ts
   // server/routers/newsletter.ts (example)
   import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
   import { TRPCError } from "@trpc/server";
   import { z } from "zod";
   import { shortStr, mediumStr, longStr } from "../_core/inputSchemas";
   import * as db from "../db";
   // ...other domain-specific imports as discovered during extraction...

   export const newsletterRouter = router({
     // ...verbatim copy of procedures from routers.ts L5326-5429...
   });
   ```

4. **Per-sub-agent Vitest recipe:**
   ```ts
   // server/routers/newsletter.test.ts
   import { describe, it, expect, vi } from "vitest";
   import { newsletterRouter } from "./newsletter";
   import * as db from "../db";

   describe("newsletter router", () => {
     it("subscribe happy-path: stores email + locale", async () => {
       const mockInsert = vi.fn().mockResolvedValue({ insertId: 1 });
       vi.spyOn(db, "getDb").mockResolvedValue({
         insert: () => ({ values: () => ({ onDuplicateKeyUpdate: mockInsert }) }),
       } as any);
       const caller = newsletterRouter.createCaller({
         user: null,
         session: null,
         req: {} as any,
         res: {} as any,
       });
       await caller.subscribe({ email: "test@example.com", locale: "zh-TW" });
       expect(mockInsert).toHaveBeenCalled();
     });
   });
   ```
   Each sub-agent writes ONE such happy-path test per new file. For files with multiple procedures, sub-agent picks the procedure most-used by the client (per `Client tRPC Call Audit`).

5. **Supervisor (post-fan-out, single commit):** apply the 5 sub-agent diffs as one squash-merge commit:
   - 5 new files in `server/routers/`
   - 5 new `*.test.ts` files
   - `server/routers.ts` shrinks by ~1323 LOC; the extracted procedure blocks are deleted and replaced by the spread/composition pattern
   - Verify `pnpm tsc --noEmit` + `pnpm test` green before commit

6. **Smoke test (Jeff or supervisor):**
   - Open production-mirror staging, visit homepage → tour list renders
   - Open a tour detail page → route map renders (calls `getRouteMap`)
   - Add a favorite → verify it persists across reload
   - Submit newsletter email → verify duplicate-resubscribe doesn't 500
   - Browse 3 tours in sequence → confirm `browsingHistory.list` returns them in account page

## Acceptance Criteria
- [ ] `server/_core/inputSchemas.ts` exists with `shortStr`/`mediumStr`/`longStr`/`CONTROL_CHARS`/`noControlChars` exports
- [ ] `server/routers/newsletter.ts` ≤120 LOC, default-exports `newsletterRouter`
- [ ] `server/routers/favorites.ts` ≤60 LOC, default-exports `favoritesRouter`
- [ ] `server/routers/browsingHistory.ts` ≤40 LOC, default-exports `browsingHistoryRouter`
- [ ] `server/routers/toursRead.ts` ≤300 LOC, default-exports `toursReadRouter`
- [ ] `server/routers/toursRouteMap.ts` exists; header comment documents the ~775 LOC exception with v2 backlog reference
- [ ] Five `*.test.ts` files exist, each with at least one happy-path Vitest case, all passing
- [ ] `server/routers.ts` shrinks by ≥1300 LOC (current 10,122 → ≤8,822)
- [ ] All 19 client tRPC paths listed in "Client tRPC Call Audit" still resolve in dev console (verify `pnpm dev` + browser network tab)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count UNCHANGED + 5 new test files pass
- [ ] `pnpm build` succeeds (catches any lazy-import refs)

## Deliverable
- Modified: `server/routers.ts` (1300+ LOC removed; imports added; composition rewritten)
- New:
  - `server/_core/inputSchemas.ts`
  - `server/routers/newsletter.ts` + `server/routers/newsletter.test.ts`
  - `server/routers/favorites.ts` + `server/routers/favorites.test.ts`
  - `server/routers/browsingHistory.ts` + `server/routers/browsingHistory.test.ts`
  - `server/routers/toursRead.ts` + `server/routers/toursRead.test.ts`
  - `server/routers/toursRouteMap.ts` + `server/routers/toursRouteMap.test.ts`
- Single squash-merge commit on a feature branch:
  ```
  refactor(routers): Phase 4A — safe domains split (newsletter, favorites, browsingHistory, tours-read)

  Extracts 4 lowest-risk customer-facing domains from the 10,122-line
  routers.ts god-file (audit P0-1). Each extracted domain gets its own
  server/routers/<domain>.ts plus a happy-path Vitest. Public router key
  shape preserved via spread pattern — zero client breakage.

  - server/_core/inputSchemas.ts: shared shortStr/mediumStr/longStr helpers
  - server/routers/newsletter.ts (106 → ≤120 LOC)
  - server/routers/favorites.ts (43 → ≤60 LOC)
  - server/routers/browsingHistory.ts (24 → ≤40 LOC)
  - server/routers/toursRead.ts (10 read procedures, ~280 LOC)
  - server/routers/toursRouteMap.ts (getRouteMap + regenerateAiMap, ~775 LOC documented exception)
  - routers.ts shrinks ~1323 LOC (10,122 → ~8,799)

  5 happy-path Vitest files added. All client trpc.<key>.* paths preserved.
  ```

## Rollback
- This PR lands as one squash-merge commit. Revert with `git revert <merge-SHA>` — routers.ts behavior reverts to pre-4A state, the 5 new files become orphans (next deploy bundles them out; they don't crash anything because nothing imports them anymore).
- The `server/_core/inputSchemas.ts` extraction commit is an independent revert if needed — but reverting it requires re-inlining the helpers in routers.ts; supervisor's call.
- If a single sub-agent's diff has a bug, the squash-merge structure means only the whole PR reverts. Use sub-agent's pre-merge branch in `git reflog` to recover individual diffs if needed.

## Manual intervention
- **Jeff:** review the squash-merge commit message and a 1-page diff summary before push. AI cannot judge whether a public router key shape change is acceptable; Jeff confirms "I see `tours.list` still works in staging."
- **Jeff:** run the smoke test in step 6 against staging before merging to main.
- **Supervisor (not Jeff):** verify the disjoint-source-range gate after all 5 sub-agents return.

## Test plan
- **Sub-agent A (newsletter):** Vitest covers `subscribe` happy path with mocked `db.getDb`. Verifies email + locale persisted via `onDuplicateKeyUpdate`.
- **Sub-agent B (favorites):** Vitest covers `add` happy path with a mocked authenticated user, verifies row insert.
- **Sub-agent C (browsingHistory):** Vitest covers `record` happy path — anonymous session writes a tour-view row.
- **Sub-agent D (toursRead):** Vitest covers `tours.list` happy path — returns the mocked active-tours array.
- **Sub-agent E (toursRouteMap):** Vitest covers `getRouteMap` cache-hit path — `db.getCachedRouteMap` returns a value, procedure short-circuits without invoking the SVG generator. (Full SVG-generation path is deferred to v2 backlog; happy-path = cache hit is sufficient regression anchor.)

After all 5 sub-agent tests pass, run full `pnpm test` to confirm regression-anchor pass count unchanged. Then `pnpm tsc --noEmit` + `pnpm build` as final gates.
