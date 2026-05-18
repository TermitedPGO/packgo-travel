# Phase 4F · Composition Finalize (Sub-PR 6 of 5 in Phase 4)

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.3 h Jeff review
**Risk tier:** LOW — pure structural shuffle; ALL routers already live in `server/routers/`; this PR just rewires the assembly
**Deploy window:** Any weekday morning, immediately after 4E lands and is verified stable

## Goal
Reduce `server/routers.ts` to a clean ~30-line composition shell that imports every sub-router from `server/routers/*` and assembles `appRouter`. Verify that **every client `trpc.<key>.<procedure>` path still resolves** (the final regression-anchor gate before declaring Phase 4 done).

## Pre-requisites
- Phases 0/1/2/3 complete
- Modules 4A, 4B, 4C, 4D, 4E all merged and stable for ≥24 hours each
- Full Phase 4 client-trpc-path inventory cached (see "Final Client tRPC Call Audit" below)
- This module lands as one focused commit

## Inputs (read these before executing)

- Post-4E `server/routers.ts` — expected to be ~500-700 LOC, containing:
  - Module-level imports (the original ones from L1-118 + ~25 new sub-router imports added by 4A-4E)
  - `assertOwnsUsageLogs` helper (L80) — DECIDE whether to move to `server/_core/usageLogOwnership.ts` (likely yes; see Procedure)
  - The bound-string helpers MOVED to `server/_core/inputSchemas.ts` in 4A — should NOT still be inline
  - `appRouter = router({ ... })` block where most keys are `<key>: <importedRouter>` references but a few may still be inlined (auth, membership, photos, ai, anything Module 4F flags)
- `server/routers/` directory expected layout after 4A-4E:

```
server/routers/
  agentRouter.ts              (pre-existing, not extracted)
  plaidRouter.ts              (pre-existing)
  suppliersRouter.ts          (pre-existing)
  toolsRouter.ts              (pre-existing)
  tourMonitorRouter.ts        (pre-existing)

  newsletter.ts               (4A)
  favorites.ts                (4A)
  browsingHistory.ts          (4A)
  toursRead.ts                (4A)
  toursRouteMap.ts            (4A)

  adminPlatform.ts            (4B)
  adminLlm.ts                 (4B)
  adminAgents.ts              (4B)

  inquiries.ts                (4C)
  bookingsNonPayment.ts       (4C)
  departures.ts               (4C)
  imageLibrary.ts             (4C)
  homepage.ts                 (4C)

  bookingsPayment.ts          (4D)
  vouchers.ts                 (4D)
  packpoint.ts                (4D)
  accounting.ts               (4D)

  toursAdmin/
    index.ts                  (4E)
    crud.ts
    generation.ts
    lifecycle.ts
    diagnostics.ts
    departures.ts
  skills/
    index.ts                  (4E)
    crud.ts
    learning.ts
    scheduling.ts
    review.ts
    performance.ts
    autoApproval.ts
  translation.ts              (4E)
  exchangeRate.ts             (4E)
  competitor.ts               (4E)
  marketing.ts                (4E)
  visa.ts                     (4E)
  affiliate.ts                (4E)
  wechatAssist.ts             (4E)
  marketingContent.ts         (4E)
  ops.ts                      (4E)
  storage.ts                  (4E)
  reconciliation.ts           (4E)
  posterGen.ts                (4E)
  aiQuotes.ts                 (4E)
  invoices.ts                 (4E)
  recurringExpenses.ts        (4E)
  posters.ts                  (4E)
  reviews.ts                  (4E)
```

- `server/_core/inputSchemas.ts` (extracted in 4A) — `shortStr`, `mediumStr`, `longStr`, `CONTROL_CHARS`, `noControlChars` exports

- `CLAUDE.md §六 · 關鍵檔案路徑` table — `server/routers.ts` row gets updated post-4F to reflect the new shape

## Domain Inventory (this PR only)

