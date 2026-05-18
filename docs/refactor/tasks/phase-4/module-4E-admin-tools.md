# Phase 4E · Admin Tools (Sub-PR 5 of 5)

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4-5 h AI + 0.5 h Jeff review (slightly larger than plan estimate due to actual domain count 14, not ~10)
**Risk tier:** LOW-MEDIUM — admin-only blast radius, but multiple mutation paths; touching skills/translation/etc. matters for daily admin ops
**Deploy window:** Any weekday morning

## Goal
Extract every remaining admin-mutation domain from `server/routers.ts` so that after 4E lands, the only inline procedures left in `routers.ts` are the auth/membership/photos/ai handful that have no clean home AND `system: systemRouter`. Module 4F then finalizes the ~30-line composition shell.

**Domain count discovery:** the plan.md estimated "remaining admin mutations (autonomous mgmt, calibration, marketing, translation, exchangeRate, competitor, affiliate, wechatAssist, visa-admin, skills-admin)" — ~10 domains. The **actual count of remaining top-level keys after 4A-4D is 14** (plus the already-extracted-via-import keys agent/tools/plaid/suppliers/tourMonitor which are imports, not extractions). See Domain Inventory.

## Pre-requisites
- Phases 0/1/2/3 complete
- Modules 4A, 4B, 4C merged and stable for ≥24 hours
- Module 4D merged and stable for ≥48 hours (Jeff confirms zero money-path anomalies)
- This module lands as one squash-merge commit
- Module 4F follows immediately after to clean up the composition file

## Inputs (read these before executing)

- `server/routers.ts` per-domain ranges (pre-4A baseline; post-4A/B/C/D shifted line numbers — sub-agents re-locate by domain-key grep):

| Domain | Pre-shift line range | LOC | # procs |
|---|---|---|---|
| `skills` | 6446-7415 | 970 | 55 |
| `translation` | 7416-7564 | 149 | ? |
| `exchangeRate` | 7565-7657 | 93 | ? |
| `competitor` | 7658-7802 | 145 | ? |
| `marketing` | 7803-7978 | 176 | ? |
| `visa` | 7979-8200 | 222 | ? |
| `affiliate` | 8201-8338 | 138 | ? |
| `wechatAssist` | 8485-8586 | 102 | ? |
| `marketingContent` | 8587-8619 | 33 | ? |
| `ops` | 8620-8727 | 108 | ? |
| `storage` | 8728-8767 | 40 | ? |
| `reconciliation` | 8768-8810 | 43 | ? |
| `posterGen` | 8811-9092 | 282 | ? |
| `aiQuotes` | 9093-9222 | 130 | ? |
| `invoices` | 9223-9414 | 192 | ? |
| `recurringExpenses` | 9415-9510 | 96 | ? |
| `posters` | 9549-9766 | 218 | ? |
| `reviews` | 9767-10122 | 356 | ? |
| `tours` (admin mutations leftover from 4A) | scattered in 1553-3900 | ~1200 | 27 |

**Total LOC in 4E: ~3700 + ~1200 (tours-admin) = ~4900 LOC across ~19 domain groups.**

- `tours` admin mutations (27 procedures NOT extracted in 4A): full list from Domain Inventory in 4A. They cluster as:
  - **CRUD:** create, update, patchField, delete, batchDelete, duplicate (~400 LOC)
  - **Generation lifecycle:** getMyGenerationJobs, getGenerationStatus, cancelGeneration, listActiveGenerations, submitAsyncGeneration, bulkImportFromLion, listLionCategories, saveFromPreview (~280 LOC)
  - **Lifecycle status:** toggleStatus, toggleFeatured, getPendingReview, approveTour, rejectTour, getCalibrationResult (~130 LOC)
  - **Diagnostics:** diagnose, diagnoseEnv, llmStressTest (~170 LOC)
  - **Departures admin:** getExtractedDepartures, confirmExtractedDepartures, saveExtractedDepartures, backfillLionDepartures (~205 LOC)

