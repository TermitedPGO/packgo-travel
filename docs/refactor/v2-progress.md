# PACK&GO Refactor v2 — Progress Tracker

> Live tracker for the Vibe Coding refactor v2 (CLAUDE.md §九).
> Each Stage 4 sub-agent updates this file when starting/completing a module.
> Mirrors `progress.md` (v1) but covers Waves 1–4 instead of phases.

**Status:** Stage 4 in flight — Wave 1 + 2 shipped (22 modules); Wave 3 kickoff batch landed (3.1, 3.2, 3.3 = the autonomy thesis foundation).
**Branch:** main
**Last commit on this tracker:** `5002832` (Wave 3 Module 3.2 — skill registry)
**Tip commit:** `5002832`
**Total modules:** 62 across 4 waves (W1: 9, W2: 13, W3: 13, W4: 27 — of which **9 RN modules deferred to v3** per Jeff 2026-05-19, so v2 actual W4 scope = 18)
**Task spec total:** ~9,769 lines of markdown across `docs/refactor/tasks/v2-wave-{1..4}/`

---

## Stage progression

| Stage | What | Status | Output | Source-of-truth doc |
|---|---|---|---|---|
| 1 | Audit | ✅ Complete | 11 capability domains A–K + Domain L (Mobile) | `docs/refactor/v2-audit-2026-05-19.md` |
| 2 | Plan | ✅ Complete | 4 waves, ~420h AI / ~22h Jeff, 4–6 week calendar | `docs/refactor/v2-plan.md` |
| 3 | Tasks | ✅ Complete | 62 task files, ~9.8K LOC of spec | `docs/refactor/tasks/v2-wave-{1..4}/module-X.Y-*.md` |
| 4 | Coding | 🟡 In progress | Waves 1 + 2 shipped to prod; Waves 3 + 4 not started | (this file tracks execution) |

---

## Wave summary

| Wave | Theme | Modules | Status | Hours est. | Calendar | Tip commit |
|---|---|---|---|---|---|---|
| 1 | Foundation + Observability | 9 | ✅ Complete (9 / 9) | ~58 AI / ~3 Jeff | Week 1 (May 19–20) | `8b2215f` passport-at-rest |
| 2 | God-File Splits | 13 | ✅ Complete (13 / 13) | ~96 AI / ~4 Jeff | Weeks 1–3 (May 19–21) | `c19c57e` getRouteMap extract |
| 3 | Autonomy Thesis | 13 | 🟡 6 / 13 (3.1+3.2+3.3+3.4+3.12 + dispatcher LIVE in prod) | ~110 AI / ~4 Jeff | Weeks 3–4 | `96dd2b9` (v512) |
| 4 | Mobile (PWA) + Polish | **18 in v2** (9 RN deferred to v3) | ⬜ Not started | ~80 AI / ~7 Jeff (v2 scope) | Weeks 4–5 | — |

**Status legend:** ⬜ TODO · 🟡 IN-PROGRESS · ✅ DONE · ⚠️ BLOCKED · 🚨 DECISION-NEEDED

---

## Wave 1 — Foundation + Observability ✅

**Goal (shipped):** Sentry firing, UptimeRobot pinging, PostHog tracking 5 events, Admin.js lazy-loaded per tab, migration 0077 applied, passport-at-rest encrypted, login rate-limited.

| # | Module | Status | Tip commit | Notes |
|---|---|---|---|---|
| 1.1 | [Sentry + sourcemaps](tasks/v2-wave-1/module-1.1-sentry.md) | ✅ | `ff04ac0` | Server + client wired; sourcemap upload working |
| 1.2 | [Pino structured logger](tasks/v2-wave-1/module-1.2-pino-logger.md) | ✅ | `659dd3c` | Critical-path subset only; **~1,250 sites deferred to W4 Module 4.24** (see `wave-4-deferrals.md`) |
| 1.3 | [UptimeRobot + /health](tasks/v2-wave-1/module-1.3-uptimerobot-healthcheck.md) | ✅ | `09f7e58` | Deep health: db / redis / stripe / llm |
| 1.4 | [PostHog 5 conversion events](tasks/v2-wave-1/module-1.4-posthog-events.md) | ✅ | `d949c1d` | tour_view / search / booking_start / booking_step / booking_complete |
| 1.5 | [Admin code-split (38 tabs)](tasks/v2-wave-1/module-1.5-admin-codesplit.md) | ✅ | `af3053a` | React.lazy per tab |
| 1.6 | [ComponentShowcase delete](tasks/v2-wave-1/module-1.6-componentshowcase-delete.md) | ✅ | (pre-v2) | File no longer present in repo |
| 1.7 | [Migration 0077 — `emergency` enum](tasks/v2-wave-1/module-1.7-migration-0077.md) | ✅ | `8b8603f` | inquiryType expanded |
| 1.8 | [Passport-at-rest encryption](tasks/v2-wave-1/module-1.8-passport-encrypt.md) | ✅ | `8b2215f` | + migration 0078; backfill script ready; `dc764fc` defers backfill to next deploy |
| 1.9 | [Rate-limit middleware](tasks/v2-wave-1/module-1.9-rate-limit-middleware.md) | ✅ | `2622b94` + `946e2dc` | adminProcedure 60/min/admin; login 10/15min IP + 5/15min email |