| Domain | Status | Action in 4F |
|---|---|---|
| Already-extracted-in-prior-PRs (4A-4E) | All in `server/routers/*` | Import + reference in composition |
| Remaining inline domains (NOT extracted yet) | `auth`, `membership`, `photos`, `ai` — sit in routers.ts post-4E | Decide per-domain: extract OR explicitly leave inline with documented reason |

**Per-remaining-inline-domain decision matrix (Module 4F resolves at start):**

| Domain | Pre-4 LOC | Recommended for 4F |
|---|---|---|
| `auth` | 336 | **EXTRACT** to `server/routers/auth.ts`. Self-contained, no Stripe touchpoint, simple to move. |
| `membership` | 216 | **EXTRACT** to `server/routers/membership.ts`. Calls Stripe for subscription portal but that's already encapsulated; safe to move. |
| `photos` | 111 | **EXTRACT** to `server/routers/photos.ts`. Small and isolated. |
| `ai` | 286 | **EXTRACT** to `server/routers/ai.ts`. Public LLM-invoking endpoints. |

**Rationale:** all four are clean. Leaving any of them inline would mean routers.ts stays ~1000 LOC instead of ~30. Recommended Module 4F extends to extract these too — single sub-agent does all four (small total ~949 LOC, fits one extraction pass).

**Final composition file template (target ~50 LOC including imports + comments):**