- `skills` (970 LOC, 55 procedures) sub-clusters from procedure listing:
  - **CRUD:** list, listByType, getById, create, update, delete (~130 LOC)
  - **Apply / Learn:** matchToContent, applyRules, seedBuiltIn, getLearningSessions, getApplicationHistory, learnFromPdf, initializeBuiltIn (~85 LOC)
  - **Tests / Stats:** runTests, getStats, getDependencies (~125 LOC)
  - **AI Learn:** aiLearn, aiBatchLearn, applyLearnedKeywords, createSuggestedSkill, getLearningRecommendations (~110 LOC)
  - **Scheduling:** getSchedules, createSchedule, updateSchedule, deleteSchedule, triggerScheduledLearning, triggerManualLearning, getLearningHistory, updateLearningHistoryStatus (~100 LOC)
  - **Performance dashboard:** getDashboardStats, getLearningTrends, getAdoptionRates, getSourceDistribution, getTopTours, getPrioritizedTours (~50 LOC)
  - **Review queue:** getReviewQueue, approveSkill, rejectSkill, addToReviewQueue (~140 LOC)
  - **Usage telemetry:** recordTourView, updatePopularityScores, recordSkillTrigger, recordFeedback, recordConversion (~80 LOC)
  - **Performance metrics:** getPerformanceDashboard, getSkillPerformanceSummary, getSkillPerformanceTrend, getUsageLogs (~50 LOC)
  - **Auto-approval rules:** getAutoApprovalRules, createAutoApprovalRule, updateAutoApprovalRule, deleteAutoApprovalRule, initializeDefaultRules, getRuleStatistics, applyAutoApprovalRules (~85 LOC)

## Domain Inventory (this PR only)

| Domain | Pre-shift LOC | Post-4A line range location | Target file(s) | Target LOC after split |
|---|---|---|---|---|
| tours-admin (27 procs) | ~1200 | scattered in routers.ts | `server/routers/toursAdmin.ts` | ≤300 — likely split into `toursAdmin/{crud,generation,lifecycle,diagnostics,departures}.ts` (5 sub-files) |
| skills (55 procs) | 970 | by `skills:` grep | `server/routers/skills/{crud,learning,scheduling,review,performance,autoApproval}.ts` (6 sub-files) | ≤200 each |
| translation | 149 | by `translation:` grep | `server/routers/translation.ts` | ≤200 |
| exchangeRate | 93 | by `exchangeRate:` grep | `server/routers/exchangeRate.ts` | ≤120 |
| competitor | 145 | by `competitor:` grep | `server/routers/competitor.ts` | ≤180 |
| marketing | 176 | by `marketing:` grep | `server/routers/marketing.ts` | ≤200 |
| visa | 222 | by `visa:` grep | `server/routers/visa.ts` | ≤250 |
| affiliate | 138 | by `affiliate:` grep | `server/routers/affiliate.ts` | ≤180 |
| wechatAssist | 102 | by `wechatAssist:` grep | `server/routers/wechatAssist.ts` | ≤140 |
| marketingContent | 33 | by `marketingContent:` grep | `server/routers/marketingContent.ts` | ≤60 |
| ops | 108 | by `ops:` grep | `server/routers/ops.ts` | ≤140 |
| storage | 40 | by `storage:` grep | `server/routers/storage.ts` | ≤60 |
| reconciliation | 43 | by `reconciliation:` grep | `server/routers/reconciliation.ts` | ≤60 |
| posterGen | 282 | by `posterGen:` grep | `server/routers/posterGen.ts` | ≤300 |
| aiQuotes | 130 | by `aiQuotes:` grep | `server/routers/aiQuotes.ts` | ≤180 |
| invoices | 192 | by `invoices:` grep | `server/routers/invoices.ts` | ≤220 |
| recurringExpenses | 96 | by `recurringExpenses:` grep | `server/routers/recurringExpenses.ts` | ≤140 |
| posters | 218 | by `posters:` grep | `server/routers/posters.ts` | ≤260 |
| reviews | 356 | by `reviews:` grep | `server/routers/reviews.ts` | ≤300 if possible; if exceeds split into `reviews/{public,admin}.ts` |

