# Phase 5 · Module 5B · ToursTab + AutonomousAgentsTab Structural Extraction

**Parent plan:** docs/refactor/plan.md (Phase 5 · Selected P1 Cleanup)
**Audit ref:** P1-5 partial (only the two files with Phase 1 tsc errors)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2-4 h AI + 0.5 h Jeff review
**Deploy window:** any weekday morning (admin-only blast radius — no customer-facing change)

## Goal

Partial structural extraction of `client/src/components/admin/ToursTab.tsx` (1,149 LOC) and `client/src/components/admin/AutonomousAgentsTab.tsx` (2,078 LOC) — both flagged in audit P1-5 and both already had Phase 1 tsc errors. Extract only the pieces the Phase 1 tsc fixes touched or that have obvious extraction value with low blast radius. **Each entry file ≤400 LOC** (relaxed from §1's 300 baseline for client components per Phase 5 scope decision). Happy-path Vitest on the extracted helpers. Full deep split deferred to v2.

## Pre-requisites

- Phase 0 complete (clean `git status`)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0; the tsc errors in these two files are already resolved as part of Cluster C in `module-4-services-tsc.md`)
- Phase 4 in flight or complete (the tRPC paths consumed by these tabs may have moved files; verify imports resolve)

## Inputs (read these before executing)

### ToursTab.tsx (1,149 LOC — but 80% already subcomponent-ized)

The file is mostly orchestrator after Round 80 work. Subcomponents already extracted under `client/src/components/admin/tours/`:
- `ToursTabHeader`, `ToursTabFilters`, `ToursTabRow`, `ToursTabCard`, `ToursTabBulkBar`, `ToursTabQuickCreateDialog`, `ToursTabCreateDialog`, `ToursTabPreviewDialog`

What's left inside `ToursTab.tsx`:
- Lines 89-621: state hooks + 7 tRPC mutation setups + handlers (~530 LOC orchestrator body, unsplittable without deep restructure)
- Lines 622-692: three `useMemo` blocks — `filteredTours`, `stats`, `statusCounts` (pure derivations — **extractable**)
- Lines 694-711: `toRowData` helper (pure mapper — **extractable**)
- Lines 275-619: `useEffect` polling for AI generation status + various callback handlers (orchestration — leave in place)
- Lines 407, 455 (`catch (error: any)`) and 486-502 (multiple `(tour as any).field`) — these were the Phase 1 tsc touch sites for ToursTab. The `(tour as any)` pattern lives inside an editor-form-data construction block.
- Lines 713-1149: large JSX return tree (orchestration; leave in place)

### AutonomousAgentsTab.tsx (2,078 LOC — natural seams exist)

Heavily nested in one file but cleanly modular by structure. Section map (from `grep` of `function` declarations):

| Line | Symbol | Role | Extractable? |
|---|---|---|---|
| 44-79 | `AGENT_DEFS` const | Top-level config | Keep in entry; small + low-churn |
| 81-118 | `AgentId`, `COLOR_MAP` types/const | Top-level config | Keep in entry |
| 120-151 | `AutonomousAgentsTab` (entry) | Orchestrator (32 LOC) | Keep |
| 157-219 | `OfficeHeader`, `HeaderStat` | Top status bar | **Extract → `agents/OfficeHeader.tsx`** |
| 221-444 | `PendingItem` type + `PendingInbox`, `PendingRow`, `Meta` | Inbox column | **Extract → `agents/PendingInbox.tsx`** |
| 444-538 | `AgentDesks`, `AgentDeskCard`, `StatusDot` | Desk grid | **Extract → `agents/AgentDesks.tsx`** |
| 540-839 | `AgentDeskDetail`, `AgentChatPanel`, `ChatBubble` | Selected-desk panel | **Extract → `agents/AgentDeskDetail.tsx`** |
| 840-945 | `Section`, `Timeline`, `TimelineItem` type | Generic UI primitives | **Extract → `agents/sharedPrimitives.tsx`** |
| 947-1185 | `InquiryAgentDemo`, `InquiryAgentResult` | Inquiry demo | **Extract → `agents/InquiryAgentDemo.tsx`** |
| 1186-1372 | `CustomerProfileLookup`, `Th`, `Td`, `Stat`, `isToday` | Profile lookup section | **Extract → `agents/CustomerProfileLookup.tsx`** + helpers |
| 1377-1542 | `ReviewAgentDemo`, `ReviewResult` | Review demo | **Extract → `agents/ReviewAgentDemo.tsx`** |
| 1543-1700 | `MarketingAgentDemo`, `MarketingResult` | Marketing demo (hidden per line 61 comment) | **Extract → `agents/MarketingAgentDemo.tsx`** (kept; mounted lazily) |
| 1701-1873 | `FollowupAgentDemo`, `FollowupResult` | Followup demo | **Extract → `agents/FollowupAgentDemo.tsx`** |
| 1874-2032 | `RefundAgentDemo`, `RefundResult` | Refund demo | **Extract → `agents/RefundAgentDemo.tsx`** |
| 2033-2078 | `ErrorBox`, `ReasoningCard` | Generic error/reasoning | **Extract → `agents/sharedPrimitives.tsx`** (alongside Section/Timeline) |