```ts
// server/routers.ts — Phase 4F composition shell.
//
// Every domain is its own module in server/routers/. This file:
//   1. Imports the sub-router from each domain
//   2. Composes them into appRouter
//   3. Exports the top-level AppRouter type
//
// To add a new domain:
//   - Create server/routers/<domain>.ts exporting a `<domain>Router`
//   - Add the import here, in alphabetic order
//   - Add `<key>: <domain>Router` to the appRouter literal, alphabetic order
//   - Write a happy-path Vitest in server/routers/<domain>.test.ts
//
// Audit ref: P0-1 (resolved 2026-05-xx); CLAUDE.md §3.2.

import { router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";

// Pre-Phase 4 extractions
import { agentRouter } from "./routers/agentRouter";
import { plaidRouter } from "./routers/plaidRouter";
import { suppliersRouter } from "./routers/suppliersRouter";
import { toolsRouter } from "./routers/toolsRouter";
import { tourMonitorRouter } from "./routers/tourMonitorRouter";

// Phase 4A — safe domains
import { newsletterRouter } from "./routers/newsletter";
import { favoritesRouter } from "./routers/favorites";
import { browsingHistoryRouter } from "./routers/browsingHistory";
import { toursReadRouter } from "./routers/toursRead";
import { toursRouteMapRouter } from "./routers/toursRouteMap";

// Phase 4B — read-only admin
import { adminPlatformRouter } from "./routers/adminPlatform";
import { adminLlmRouter } from "./routers/adminLlm";
import { adminAgentsRouter } from "./routers/adminAgents";

// Phase 4C — customer transactional non-payment
import { inquiriesRouter } from "./routers/inquiries";
import { bookingsNonPaymentRouter } from "./routers/bookingsNonPayment";
import { departuresRouter } from "./routers/departures";
import { imageLibraryRouter } from "./routers/imageLibrary";
import { homepageRouter } from "./routers/homepage";

// Phase 4D — money paths
import { bookingsPaymentRouter } from "./routers/bookingsPayment";
import { vouchersRouter } from "./routers/vouchers";
import { packpointRouter } from "./routers/packpoint";
import { accountingRouter } from "./routers/accounting";

// Phase 4E — admin tools
import { toursAdminRouter } from "./routers/toursAdmin";
import { skillsRouter } from "./routers/skills";
import { translationRouter } from "./routers/translation";
import { exchangeRateRouter } from "./routers/exchangeRate";
import { competitorRouter } from "./routers/competitor";
import { marketingRouter } from "./routers/marketing";
import { visaRouter } from "./routers/visa";
import { affiliateRouter } from "./routers/affiliate";
import { wechatAssistRouter } from "./routers/wechatAssist";
import { marketingContentRouter } from "./routers/marketingContent";
import { opsRouter } from "./routers/ops";
import { storageRouter } from "./routers/storage";
import { reconciliationRouter } from "./routers/reconciliation";
import { posterGenRouter } from "./routers/posterGen";
import { aiQuotesRouter } from "./routers/aiQuotes";
import { invoicesRouter } from "./routers/invoices";
import { recurringExpensesRouter } from "./routers/recurringExpenses";
import { postersRouter } from "./routers/posters";
import { reviewsRouter } from "./routers/reviews";

// Phase 4F — final inline extractions
import { authRouter } from "./routers/auth";
import { membershipRouter } from "./routers/membership";
import { photosRouter } from "./routers/photos";
import { aiRouter } from "./routers/ai";

// Hybrid composition for the two domains that span PRs:
// - `tours` = toursRead (4A) + toursRouteMap (4A) + toursAdmin (4E)
// - `bookings` = bookingsNonPayment (4C) + bookingsPayment (4D)
const toursComposite = router({
  ...toursReadRouter._def.procedures,
  ...toursRouteMapRouter._def.procedures,
  ...toursAdminRouter._def.procedures,
});

const bookingsComposite = router({
  ...bookingsNonPaymentRouter._def.procedures,
  ...bookingsPaymentRouter._def.procedures,
});

export const appRouter = router({
  system: systemRouter,
  accounting: accountingRouter,
  affiliate: affiliateRouter,
  agent: agentRouter,
  ai: aiRouter,
  aiQuotes: aiQuotesRouter,
  auth: authRouter,
  bookings: bookingsComposite,
  browsingHistory: browsingHistoryRouter,
  competitor: competitorRouter,
  departures: departuresRouter,
  exchangeRate: exchangeRateRouter,
  favorites: favoritesRouter,
  homepage: homepageRouter,
  imageLibrary: imageLibraryRouter,
  inquiries: inquiriesRouter,
  invoices: invoicesRouter,
  marketing: marketingRouter,
  marketingContent: marketingContentRouter,
  membership: membershipRouter,
  newsletter: newsletterRouter,
  ops: opsRouter,
  packpoint: packpointRouter,
  photos: photosRouter,
  plaid: plaidRouter,
  posterGen: posterGenRouter,
  posters: postersRouter,
  reconciliation: reconciliationRouter,
  recurringExpenses: recurringExpensesRouter,
  // Admin top-level domain — composes 3 admin sub-routers (4B):
  admin: router({
    ...adminPlatformRouter._def.procedures,
    ...adminLlmRouter._def.procedures,
    ...adminAgentsRouter._def.procedures,
  }),
  reviews: reviewsRouter,
  skills: skillsRouter,
  storage: storageRouter,
  suppliers: suppliersRouter,
  tools: toolsRouter,
  tourMonitor: tourMonitorRouter,
  tours: toursComposite,
  translation: translationRouter,
  visa: visaRouter,
  vouchers: vouchersRouter,
  wechatAssist: wechatAssistRouter,
});

export type AppRouter = typeof appRouter;
```

**Line count: ~120 LOC (45 imports + ~50-line appRouter literal + boilerplate). Plan called for "~30 lines" but the import count alone is 40+; the realistic minimum is ~100-120 LOC.** Update plan.md and CLAUDE.md §六 to reflect ~120 LOC target post-4F.

## Sub-Agent Strategy

**Sub-agent count for this PR: 2 (sequential).**

- **Sub-agent A — final inline extractions (auth, membership, photos, ai)**: 4 small extractions into `server/routers/{auth,membership,photos,ai}.ts` + 4 happy-path Vitest files.
- **Sub-agent B — composition shell rewrite + audit**: rewrites `server/routers.ts` into the ~120-line composition; runs the exhaustive client trpc-path audit.

**Supervisor coordination:**