**Total: 19 domain groups → ~21 new files** (skills + tours-admin sub-splits add files).

## Sub-Agent Strategy

**Sub-agent count for this PR: 7 (parallel) — chunked to keep each sub-agent's scope manageable.**

- **Sub-agent A — toursAdmin** (27 procs across 5 sub-files): biggest scope, gets one agent solo to manage the sub-clustering. Produces 5 files in `server/routers/toursAdmin/` + 5 happy-path Vitest. ~1200 LOC total.
- **Sub-agent B — skills** (55 procs across 6 sub-files): second-biggest scope, solo agent. Produces 6 files in `server/routers/skills/` + 6 happy-path Vitest. ~970 LOC.
- **Sub-agent C — admin mutation cluster 1** (translation, exchangeRate, competitor, marketing): 4 files. ~565 LOC.
- **Sub-agent D — admin mutation cluster 2** (visa, affiliate, wechatAssist, marketingContent): 4 files. ~495 LOC.
- **Sub-agent E — admin mutation cluster 3** (ops, storage, reconciliation): 3 files. ~191 LOC.
- **Sub-agent F — admin mutation cluster 4** (posterGen, aiQuotes, invoices, recurringExpenses): 4 files. ~700 LOC.
- **Sub-agent G — admin mutation cluster 5** (posters, reviews): 2 files. ~574 LOC.

**Supervisor coordination:**

1. Per-sub-agent gate: target file LOC reported back; if any single file exceeds 300 (excluding the documented `toursRouteMap.ts` style exceptions), escalate sub-split.
2. **Cross-sub-agent helper conflict check:** sub-agents A and B both work on tours/skills which historically share helpers (e.g., calibrationAgent invocations). If both flag shared helpers, supervisor extracts to `server/_core/{toursHelpers,skillsHelpers}.ts` and re-dispatches.
3. Stitch: all 7 sub-agent diffs become one squash-merge commit.
4. `pnpm tsc --noEmit` + `pnpm test` green gate.

**Sub-agent constraints:**
- Sub-agents do NOT modify `server/db.ts`.
- Sub-agents import `shortStr`/`mediumStr`/`longStr` from `server/_core/inputSchemas.ts`.
- Sub-agents A and B create subdirectories (`server/routers/toursAdmin/`, `server/routers/skills/`); other sub-agents create flat files in `server/routers/`.
- For sub-files within a subdirectory: each sub-file exports a router (e.g., `toursAdminCrudRouter`), and an `index.ts` in the subdirectory composes them:
  ```ts
  // server/routers/toursAdmin/index.ts
  import { toursAdminCrudRouter } from "./crud";
  import { toursAdminGenerationRouter } from "./generation";
  // ...
  export const toursAdminRouter = router({
    ...toursAdminCrudRouter._def.procedures,
    ...toursAdminGenerationRouter._def.procedures,
    // ...
  });
  ```

## Client tRPC Call Audit

Verified by exhaustive `grep -rohE "trpc\.(skills|translation|exchangeRate|competitor|marketing|visa|affiliate|wechatAssist|marketingContent|ops|storage|reconciliation|posterGen|aiQuotes|invoices|recurringExpenses|posters|reviews)\.[a-zA-Z]+" client/src/ | sort -u`.

**Sub-agents MUST run the above exact grep and confirm every result is covered by their extracted procedure names.** Any client path that doesn't match a procedure → escalate (means the procedure was missed in extraction).

**High-confidence client consumers (from earlier grep at refactor start):**