**Verification gate:** ✅ All 9 modules shipped to prod. `/health` green continuously.

**Post-wave hot-fixes (not in original plan):**
- `34e1940` (2026-05-22) — agent tool-shape regression (7 agents, OpenAI nested format)
- `ef39146` (2026-05-22) — upload router intercepting `/api/trpc/*` (8-day silent regression)
- `a7b53b4` (2026-05-22) — SIGTERM graceful shutdown + Sentry EPIPE filter

---

## Wave 2 — God-File Splits ✅

**Goal (shipped):** 5 god-files (db.ts 3,584 / TourDetailPeony 3,827 / masterAgent 3,300 / agentRouter 2,804 / TourEditDialog 2,156 / email 1,302) split into domain-specific modules + composition shell. routers.ts also got the 760-LOC `getRouteMap` extract.

| # | Module | Status | Tip commit | Outcome |
|---|---|---|---|---|
| 2.1 | [db.ts — booking](tasks/v2-wave-2/module-2.1-db-split-booking.md) | ✅ | `e0c860b` | 13 fns extracted to `server/db/booking.ts` |
| 2.2 | [db.ts — tour](tasks/v2-wave-2/module-2.2-db-split-tour.md) | ✅ | `ddd6b1d` | 22 fns → `server/db/tour.ts` |
| 2.3 | [db.ts — user](tasks/v2-wave-2/module-2.3-db-split-user.md) | ✅ | `6e4aa92` | 26 fns → `server/db/user.ts` |
| 2.4 | [db.ts — payment](tasks/v2-wave-2/module-2.4-db-split-payment.md) | ✅ | (rolled into `_core/`) | voucher / packpoint / refund moved to `_core/` per plan calibration |
| 2.5 | [db.ts — log](tasks/v2-wave-2/module-2.5-db-split-log.md) | ✅ | (rolled into `_core/auditLog.ts`) | auditLog migrated to `_core/auditLog.ts` |
| 2.6 | [db.ts — search/discovery](tasks/v2-wave-2/module-2.6-db-split-search.md) | ✅ | `21b9b54` | 39 fns → `server/db/search.ts` |
| 2.7 | [db.ts — accounting+marketing](tasks/v2-wave-2/module-2.7-db-split-accounting.md) | ✅ | `d913f13` | 33 fns → `server/db/accounting.ts`; closed 5-file split |
| 2.8 | [TourDetailPeony 3,846 → 20 files](tasks/v2-wave-2/module-2.8-tourdetailpeony-split.md) | ✅ | `24b3804` | Hero / Overview / RouteMap / etc. |
| 2.9 | [masterAgent 3,300-LOC split](tasks/v2-wave-2/module-2.9-masteragent-split.md) | ✅ | `ad31017` | supervisor + 6 pipeline files |
| 2.10 | [agentRouter 2,804 → 11 files](tasks/v2-wave-2/module-2.10-agentrouter-split.md) | ✅ | `58aa10b` | per-agent sub-routers |
| 2.11 | [email.ts 1,302 → 14 files](tasks/v2-wave-2/module-2.11-email-split.md) | ✅ | `4c41ce8` | per-template + send infra |
| 2.12 | [TourEditDialog 2,156 → 10 files](tasks/v2-wave-2/module-2.12-toureditdialog-split.md) | ✅ | `ba03d5f` | 6 admin tabs preserved |
| 2.13 | [getRouteMap 760-LOC extract](tasks/v2-wave-2/module-2.13-getroutemap-extract.md) | ✅ | `c19c57e` | Out of routers.ts; SVG renderer intact |