1. Sub-agent A finishes first (sequential; B depends on A's output).
2. Sub-agent B writes the new `server/routers.ts` from the template above, computes line count, runs `pnpm tsc --noEmit` + `pnpm test`.
3. Sub-agent B runs the exhaustive client audit script (see Procedure step 4) and produces a `/tmp/4f-trpc-audit.txt` listing every `trpc.<key>.<procedure>` consumed by client + whether it resolves on the new appRouter.
4. Supervisor reviews the audit; any missing path → escalate (means a procedure was lost in earlier PRs).

## Final Client tRPC Call Audit

This is the load-bearing gate of Module 4F. Sub-agent B runs:

```bash
# Step 1: extract every client trpc call path
grep -rohE "trpc\.[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*" /Users/jeff/Desktop/網站/client/src \
  | sort -u > /tmp/4f-client-paths.txt

# Step 2: enumerate every procedure defined on the new appRouter
# (via tsc-generated AppRouter type introspection or pnpm tsc --listProcedures hack)
# Sub-agent B writes a small script that dumps appRouter._def.procedures keys
# at runtime via a one-shot `node --eval "require('./server/routers').appRouter._def.procedures"`

# Step 3: diff the two lists
diff /tmp/4f-client-paths.txt /tmp/4f-appRouter-procedures.txt
```

**Acceptance gate:** zero diff entries on the client-paths side. If any client path is not on appRouter, that's a regression — find the missing procedure and either restore it or update the client.

**Top-level keys consumed by client (confirmed at refactor start via grep):**

```
accounting, admin, affiliate, agent, ai, aiQuotes, auth, bookings, competitor,
departures, exchangeRate, favorites, homepage, imageLibrary, inquiries,
invoices, marketing, marketingContent, membership, newsletter, packpoint,
photos, plaid, posterGen, posters, reconciliation, recurringExpenses, reviews,
skills, suppliers, system, tools, tours, translation, visa, vouchers,
wechatAssist
```

(37 top-level keys consumed by client. The actual routers.ts pre-refactor had 42 top-level keys — 5 are server-internal helpers like `usageLogIds`/`caller` that aren't real domains.)

**Every one of these 37 keys must appear in the new appRouter literal.** Sub-agent B verifies.

## Procedure

1. **Supervisor (pre-fan-out): verify Module 4E is stable** — production deploy ≥24 hours with zero admin-tab regressions. Check error rate, admin user reports.

2. **Sub-agent A (extract auth, membership, photos, ai):**
   - For each of the 4 domains, locate the current line range in post-4E routers.ts by grep
   - Extract to `server/routers/<domain>.ts` (4 new files)
   - Add 4 happy-path Vitest files
   - Delete the inline blocks from routers.ts
   - Verify `pnpm tsc --noEmit` + `pnpm test` green

3. **Sub-agent B (composition shell rewrite):**
   - Write the new `server/routers.ts` from the template above (with `auth`/`membership`/`photos`/`ai` references added)
   - Move `assertOwnsUsageLogs` helper (L80 of original routers.ts) to `server/_core/usageLogOwnership.ts`; update any caller in the new sub-router files to import from there
   - DO NOT inline anything new; routers.ts is composition only
   - Verify `pnpm tsc --noEmit` + `pnpm test` green
   - Run the exhaustive client trpc-path audit (see "Final Client tRPC Call Audit" above)
   - Confirm zero missing paths

4. **Supervisor (post-fan-out, single commit):**
   - Combine sub-agent A + B diffs
   - `pnpm build` MUST succeed
   - `wc -l server/routers.ts` reports ≤150 LOC
   - All Phase 4 acceptance criteria from plan.md verified

5. **Update CLAUDE.md §六 (Key Files):**
   ```diff
   - | tRPC 路由 | `server/routers.ts` |
   + | tRPC 路由 | `server/routers.ts` (composition shell, ≤150 LOC) + `server/routers/*` (per-domain) |
   ```
   Also add a note: "All sub-routers in `server/routers/<domain>.ts`. To add a new domain, see the top-of-file comment in `server/routers.ts`."

6. **Smoke test (Jeff or supervisor):**
   - Run the full Phase 6 smoke checklist (plan.md §Phase 6) — this is the regression-anchor for the entire Phase 4 refactor
   - Anonymous browse, logged-in member, booking flow, refund flow, admin tabs, webhook replay
   - Every step must pass

## Acceptance Criteria
- [ ] `server/routers.ts` ≤150 LOC (target ~120; plan's "~30" was unrealistic given import count)
- [ ] `server/routers.ts` contains ZERO inline procedure definitions — only imports + composition
- [ ] `server/routers/auth.ts`, `membership.ts`, `photos.ts`, `ai.ts` exist + tests + ≤300 LOC each
- [ ] `server/_core/usageLogOwnership.ts` exists; `assertOwnsUsageLogs` exported; old inline helper removed
- [ ] Final Client tRPC Call Audit: zero missing paths (client's 37 top-level keys × N procedures all resolve)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count UNCHANGED + 4 new test files pass
- [ ] `pnpm build` succeeds
- [ ] CLAUDE.md §六 updated to reflect the new structure
- [ ] Full Phase 6 smoke checklist runs end-to-end on staging without regression

## Deliverable
- Modified:
  - `server/routers.ts` (rewritten as ≤150 LOC composition shell)
  - `CLAUDE.md` (§六 entry updated)
- New:
  - `server/routers/auth.ts` + `.test.ts`
  - `server/routers/membership.ts` + `.test.ts`
  - `server/routers/photos.ts` + `.test.ts`
  - `server/routers/ai.ts` + `.test.ts`
  - `server/_core/usageLogOwnership.ts`
- Single squash-merge commit:
  ```
  refactor(routers): Phase 4F — composition finalize (10,122 → ~120 LOC)

  Closes Phase 4 of refactor 2026-05. server/routers.ts becomes a clean
  composition shell that imports every domain from server/routers/*.

  - Extracts the last 4 inline domains: auth (336 LOC), membership (216),
    photos (111), ai (286)
  - Moves assertOwnsUsageLogs helper to server/_core/usageLogOwnership.ts
  - Rewrites server/routers.ts as ~120-line composition with alphabetic
    domain key order + section comments per phase
  - Final client trpc-path audit: 37 top-level keys + ~293 procedures
    all resolve on the new appRouter (zero regressions)
  - Updates CLAUDE.md §六 to reflect new structure

  Audit P0-1 fully resolved. Phase 4 complete.
  ```

## Rollback
- Single squash-merge: `git revert <merge-SHA>` restores the post-4E state. 4 new files become orphans. CLAUDE.md edit reverts.
- The trpc-path audit gate prevents most regressions before merge; rollback should be a rare event.

## Manual intervention
- **Jeff:** review the final composition file. The ~120-line shell is the "did we actually finish" artifact — Jeff visually confirms the alphabetic ordering, the section comments per phase, and the type export.
- **Jeff:** run the full Phase 6 smoke checklist (cross-references plan.md §Phase 6, which is documented separately in `docs/refactor/tasks/phase-6/`).
- **Supervisor:** verify the trpc-path audit script outputs zero diff entries.

## Test plan
- 4 new happy-path Vitest cases (one per auth/membership/photos/ai)
- Full `pnpm test` regression run
- `pnpm tsc --noEmit` + `pnpm build`
- Trpc-path audit (described above)
- Phase 6 smoke checklist on staging

## Phase 4 — Aggregate Outcome (after 4F)

| Metric | Pre-Phase-4 | Post-4F |
|---|---|---|
| `server/routers.ts` LOC | 10,122 | ≤150 |
| Files in `server/routers/` | 5 (pre-existing) | ~30 (or ~38 counting sub-files in toursAdmin/ + skills/) |
| Largest sub-router LOC | 2,804 (agentRouter, untouched in v1) | ~775 (toursRouteMap, documented exception) |
| Number of `trpc.<key>.*` consumer paths | 37 | 37 (all preserved) |
| Number of new happy-path Vitest files | 0 | ~40 across 4A-4F |
| Audit P0-1 status | open | resolved |

**Phase 4 closes here. Phase 5 (P1 cleanup) and Phase 6 (final verification + docs + tag) follow per plan.md.**