- `trpc.skills.*` — `client/src/components/admin/SkillsTab.tsx` (heavy consumer; many of the 55 procedures)
- `trpc.translation.*` — `client/src/components/admin/TranslationsTab.tsx`
- `trpc.exchangeRate.*` — `client/src/components/admin/ExchangeRatesTab.tsx`
- `trpc.competitor.*` — `client/src/components/admin/CompetitorPricingTab.tsx`
- `trpc.marketing.*`, `trpc.marketingContent.*` — `client/src/components/admin/MarketingTab.tsx`
- `trpc.visa.*` — both customer-facing (`client/src/pages/ChinaVisa*.tsx`) AND admin
- `trpc.affiliate.*` — admin tab + maybe homepage embeds
- `trpc.wechatAssist.*` — admin WeChat assist tab
- `trpc.ops.*` — admin OfficeOverviewTab maybe
- `trpc.storage.*` — admin storage tools tab
- `trpc.reconciliation.*` — admin reconciliation tab
- `trpc.posterGen.*`, `trpc.posters.*` — admin poster generation tab
- `trpc.aiQuotes.*` — admin AI quote generation tool
- `trpc.invoices.*` — admin invoices tab
- `trpc.recurringExpenses.*` — admin financial tab
- `trpc.reviews.*` — both customer-facing (review submit on tour detail) AND admin moderation
- `trpc.tours.<27 admin procs>` — admin ToursTab, TourEditDialog, AutonomousAgentsTab

**ZERO-BREAK CONSTRAINT:** All paths resolve identically post-merge.

## Procedure

1. **Supervisor (pre-fan-out): re-locate every domain in post-4D routers.ts by grep.** Cache the current line ranges in `/tmp/4e-line-map.txt`. Note: the file is now ~5,400 LOC instead of original 10,122; line numbers will be significantly different.

2. **Supervisor dispatches sub-agents A-G in parallel** with their respective domain lists and target file paths.

3. **Per-sub-agent extraction recipe:** same as 4A-4D pattern. Sub-agents A and B additionally create subdirectories + index.ts composers.

4. **Per-sub-agent Vitest recipe:** one happy-path test per top-level domain (not per sub-file). For sub-agent A (toursAdmin, 5 sub-files), 5 tests minimum. For sub-agent B (skills, 6 sub-files), 6 tests minimum. Others: 1 test per domain file.

5. **Supervisor (post-fan-out, single commit):**
   - 7 sub-agent diffs combined
   - ~21 new files in `server/routers/` (some inside subdirectories)
   - `server/routers.ts` shrinks by ~4900 LOC
   - **After this PR, `server/routers.ts` should be ~500-700 LOC** containing only:
     - Imports
     - `appRouter = router({ ... })` with mostly `<key>: <importedRouter>` lines
     - The still-inlined `auth`, `membership`, `photos`, `ai`, and any other domain Module 4F flags for further extraction
   - Verify `pnpm tsc --noEmit` + `pnpm test` green

6. **Smoke test (Jeff or supervisor):**
   - Open admin panel
   - Visit EVERY admin tab listed in client audit:
     - Skills tab (heaviest), Translations, Exchange Rates, Competitor Pricing, Marketing, Visa Admin, Affiliate, WeChat Assist, Ops, Storage, Reconciliation, Poster Gen, AI Quotes, Invoices, Recurring Expenses, Reviews, Tours (admin mutations)
   - Each tab must load WITHOUT console error
   - Spot-check one mutation per tab (e.g., toggle a tour featured, edit an exchange rate, approve a skill)