Phase 1 tsc-touched spots (the `: any` annotations at lines 697, 740, 1039, 1294, 1470, 1640, 1843, 1939) are all inside the demo subcomponents — extracting the demos automatically isolates the `any` usage to one file each, making future typing safer.

## Procedure

### ToursTab — minimal extraction (≤1 h)

Phase 5's scope decision is: extract ONLY the Phase 1 tsc-touched pieces and the obvious pure helpers. The deep structural rework of the 530-LOC orchestrator body waits for v2.

1. **Create `client/src/components/admin/tours/toursTab.helpers.ts` (≤120 LOC):**
   - Move `filteredTours` derivation logic into a pure function `filterAndSortTours(tours, { statusFilter, featuredFilter, searchKeyword, sortBy })` returning the same array.
   - Move `stats` derivation into `computeStats(tours)` returning `{active, draft, featured, recent}`.
   - Move `statusCounts` derivation into `computeStatusCounts(tours)` returning `{all, active, inactive}`.
   - Move `toRowData(tour)` mapper into the helpers file.
   - **Keep** `EMPTY_FORM` const inside the entry file (it's a single object literal).
   - Use proper Tour type from `@/lib/trpc` inferred output instead of `any` where the existing code uses bare object types.

2. **Update `ToursTab.tsx`:**
   - Import the four helpers from `./tours/toursTab.helpers`.
   - Replace each `useMemo` block with `useMemo(() => filterAndSortTours(tours, …), […])` etc. (No behavior change — just delegate the body.)
   - Replace inline `toRowData` with the imported version.
   - **DO NOT touch** the `(tour as any).priceCurrency` etc. cluster at lines 486-502 — that lives inside a complex form-population block; flag it as **v2-deferred** with a TODO comment pointing at the v2 backlog. The Phase 1 tsc fix already made these compile; the typing cleanup is its own cycle.
   - **DO NOT touch** the 7 `trpc.X.useMutation` setups; the JSX return tree; the polling `useEffect`. Out of scope for this phase.

3. **Verify entry file LOC:** target `wc -l ToursTab.tsx` ≤400. If still >400 after this extraction (likely; the orchestrator body is the bulk), accept it — Phase 5 explicitly relaxes this for these client components. Document the residual as a v2 task.

### AutonomousAgentsTab — sub-view extraction (≤2 h)

This file has clean natural seams — extraction here is mostly cut/paste with import wiring. Execute in two passes:

**Pass A — extract the Phase 1 tsc-touched demos FIRST (the priority seam):**

These extractions move the `: any` pollution out of the entry file:

1. **`client/src/components/admin/agents/InquiryAgentDemo.tsx`** — lines 947-1185 (`InquiryAgentDemo`, `InquiryAgentResult`, `ResultField`).
2. **`client/src/components/admin/agents/ReviewAgentDemo.tsx`** — lines 1377-1542.
3. **`client/src/components/admin/agents/FollowupAgentDemo.tsx`** — lines 1701-1873.
4. **`client/src/components/admin/agents/RefundAgentDemo.tsx`** — lines 1874-2032.
5. **`client/src/components/admin/agents/MarketingAgentDemo.tsx`** — lines 1543-1700. (Mounted but UI is hidden per line 61 comment; keep for completeness.)

Each demo file:
- Standalone default export
- Imports tRPC + shared UI from the same paths the original used
- Carries forward the `: any` annotations verbatim (don't fix typing in this module — that's v2)
- ≤200 LOC each

**Pass B — extract the structural shell components:**

6. **`client/src/components/admin/agents/OfficeHeader.tsx`** — lines 157-219 (`OfficeHeader` + `HeaderStat`).
7. **`client/src/components/admin/agents/PendingInbox.tsx`** — lines 221-444 (`PendingItem` type + `PendingInbox` + `PendingRow` + `Meta`).
8. **`client/src/components/admin/agents/AgentDesks.tsx`** — lines 444-538 (`AgentDesks` + `AgentDeskCard` + `StatusDot`). The component depends on the `AGENT_DEFS` + `COLOR_MAP` from the entry file → either import them from a new `agents/agentDefs.ts` or accept them as props. **Decision:** create `agents/agentDefs.ts` housing `AGENT_DEFS`, `AgentId`, `COLOR_MAP` — these are pure config and many sub-views need them.
9. **`client/src/components/admin/agents/AgentDeskDetail.tsx`** — lines 540-839 (`AgentDeskDetail` + `AgentChatPanel` + `ChatBubble`). This is the largest extracted unit (~300 LOC). Imports the demo sub-components from pass A.
10. **`client/src/components/admin/agents/CustomerProfileLookup.tsx`** — lines 1186-1372 (`CustomerProfileLookup` + `Th` + `Td` + `Stat` + `isToday`).
11. **`client/src/components/admin/agents/sharedPrimitives.tsx`** — lines 840-945 (`Section` + `Timeline` + `TimelineItem` type) + lines 2033-2078 (`ErrorBox` + `ReasoningCard`). Generic UI used by multiple agent sub-views.

**Pass C — slim the entry file:**

12. **`client/src/components/admin/agents/agentDefs.ts`** — `AGENT_DEFS`, `AgentId`, `COLOR_MAP` (consumed by entry + many sub-views).
13. **`client/src/components/admin/AutonomousAgentsTab.tsx`** reduced to:
    - Imports of the 8+ sub-view files
    - The `AutonomousAgentsTab` orchestrator function (lines 120-151)
    - Re-export of types if downstream code references them (search `grep -rn "AutonomousAgentsTab" client/`)
    - Target: ≤120 LOC

### Helpers extraction priority (Phase 1 tsc-touched first)

The "first extract the Phase 1 tsc-touched parts" rule means:

- For **ToursTab**: `filteredTours` + `stats` + `statusCounts` helpers (the `useMemo` bodies sit adjacent to the `(tour as any)` Phase 1 touch sites at lines 486-502 — extracting the pure derivations gives those a typed wrapper, even though the `any` casts themselves stay for v2).
- For **AutonomousAgentsTab**: the 5 `AgentDemo` files in Pass A (every `: any` Phase 1 site lives inside a `function XAgentResult({ result }: { result: any })` block — extracting these isolates the typing debt to per-agent files).

The Pass B/C shell extractions (`OfficeHeader`, `PendingInbox`, etc.) are NOT Phase 1 tsc-touched but are cheap, mechanical, and unblock future incremental typing of the demos. Include them in this module since they're contiguous chunks with zero behavior risk.

**Explicitly deferred to v2 (do NOT do in this module):**

- ToursTab orchestrator body split (the 530-LOC state-management body lines 89-619)
- ToursTab `(tour as any)` typing cleanup at lines 486-502
- AutonomousAgentsTab demo files' internal `: any` typing improvements
- AutonomousAgentsTab orchestrator-to-feature-flag wiring (the line 61 "MarketingAgent desk hidden" comment hints at a v2 feature-toggle pattern)

## Acceptance Criteria

- [ ] `client/src/components/admin/tours/toursTab.helpers.ts` exists (≤120 LOC) with `filterAndSortTours`, `computeStats`, `computeStatusCounts`, `toRowData`
- [ ] `client/src/components/admin/ToursTab.tsx` consumes the helpers; behavior identical
- [ ] `wc -l client/src/components/admin/ToursTab.tsx` reduces by ≥80 LOC (target ≤400, accept up to ~1,060 if the orchestrator body is unavoidably large)
- [ ] `client/src/components/admin/agents/` directory exists with 10 sub-files:
  - `agentDefs.ts`
  - `OfficeHeader.tsx`
  - `PendingInbox.tsx`
  - `AgentDesks.tsx`
  - `AgentDeskDetail.tsx`
  - `CustomerProfileLookup.tsx`
  - `InquiryAgentDemo.tsx`
  - `ReviewAgentDemo.tsx`
  - `MarketingAgentDemo.tsx`
  - `FollowupAgentDemo.tsx`
  - `RefundAgentDemo.tsx`
  - `sharedPrimitives.tsx`
- [ ] `client/src/components/admin/AutonomousAgentsTab.tsx` reduced to ≤120 LOC
- [ ] Each new file ≤300 LOC (relaxed to ≤350 for `AgentDeskDetail.tsx` which is intrinsically larger)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] New Vitest: `client/src/components/admin/tours/toursTab.helpers.test.ts` — 4 happy-path cases (one per exported helper)
- [ ] Manual smoke: Jeff opens the Tours admin tab, verifies filter / sort / stats render identically; opens the Autonomous Agents tab, clicks each of the 5 demo desks, verifies each renders