**Verification gate:** ✅ pnpm tsc --noEmit clean; Vitest +smoke tests pass; Wave 2 smoke verified via Chrome MCP (TourDetailPeony Hero/Overview/RouteMap render, ChatsTab Agent Chat works, TourEditDialog 3/6 tabs verified, getRouteMap SVG with 10 Japan stops renders).

**Lesson carried to W3/W4:** v1 had a git race when 3 sub-agents tried to commit at once. W2 used supervisor-relay commits (one agent at a time after `tsc + test` passed). **W3/W4 must follow the same pattern.**

---

## Wave 3 — Autonomy Thesis ⬜

**Goal:** Wire the 5 missing sub-intents + skill registry + auto-dispatch + RefundAgent into the Stripe refund path + 15-file Vitest smoke across every autonomous agent. After Wave 3, the InquiryAgent classifies into 12 intents (was 7), the 4 PACK&GO Claude-Code skills are server-side and registry-dispatchable, RefundAgent fires on `charge.refunded`, every autonomous agent has at least one happy-path Vitest.

**Hours:** ~110 AI / ~4 Jeff. **Calendar:** Weeks 3–4 of the v2 window.

**Pre-conditions met:** ✅ Wave 1 (logger + Sentry) ✅ Wave 2 (db.ts split + masterAgent split unblock sub-router work) ✅ Per-route auth middleware (W1 hotfix 2026-05-22, makes anonymous tRPC reachable for skill-registry inspection).

### Dependency graph

```
3.1 sub-intents ────────┐
                        ├── 3.4 auto-dispatch ──┐
3.2 skill registry ─────┤                       │
                        ├── 3.6 visa skill ────┤
3.3 orchestrator ───────┘                       │
                                                ├── 3.10 vitest batch ── 3.11 notify-owner
3.5 refund-stripe-wire (independent) ──────────┤
                                                ├── 3.13 skills folder rename
3.7 tour-confirmation port (independent) ──────┘
3.8 vitest-inquiry (extends 3.1's test file)
3.9 vitest-master-agent (extends 3.4)
3.12 confidence-threshold (independent)
```

**Parallel-safe entry batch (start day 1, no dependencies):**
- 3.1 (sub-intents)
- 3.2 (skill registry)
- 3.3 (orchestrator interface)
- 3.5 (RefundAgent + Stripe webhook)
- 3.7 (port packgo-tour-confirmation)
- 3.12 (confidence threshold config)

**Sequential-after-3.1+3.2+3.3 (start day 2-3):**
- 3.4 (auto-dispatch — needs all 3 prereqs)
- 3.6 (port packgo-china-visa — uses registry from 3.2)

