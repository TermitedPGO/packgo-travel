# PACK&GO Refactor — Progress Tracker

> Live tracker for the Vibe Coding refactor (CLAUDE.md §九).
> Each Stage 4 sub-agent updates this file when starting/completing a module.

**Status:** Stage 3 complete. Stage 4 execution NOT started.
**Branch:** main
**Last commit at Stage 3 close:** (to be filled at Stage 3 commit)
**Total modules:** 28 task files across 7 phases
**Total markdown:** 6003 lines of task specs

---

## Stage progression

| Stage | What | Status | Output | Source-of-truth doc |
|---|---|---|---|---|
| 1 | Audit | ✅ Complete | 5 P0 + 10 P1 items inventoried | `docs/refactor/audit-2026-05-18.md` |
| 2 | Plan | ✅ Complete | 7 phases, ~62-86h AI / ~12-16h Jeff | `docs/refactor/plan.md` |
| 3 | Tasks | ✅ Complete | 28 task files | `docs/refactor/tasks/phase-N/module-M.md` |
| 4 | Coding | ⏳ Not started | Per-module deliverables | (this file tracks execution) |

---

## Phase × Module status

Status legend: ⬜ TODO · 🟡 IN-PROGRESS · ✅ DONE · ⚠️ BLOCKED · 🚨 DECISION-NEEDED