## Deliverable

- New (ToursTab side): `client/src/components/admin/tours/toursTab.helpers.ts`, `toursTab.helpers.test.ts`
- New (AutonomousAgentsTab side): 12 files under `client/src/components/admin/agents/`
- Modified: `ToursTab.tsx` (-~80 LOC), `AutonomousAgentsTab.tsx` (-~1,950 LOC, becomes a thin shell)

**Two commits (one per file for clean revert granularity):**

```
refactor(admin-tours): Phase 5 module 5B — extract ToursTab pure derivations

- Pull filteredTours / stats / statusCounts / toRowData into
  tours/toursTab.helpers.ts (≤120 LOC, fully typed)
- Entry file consumes via useMemo wrappers; behavior identical
- 4 happy-path Vitest cases on the new helpers
- (tour as any) form-data block at L486-502 retained verbatim; flagged
  TODO(v2) — full typing cleanup is its own cycle
```

```
refactor(admin-agents): Phase 5 module 5B — extract AutonomousAgentsTab sub-views

- Split 2,078 LOC into 12 files under agents/ subdirectory
- Pass A: 5 AgentDemo files (Inquiry/Review/Marketing/Followup/Refund) —
  isolates the Phase 1 ': any' typing debt to per-agent files for
  future incremental cleanup
- Pass B: structural shell extracted (OfficeHeader, PendingInbox,
  AgentDesks, AgentDeskDetail, CustomerProfileLookup, sharedPrimitives)
- Pass C: agentDefs.ts hosts AGENT_DEFS + COLOR_MAP + AgentId
- Entry file reduced to ≤120 LOC orchestrator shell
- DEFERRED to v2 (NOT in this commit): per-demo typing, orchestrator
  feature-flag refactor
```