**Sequential-after-3.1 (start day 2):**
- 3.8 (inquiry agent vitest — extends 3.1's test file)

**End-of-wave batch:**
- 3.9, 3.10, 3.11, 3.13

### Module table

| # | Module | Status | Owner | Notes |
|---|---|---|---|---|
| 3.1 | [Classifier sub-intents (5 new)](tasks/v2-wave-3/module-3.1-classifier-sub-intents.md) | ✅ | claude | `2f773ba` · 5 new intents + 5 fixtures + 6 Vitest cases |
| 3.2 | [Skill registry create](tasks/v2-wave-3/module-3.2-skill-registry-create.md) | ✅ | claude | `5002832` · Map + lookupSkill + listRegisteredIntents + 16 Vitest cases |
| 3.3 | [Skill orchestrator interface](tasks/v2-wave-3/module-3.3-skill-orchestrator-interface.md) | ✅ | claude | `3a03480` · SkillOrchestrator + SkillResult discriminated + tourComparisonOrchestrator + 10 Vitest cases |
| 3.4 | [Inquiry auto-dispatch](tasks/v2-wave-3/module-3.4-inquiry-auto-dispatch.md) | ✅ | claude | `0f52f50` (A: pure) + `96dd2b9` (B: persisted + gmailPipeline + migration 0079) · 17 Vitest cases · **LIVE in prod v512** · auto-send safeguards (allow-list/quota/circuit-breaker) deferred to follow-up |
| 3.12 | [Confidence threshold config](tasks/v2-wave-3/module-3.12-confidence-threshold-config.md) | ✅ | claude | `cd83ba0` · AGENT_CONFIDENCE_THRESHOLD + AGENT_AUTO_SEND_THRESHOLD env getters + 16 Vitest cases |
| 3.5 | [RefundAgent ↔ Stripe webhook](tasks/v2-wave-3/module-3.5-refund-agent-stripe-wire.md) | ⬜ | — | Independent; fires on `charge.refunded` |
| 3.6 | [Port packgo-china-visa skill](tasks/v2-wave-3/module-3.6-port-packgo-china-visa.md) | ⬜ | — | Depends on 3.2; **🔒 LOCKED 2026-05-22: bilingual (zh-TW left / en right, 2-column)** |
| 3.7 | [Port packgo-tour-confirmation skill](tasks/v2-wave-3/module-3.7-port-packgo-tour-confirmation.md) | ⬜ | — | Independent; **🔒 LOCKED 2026-05-22: no manual regenerate button (auto-only via dispatcher 3.4)** |
| 3.8 | [Vitest — InquiryAgent](tasks/v2-wave-3/module-3.8-vitest-inquiry-agent.md) | ⬜ | — | Extends 3.1's `inquiryAgent.test.ts` |
| 3.9 | [Vitest — masterAgent](tasks/v2-wave-3/module-3.9-vitest-master-agent.md) | ⬜ | — | Supervisor + email template happy path |
| 3.10 | [Vitest — autonomous agents batch (15 files)](tasks/v2-wave-3/module-3.10-vitest-autonomous-agents-batch.md) | ⬜ | — | One per agent; mostly happy-path + 1 edge |
| 3.11 | [Notify-owner consistency](tasks/v2-wave-3/module-3.11-notify-owner-consistency.md) | ⬜ | — | Unify Jeff-pager surface across agents |
| 3.12 | (moved up next to 3.4 — see above) | — | — | (delisted to keep table compact) |
| 3.13 | [Skills folder rename](tasks/v2-wave-3/module-3.13-skills-folder-rename.md) | ⬜ | — | Disambiguate 3 "skills" folders |

**Verification gate:** All 13 modules' Vitest cases pass; `pnpm tsc --noEmit` clean; **end-to-end smoke:** a manually-crafted inbound email of each new intent type lands the right skill via auto-dispatch.

**Manual Jeff interventions during W3:** All architecture-level decisions locked 2026-05-22. Remaining runtime callouts are tactical (review fixture PDFs, confirm thresholds in module 3.12, etc.) — surfaced at module-execution time, not pre-kickoff.

**Risks / known landmines:**
- v1 git-race lesson: sub-agents commit sequentially via supervisor relay
- 3.4 auto-dispatch must guard `notifyOwner` integration end-to-end — easy to miss the safety regex on the draft path

---

## Wave 4 — Mobile + Polish ⬜

**Goal:** PWA-grade customer site (manifest + service worker + web push + install prompt) + Expo React Native admin app (inbox / chat / bookings screens + APNS/FCM push) + Playwright customer-flow E2E + 1,200-leak i18n sweep + 1,250-site pino full sweep + bundle analyzer in CI.

**Hours:** ~156 AI / ~11 Jeff. **Calendar:** Weeks 4–6 of the v2 window.

**Pre-conditions:** Wave 3 must ship inbox/chat tRPC procedures the mobile app consumes. **However, the PWA half (4.1–4.6) and the polish half (4.16–4.27) are independent of W3 and can run in parallel.**

**🔒 v2 scope decision 2026-05-19:** RN admin app sub-theme (4.7–4.15, 9 modules) **DEFERRED to v3.** Apple Developer ($99/yr) + Google Play ($25) not committed; revisit after mobile-traffic data lands. Module 4.9 retargeted from Manus → Google OAuth for v3 reactivation (locked 2026-05-22).

### Sub-themes

```
PWA          (4.1–4.6)    ── independent of W3   ── start in parallel    [IN SCOPE]
React Native (4.7–4.15)   ── needs W3 inbox/chat ── start after W3 ships [DEFERRED v3]
Polish       (4.16–4.27)  ── mostly independent  ── trickle through wave [IN SCOPE]
```

### Module table

#### Sub-theme A — PWA (web) · independent of W3

| # | Module | Status | Notes |
|---|---|---|---|
| 4.1 | [PWA manifest polish](tasks/v2-wave-4/module-4.1-pwa-manifest-polish.md) | ⬜ | **🚨 theme_color teal vs black — plan recommends teal `#0D9488`** |
| 4.2 | [Service worker (Workbox)](tasks/v2-wave-4/module-4.2-service-worker-workbox.md) | ⬜ | Stale-while-revalidate for tour pages |
| 4.3 | [Web push subscription](tasks/v2-wave-4/module-4.3-web-push-subscription.md) | ⬜ | iOS standalone-mode banner copy decided here |
| 4.4 | [Push notification events (3 types)](tasks/v2-wave-4/module-4.4-push-notification-events.md) | ⬜ | new_inquiry / booking_paid / tour_24h |
| 4.5 | [Install prompt UX](tasks/v2-wave-4/module-4.5-install-prompt-ux.md) | ⬜ | Add-to-home-screen flow |
| 4.6 | [Lighthouse PWA gate (CI)](tasks/v2-wave-4/module-4.6-lighthouse-pwa-gate.md) | ⬜ | PWA ≥ 90, perf ≥ 70 |

#### Sub-theme B — React Native admin (Expo) · **DEFERRED to v3** · needs Apple+Google dev accounts ($124/yr)

| # | Module | Status | Notes |
|---|---|---|---|
| 4.7 | [Expo monorepo setup](tasks/v2-wave-4/module-4.7-expo-monorepo-setup.md) | ⏸️ v3 | `@packgo/shared` workspace |
| 4.8 | [EAS build config](tasks/v2-wave-4/module-4.8-eas-build-config.md) | ⏸️ v3 | 459 LOC spec — most-detailed module |
| 4.9 | [Google OAuth deep-link spike](tasks/v2-wave-4/module-4.9-manus-oauth-deep-link-spike.md) | ⏸️ v3 | **🔒 LOCKED 2026-05-22: target Google OAuth (was Manus, stale)** |
| 4.10 | [RN inbox screen](tasks/v2-wave-4/module-4.10-rn-inbox-screen.md) | ⏸️ v3 | |
| 4.11 | [RN agent chat screen](tasks/v2-wave-4/module-4.11-rn-agent-chat-screen.md) | ⏸️ v3 | |
| 4.12 | [RN bookings screens](tasks/v2-wave-4/module-4.12-rn-bookings-screens.md) | ⏸️ v3 | |
| 4.13 | [Expo Notifications + APNS/FCM](tasks/v2-wave-4/module-4.13-expo-notifications-apns-fcm.md) | ⏸️ v3 | |
| 4.14 | [Detox smoke tests](tasks/v2-wave-4/module-4.14-rn-detox-smoke-tests.md) | ⏸️ v3 | |
| 4.15 | [App store submission prep](tasks/v2-wave-4/module-4.15-app-store-submission-prep.md) | ⏸️ v3 | TestFlight + Play Console |

#### Sub-theme C — Polish · mostly independent

| # | Module | Status | Notes |
|---|---|---|---|
| 4.16 | [Playwright customer flows](tasks/v2-wave-4/module-4.16-playwright-customer-flows.md) | ⬜ | Search → Book → Pay |
| 4.17 | [i18n restructure (zh-TW / zh-CN / en)](tasks/v2-wave-4/module-4.17-i18n-restructure-zh-en.md) | ⬜ | |
| 4.18 | [i18n leak sweep (top ~1,200)](tasks/v2-wave-4/module-4.18-i18n-leak-sweep.md) | ⬜ | **🚨 Jeff reviews ~30 critical brand-voice strings** |
| 4.19 | [Lazy images](tasks/v2-wave-4/module-4.19-loading-lazy-images.md) | ⬜ | |
| 4.20 | [N+1 query fixes](tasks/v2-wave-4/module-4.20-n-plus-1-fixes.md) | ⬜ | |
| 4.21 | [auditLog enforcement](tasks/v2-wave-4/module-4.21-auditlog-enforcement.md) | ⬜ | Lint rule: every admin mutation logs |
| 4.22 | [AB-390 dashboard tile](tasks/v2-wave-4/module-4.22-ab390-dashboard-tile.md) | ⬜ | Trial-funnel observability |
| 4.23 | [scripts/ folder purge](tasks/v2-wave-4/module-4.23-scripts-folder-purge.md) | ⬜ | **🚨 Jeff reviews list before delete (~20 min)** |
| 4.24 | [Pino full sweep](tasks/v2-wave-4/module-4.24-pino-full-sweep.md) | ⬜ | ~1,250 sites (see `wave-4-deferrals.md`) |
| 4.25 | [Storybook design system](tasks/v2-wave-4/module-4.25-storybook-design-system.md) | ⬜ | |
| 4.26 | [Bundle analyzer in CI](tasks/v2-wave-4/module-4.26-bundle-analyzer-ci.md) | ⬜ | Per-route size budget |
| 4.27 | [Phase-0 stash triage](tasks/v2-wave-4/module-4.27-stash-phase0-mod4-decision.md) | ⬜ | **🚨 Jeff decides per stashed file** |

**Verification gate:**
- PWA: Lighthouse PWA ≥ 90, perf ≥ 70 on CI
- RN: TestFlight + Play Internal Testing builds install + push received
- Polish: ~1,200 i18n leaks closed (machine-translate then Jeff-spot-check ~30); pino sweep ≥ 95% of `console.*` migrated
- Vitest: ≥ 90% pass rate across all new files

**Manual Jeff interventions (consolidated):**
- 🚨 Module 4.1 — theme_color confirm (5 min) — **recommendation: teal `#0D9488`**
- 🚨 Module 4.3 — iOS standalone-mode messaging copy (5 min)
- 🚨 Module 4.6 — Lighthouse threshold gate behavior on first-fail (10 min)
- 🚨 Module 4.9 — Google-OAuth deep-link target (was Manus; **needs spec re-read by sub-agent**)
- 🚨 Module 4.18 — review ~30 critical customer-facing strings (30 min)
- 🚨 Module 4.23 — `scripts/` archive list before delete (20 min)
- 🚨 Module 4.27 — Phase-0 stash triage per-file (10 min)
- Total: ~85 min across the wave

---

## Pre-flight checklist before Stage 4 kickoff

**Required (block kickoff):**
- [x] Stage 1, 2, 3 docs all present and current
- [x] Wave 1 + 2 shipped + verified in prod
- [x] tsc clean / Vitest green on tip commit
- [x] Husky pre-commit gate active (commits without `pnpm tsc --noEmit` succeed are blocked)
- [x] **Jeff W3 decisions ack'd 2026-05-22:** 3.4 confidence-gated auto-send (was draft-first; reversed via §3.4 task spec safeguards); 3.6 bilingual (zh/en 2-col); 3.7 no manual regenerate
- [x] **Jeff W4 v2-scope decisions ack'd 2026-05-22:** 4.9 retargeted Manus → Google OAuth (deferred to v3 anyway). 4.1/4.3/4.6 runtime decisions deferred to module-execution (not kickoff blockers)

**Recommended (smooth ride):**
- [ ] R2 + Sentry credentials rotated (Jeff exposed them in chat earlier)
- [ ] Master keys printed to paper (APP_ENCRYPTION_KEY + JWT_SECRET + STRIPE_WEBHOOK_SECRET)
- [ ] `support@packgoplay.com` admin grant verified (already done 2026-05-22 via `scripts/grant-admin.mjs`; will need re-grant if user table is rebuilt)

---

## Recommended first action

**Kick off Wave 3 with the 6 parallel-safe entry modules** (3.1, 3.2, 3.3, 3.5, 3.7, 3.12). They have no inter-dependencies and together they unblock the harder modules later in the wave. Estimated ~25h AI / ~30 min Jeff for that opening batch.

Wave 4 PWA sub-theme (4.1–4.6) can run in parallel with Wave 3 if AI capacity is available — they share no files and only marginally touch each other's domains.

After the opening batch lands, the supervisor pattern from Wave 2 stays: sub-agent returns diff → supervisor runs `tsc + Vitest` → supervisor commits → next dispatch.

---

## Change log on this file

- 2026-05-22 — Created. Wave 1 + 2 marked done; Waves 3 + 4 ready for Stage 4 kickoff.
- 2026-05-22 — Jeff ack'd W3 decisions (3.4 confidence-gated auto-send / 3.6 bilingual / 3.7 no manual regenerate); W4 RN sub-theme (4.7–4.15) marked ⏸️ v3-deferred; 4.9 retargeted Manus → Google OAuth for future v3 reactivation; pre-flight checklist fully green.
- 2026-05-22 — Wave 3 Stage 4 kickoff. Modules 3.1 / 3.3 / 3.2 landed (`2f773ba` / `3a03480` / `5002832`). Foundation in place — `lookupSkill(intent)` returns the tourComparison orchestrator for `tour_comparison_request` and `new_inquiry`; null for everything else (pending ports). 32 new Vitest cases. Total suite 711 pass.