## Acceptance Criteria
- [ ] All target files exist at the paths listed in Domain Inventory
- [ ] No single file exceeds 300 LOC except documented exceptions
- [ ] Sub-agent A produces `server/routers/toursAdmin/{crud,generation,lifecycle,diagnostics,departures}.ts` + `server/routers/toursAdmin/index.ts`
- [ ] Sub-agent B produces `server/routers/skills/{crud,learning,scheduling,review,performance,autoApproval}.ts` + `server/routers/skills/index.ts`
- [ ] At least ~19 happy-path Vitest cases across the 7 sub-agents (one per domain; A and B contribute multiple)
- [ ] All tests pass; `pnpm test` regression-anchor pass count UNCHANGED + new cases pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm build` succeeds
- [ ] `server/routers.ts` shrinks by ≥4900 LOC; total post-4E ≤700 LOC
- [ ] Every client `trpc.<key>.<procedure>` path covered by extracted procedure names
- [ ] Admin smoke (step 6) all-pass on staging

## Deliverable
- Modified: `server/routers.ts` (~4900 LOC removed; ~19 new imports added; domain blocks replaced with `<key>: <importedRouter>` references)
- New (~21 files + ~19 test files = ~40 new files):
  - `server/routers/toursAdmin/index.ts` + 5 sub-files + 5 tests
  - `server/routers/skills/index.ts` + 6 sub-files + 6 tests
  - `server/routers/translation.ts`, `exchangeRate.ts`, `competitor.ts`, `marketing.ts`, `visa.ts`, `affiliate.ts`, `wechatAssist.ts`, `marketingContent.ts`, `ops.ts`, `storage.ts`, `reconciliation.ts`, `posterGen.ts`, `aiQuotes.ts`, `invoices.ts`, `recurringExpenses.ts`, `posters.ts`, `reviews.ts` (17 files) + each `.test.ts` (17 files)
- Single squash-merge commit:
  ```
  refactor(routers): Phase 4E — admin tools (all remaining mutation domains)

  Extracts the final 19 admin/mutation domain groups from routers.ts:
  tours-admin (27 procs → 5 sub-files), skills (55 procs → 6 sub-files),
  + 17 flat domains (translation, exchangeRate, competitor, marketing,
  visa, affiliate, wechatAssist, marketingContent, ops, storage,
  reconciliation, posterGen, aiQuotes, invoices, recurringExpenses,
  posters, reviews).

  - 21 new router files (including subdirectory composers)
  - 19+ happy-path Vitest files
  - routers.ts shrinks ~4900 LOC (post-4D ~5400 → ≤700)
  - Composition pattern: <key>: <importedRouter> for every extracted domain
  - Module 4F next: finalize composition into 30-line shell

  Admin smoke verified on staging — every tab + spot-mutation pass.
  ```

## Rollback
- Single squash-merge: `git revert <merge-SHA>` restores all inlined domain blocks.
- 21 new files become orphans; bundle excludes on next deploy.
- Subdirectory revert: `git revert` keeps the empty directories; harmless. Next cleanup removes them.
- If a single admin tab has a regression, prefer to revert the whole PR rather than hot-patch — sub-agents work as one squashed unit; partial revert isn't supported by the merge structure.

## Manual intervention
- **Jeff:** review the squash-merge commit. The diff is large (~5000 LOC moved across ~40 new files) — focus review on:
  1. `tours: <importedRouter>` composition line (zero behavior change expected)
  2. `skills: <importedRouter>` composition line
  3. Any subdirectory `index.ts` composition that uses the spread pattern (visual confirm key names match)
  4. Spot-check 2-3 sub-files for verbatim extraction (no accidental edit slipped in)
- **Jeff:** run the admin smoke checklist (step 6) on staging — every tab opens, every spot-mutation works
- **Supervisor:** verify the exhaustive `grep -rohE` audit catches every client-consumed procedure
- **Supervisor:** verify Module 4F is ready to dispatch right after 4E merges (composition cleanup)

## Test plan
- 19+ new Vitest happy-path cases across sub-agents A-G
- Each test mocks the relevant db helpers and asserts the procedure returns the expected shape
- Full `pnpm test` + `pnpm tsc --noEmit` + `pnpm build` MUST be green
- Admin smoke checklist on staging (manual, Jeff)

**Sub-agent test depth examples:**
- Sub-agent A (toursAdmin): test `crud.toursAdmin.create` happy path → mocked db.insert returns new id, mocked LLM not invoked
- Sub-agent B (skills): test `skills.crud.list` happy path → mocked db returns array of skill rows
- Sub-agent C (translation): test `translation.translateTour` happy path → mocked translation cache hit returns Spanish copy
- ... and so on

After 4E lands, **Module 4F finalizes the composition shell.**