## Rollback

- Each commit lands independently. If only one file's extraction introduces a regression, single-commit revert restores it. The other file's extraction remains green.
- All extracted children are imported by path — no dynamic imports or feature flags involved. Revert is purely mechanical.
- No DB / network / migration touched.
- Admin-only blast radius: a regression here affects Jeff's admin workflow only; zero customer-facing impact.

## Manual intervention

- **Jeff:** click through the Tours admin tab post-deploy — filter combinations, sort modes, view switch — confirm the four `useMemo` derivations produce the same render as pre-deploy (compare to a screenshot taken before deploy).
- **Jeff:** click through each of the 5 Autonomous Agent demo desks post-deploy. Especially: Inquiry (most-used), Review (currently configured), Refund (escalation flow). Confirm each renders + a sample interaction produces the same result.
- **Supervisor:** if Jeff reports any agent demo rendering anomaly, the suspect commit is the AutonomousAgentsTab extraction one; revert that single commit while leaving the ToursTab extraction in place.

## Test plan

`pnpm test client/src/components/admin/tours/toursTab.helpers.test.ts` — 4 cases:

1. **`filterAndSortTours` — happy path**: input 5 tours with mixed statuses, filter to `active` + sort by `price-asc`, assert returned array length and order.
2. **`computeStats` — happy path**: 5 tours (3 active, 2 draft, 2 featured, 1 created today), assert returned `{active: 3, draft: 2, featured: 2, recent: ≥1}`.
3. **`computeStatusCounts` — happy path**: same input, assert `{all: 5, active: 3, inactive: 2}`.
4. **`toRowData` — happy path**: one tour object, assert returned `TourRowData` has all 14 fields correctly mapped (incl. `hasAiDeparturePreview: !!tour.extractedDepartures`).

No Vitest for AutonomousAgentsTab extractions — they're pure cut/paste of JSX-heavy components where unit-testing rendering is high cost / low signal. Manual smoke covers this. (Full integration tests across the agent demos belong in a v2 testing-strategy phase.)

Plus the regression anchor: full `pnpm test` pass count unchanged.

**Pre-deploy verification gate (in the supervisor's hands):**
- `pnpm tsc --noEmit` exit 0
- `pnpm test` green
- `pnpm build` succeeds (catches any lazy-import or path-alias resolution issue)
- Manually load `client/src/pages/Admin.tsx` in dev mode, navigate to Tours and Autonomous Agents tabs, verify no console errors and the visual layout matches pre-extraction screenshots