### Phase 0 · WIP Stabilization (4 modules, est. 2-4h AI + 1-2h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 0.1 | [Round-80 deletion confirm](tasks/phase-0/module-1-deletion-confirm.md) | ⬜ | — | — | Disjoint with 0.2/0.3/0.4 — runs in parallel |
| 0.2 | [UI tweak commits](tasks/phase-0/module-2-ui-commits.md) | ⬜ | — | — | Header/Footer/NewsletterSection etc. |
| 0.3 | [Admin WIP triage](tasks/phase-0/module-3-admin-wip-triage.md) | ⬜ | — | — | **Must NOT commit ToursTab.tsx** (Phase 1 C owns) |
| 0.4 | [Server/infra](tasks/phase-0/module-4-server-infra.md) | ⬜ | — | — | **Must STASH server/agents/autonomous/* + lionTravelApiService.ts + masterAgent.ts edits** |

**Phase 0 verification gate:** `git status --short` returns 0 lines; tsc baseline ~40 errors; `pnpm test` pass count unchanged.

**Phase 0 manual interventions (Jeff):**
- Approve each commit message before push (~30 min total)
- yes/no on 18 new Drizzle migrations 0051-0068 (Checkpoint per CLAUDE.md §八)
- yes/no on `.audit/` directory tracking (track vs `.gitignore`)
- yes/no on 5 `check_*.mjs` repo-root scripts + large basemap PNGs (stash/archive/commit)

---

### Phase 1 · tsc Error Cleanup (5 modules, est. 4-6h AI + 1h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 1.1 | [tsconfig downlevelIteration](tasks/phase-1/module-1-tsconfig-fix.md) | ⬜ | — | — | **Sequential blocker** — auto-resolves 9 errors |
| 1.2 | [Cluster A: autonomous tsc](tasks/phase-1/module-2-autonomous-tsc.md) | ⬜ | — | — | 13 errors (agentTools, opsAgent, opsActions, selfRetrospective, contentAnalyzer, calibration) |
| 1.3 | [Cluster B: routers.ts tsc](tasks/phase-1/module-3-routers-tsc.md) | ⬜ | — | — | 7 errors. **Includes B6: schema migration 0070 for `"emergency"` inquiryType** |
| 1.4 | [Cluster C: services + admin tsc](tasks/phase-1/module-4-services-tsc.md) | ⬜ | — | — | 11 errors. **🚨 C3 (supplierSyncService date) has cross-phase warning — see Phase 5A first** |
| 1.5 | [Husky pre-commit tsc](tasks/phase-1/module-5-husky-precommit.md) | ⬜ | — | — | Gates on tsc=0; prevents regression forever |

**Phase 1 verification gate:** `pnpm tsc --noEmit` exit 0 (zero errors); `pnpm test` regression-anchor unchanged.

**Phase 1 manual interventions (Jeff):**
- Schema review for migration 0070 (`inquiries.inquiryType` enum + `"emergency"` value)
- `pnpm add -D @types/express` if not present (Module 4 C1)

---

### Phase 2 · Stripe Webhook Hardening (6 modules, est. 8-10h AI + 2h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 2.1 | [Idempotency table + helper](tasks/phase-2/module-1-idempotency-table.md) | ⬜ | — | — | **Sequential blocker** — migration `drizzle/0076_stripe_webhook_idempotency.sql` |
| 2.2 | [Bookings handlers tx + tests](tasks/phase-2/module-2-bookings-handlers.md) | ⬜ | — | — | 9 Vitest cases; charge.succeeded + payment_intent.succeeded + payment_intent.failed |
| 2.3 | [Refund handlers tx + tests](tasks/phase-2/module-3-refund-handlers.md) | ⬜ | — | — | 5 Vitest cases. **Note: voucher restore NOT currently implemented (audit overstated)** |
| 2.4 | [Subscription handlers tx + tests](tasks/phase-2/module-4-subscription-handlers.md) | ⬜ | — | — | 7 Vitest cases. **🚨 Trial AB-390 email ordering needs Jeff decision pre-Stage 4** |
| 2.5 | [Visa handlers tx + tests](tasks/phase-2/module-5-visa-handlers.md) | ⬜ | — | — | 4 Vitest cases |
| 2.6 | [Manual staging replay smoke](tasks/phase-2/module-6-stripeWebhook-smoke.md) | ⬜ | — | — | Jeff-driven; gates production deploy |

**Phase 2 verification gate:** Full Vitest suite green; 30 new test cases pass; Jeff manual staging replay passes idempotency check.

**Phase 2 manual interventions (Jeff):**
- 🚨 **DECISION-NEEDED: Trial AB-390 email ordering** (Module 2.4) — flag-first vs email-first trade-off (Stripe retry resilience vs email-genuinely-not-sent visibility)
- Approve migration 0076 before deploy
- Personally trigger `stripe trigger payment_intent.succeeded` against staging
- Deploy is Tue/Wed/Thu morning only

**Phase 2 plan-vs-reality calibrations:**
- `handleCheckoutSessionCompleted` is a single 300-line super-handler (lines 123-422) doing checkout + visa + subscription fallback + booking. Plan said "10-12 handlers" — reality is fewer but denser.
- `awardBookingPackpoint` + `deductPackpoint` already wrap own transactions. Modules call POST-COMMIT not nested (MySQL nested tx semantics + their existing idempotency).
- Migration number is `0076` (not plan's `0070` — current head is 0075).

---

### Phase 3 · Dead Code Purge (2 modules, est. 1-2h AI + 0.5h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 3.1 | [FloatingOpsAgent delete](tasks/phase-3/module-1-floatingopsagent-delete.md) | ⬜ | — | — | + scrub 4 stale comments in Admin.tsx + 1 in UnifiedInbox.tsx |
| 3.2 | [TodayOverview decide-and-delete](tasks/phase-3/module-2-todayoverview-decide-and-delete.md) | ⬜ | — | — | **🚨 Jeff yes/no gate** — UnifiedInbox rollout stable for a week? |

**Phase 3 verification gate:** `pnpm tsc --noEmit` clean (no dangling imports); `pnpm build` succeeds; admin loads no console errors.

**Phase 3 manual interventions (Jeff):**
- yes/no on TodayOverview deletion (UX-acceptance question, not technical)

**Phase 3 bonus findings:**
- `client/public/manifest.json:38` PWA shortcut description mentions TodayOverview (Module 3.2 handles)
- `client/src/components/admin/AgentChatPage.tsx:5` comment preserved intentionally (documents WHY Sheet pattern retired)

---

### Phase 4 · routers.ts Split — 5 sub-PRs (6 modules, est. 12-16h AI + 3-4h Jeff)

**Actual domain count:** 42 top-level keys (plan estimated 25-35). 37 customer-consumed, 5 already-extracted imports.

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 4A | [Safe domains](tasks/phase-4/module-4A-safe-domains.md) | ⬜ | — | — | newsletter, favorites, browsingHistory, **tours (read-only — 2348 LOC, splits internally)** |
| 4B | [Read-only admin](tasks/phase-4/module-4B-readonly-admin.md) | ⬜ | — | — | analytics, audit, monitor, stats |
| 4C | [Customer txn](tasks/phase-4/module-4C-customer-txn.md) | ⬜ | — | — | inquiries, bookings non-pay (~500 LOC), departures, imageLibrary, homepage |
| 4D | [Money paths](tasks/phase-4/module-4D-money-paths.md) | ⬜ | — | — | **🚨 SOLO JEFF REVIEW** bookings-pay, vouchers, packpoint, accounting |
| 4E | [Admin tools](tasks/phase-4/module-4E-admin-tools.md) | ⬜ | — | — | **skills (970 LOC sub-splits into 6 files)**, toursAdmin (1200 LOC sub-splits into 5), autonomous mgmt, calibration, marketing, translation, exchangeRate, competitor, affiliate, wechatAssist, visa-admin |
| 4F | [Composition file](tasks/phase-4/module-4F-composition.md) | ⬜ | — | — | Final ~120 LOC composition shell (plan said ~30; reality needs 45 imports) |

**Phase 4 verification gate (per sub-PR):** All client tRPC paths still resolve; tsc + tests green; happy-path Vitest per new file; routers.ts shrinks by extracted LOC.

**Phase 4 manual interventions (Jeff):**
- 🚨 **Solo PR review for Module 4D (money paths)** — Jeff personally reviews
- Deploy 4A/4B/4E: any weekday morning
- Deploy 4C/4D: Tue/Wed/Thu morning only

**Phase 4 god-procedure flag (v2 backlog):**
- `tours.getRouteMap` is a **single 763-LOC procedure** (lines 1618-2380). Documented as exception in 4A; recommended v2 extraction of SVG-render logic into a dedicated service.

---

### Phase 5 · Selected P1 Cleanup (2 modules, est. 8-12h AI + 1.5h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 5A | [supplierSync split + tests](tasks/phase-5/module-5A-suppliersync.md) | ⬜ | — | — | **🚨 Reads Phase 1 module-4 C3 fix first; if wrong-direction landed, reverts** |
| 5B | [ToursTab + AutonomousAgentsTab structural extraction](tasks/phase-5/module-5B-admintabs.md) | ⬜ | — | — | AutonomousAgentsTab 2078→~120 LOC entry; ToursTab 1149→530 LOC orchestrator |

**Phase 5 verification gate:** tsc green; 21 new Vitest cases pass; supplier sync runs against staging with both known-good and known-malformed payloads.

**Phase 5 manual interventions (Jeff):**
- Approve supplier sync changes deploy window (Tue/Wed morning, financial-adjacent)

**Phase 5 critical correctness note:**
- 🚨 Drizzle `supplierDepartures.departureDate` column is type `date` (ISO string-native). DO NOT wrap with `new Date()` — would cause timezone drift. See Module 5A and Phase 1 module-4 C3 cross-phase warning.

---

### Phase 6 · Final Verification + Smoke + Docs (3 modules, est. 3-4h AI + 2h Jeff)

| # | Module | Status | Owner-agent | Last-update | Notes |
|---|---|---|---|---|---|
| 6.1 | [Full regression](tasks/phase-6/module-1-full-regression.md) | ⬜ | — | — | `pnpm check / test / build` (no `lint` script in package.json) |
| 6.2 | [Smoke checklist](tasks/phase-6/module-2-smoke-checklist.md) | ⬜ | — | — | **103 concrete checkbox actions** (plan rough-estimated; reality is much more) |
| 6.3 | [Docs update + tag](tasks/phase-6/module-3-docs-update.md) | ⬜ | — | — | CLAUDE.md §六 diff (1 old row → 3 new rows); completed.md; `git tag refactor-v1-complete` |

**Phase 6 verification gate:** Everything green + 103-item smoke checklist all pass.

**Phase 6 manual interventions (Jeff):**
- Personally execute 103-item smoke checklist on production (~1.5h)

---

## Cross-Phase Decision Log

Decisions Jeff must lock in BEFORE Stage 4 starts:

| # | Decision | Phase | Module | Default if undecided |
|---|---|---|---|---|
| D1 | 🚨 Trial AB-390 email ordering: flag-first or email-first? | 2 | 2.4 | flag-first (safer for Stripe retry) |
| D2 | TodayOverview deletion yes/no (UX-acceptance) | 3 | 3.2 | defer to v2 if UnifiedInbox not yet stable for 1 week |
| D3 | 18 new Drizzle migrations 0051-0068 production-safe? | 0 | 0.4 | review each one for schema-breaking change |
| D4 | `.audit/` directory tracking vs `.gitignore` | 0 | 0.4 | gitignore (don't commit audit artifacts) |
| D5 | `pnpm add -D @types/express` if not installed | 1 | 1.4 | install (cheap, fixes 3 errors) |

---

## Cross-Phase Coordination Hazards

Things Stage 4 sub-agents must NOT do without checking:

| Hazard | Risk | Owned by | Notes |
|---|---|---|---|
| Phase 0.3 committing `ToursTab.tsx` | Conflicts with Phase 1 C / Phase 5B | Phase 0 supervisor | Module 0.3 has stash label `phase0/mod3/tours-tab-wip` |
| Phase 0.4 committing `server/agents/autonomous/*` | Conflicts with Phase 1 A | Phase 0 supervisor | Module 0.4 stashes these |
| Phase 1.4 using `new Date(dateStr)` for supplierSync | Timezone drift corrupts live calendar dates | Phase 1 supervisor | C3 has cross-phase warning pointing to Phase 5A |
| Phase 4 sub-agents touching `server/db.ts` | Out of v1 scope | Phase 4 supervisor | db.ts split is v2 |
| Phase 4D landing before Phase 2 complete | Money paths split before stripe hardened | Master supervisor | Critical-path order |

---

## Stage 4 dispatch readiness

Ready for Stage 4 when:
- [x] Audit complete
- [x] Plan complete with locked decisions
- [x] All 28 task files written
- [x] progress.md tracker created (this file)
- [x] Cross-phase warnings annotated in affected modules
- [ ] D1 trial-email-ordering decided
- [ ] D2 TodayOverview yes/no decided
- [ ] D3 Migration 0051-0068 review complete
- [ ] D4 `.audit/` policy decided
- [ ] D5 `@types/express` installed if missing
- [ ] Jeff has committed to the 2-week burst window

---

## Update protocol (for Stage 4 sub-agents)

When you (a Stage 4 sub-agent) work on a module:
1. **On start:** update the row Status → 🟡, fill in Owner-agent + Last-update timestamp
2. **On commit:** add commit SHA to Notes column
3. **On block:** flip to ⚠️ + add reason; escalate to supervisor
4. **On done:** Status → ✅; verify acceptance criteria all checked
5. **On Jeff-decision-needed:** Status → 🚨; add question to Cross-Phase Decision Log
