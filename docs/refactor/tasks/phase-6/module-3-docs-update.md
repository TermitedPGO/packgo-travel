# Phase 6 · Module 3 · Docs Update + Tag Release

**Parent plan:** docs/refactor/plan.md (Phase 6 · Final Verification + Smoke + Docs)
**Audit ref:** N/A (close-out documentation)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1 h AI + 0.5 h Jeff review
**Schedule slot:** Day 14 (after Module 2 ALL-PASS)

## Goal
Update `CLAUDE.md` to reflect the refactor's structural changes, write a `completed-<date>.md` close-out report capturing what landed + deferred + lessons, and tag the merge commit `refactor-v1-complete`. After this module ships, v1 of the refactor is officially closed and v2 can be scheduled.

## Pre-requisites
- Module 1 (full regression) PASS — `docs/refactor/phase-6-regression-report.md` verdict = PASS
- Module 2 (manual smoke) ALL-PASS — `docs/refactor/phase-6-smoke-log.md` verdict = ALL-PASS
- All Phase 0-5 commits already merged into main and deployed
- 30-min post-smoke health watch (Item 6 of Module 2) completed without 5xx
- Working tree clean: `git status --short` returns 0 lines

## Inputs (read these before executing)
- `CLAUDE.md` §六 (lines 189-208) — the "關鍵檔案路徑" table to be edited. Current shape captured below for reference.
- `CLAUDE.md` §九 — Vibe Coding section that triggered this refactor. No edit needed unless §9 references a stale path.
- `docs/refactor/plan.md` — full strategic context; the "Deferred to v2 refactor" section (line 379-398) is the source for the completed.md's "Deferred" section.
- `docs/refactor/audit-2026-05-18.md` — original audit, source for "Original problem severity" column in completed.md.
- `docs/refactor/progress.md` — per-phase pass/fail roll-up (built incrementally during the 2-week burst).
- `docs/refactor/phase-6-regression-report.md` — Module 1 verdict + test count + coverage spot-check.
- `docs/refactor/phase-6-smoke-log.md` — Module 2 verdict.
- Today's date for the filename: run `date +%Y-%m-%d` (expected `2026-05-31` give-or-take a day; use the exact day this module ships).

## Procedure

### Step 1 — Update CLAUDE.md §六 (exact diff below, not free-form edit)

The CURRENT §六 table looks like this (CLAUDE.md lines 191-207):

```
| 功能 | 檔案 |
|------|------|
| 資料庫 Schema | `drizzle/schema.ts` |
| tRPC 路由 | `server/routers.ts` |
| 資料庫查詢 | `server/db.ts` |
| LLM 調用 | `server/_core/llm.ts` |
| S3 儲存 | `server/storage.ts` |
| 認證狀態 | `client/src/_core/hooks/useAuth.ts` |
| 路由設定 | `client/src/App.tsx` |
| 全域樣式 | `client/src/index.css` |
| i18n 繁中 | `client/src/locales/zh-TW.ts` |
| i18n 英文 | `client/src/locales/en.ts` |
| AI 生成主控 | `server/agents/masterAgent.ts` |
| 進度追蹤 | `server/agents/progressTracker.ts` |
| 行程詳情頁 | `client/src/pages/TourDetailPeony.tsx` |
| 管理後台行程 | `client/src/components/admin/ToursTab.tsx` |
| 行程編輯對話框 | `client/src/components/admin/TourEditDialog.tsx` |
```

Apply this **EXACT** replacement using the `Edit` tool (NOT freehand). Old row:

```
| tRPC 路由 | `server/routers.ts` |
```

New row (one row replaced by three):

```
| tRPC 路由（composition shell） | `server/routers.ts` (≤50 LOC, re-exports `server/routers/*.ts`; v1 refactor 2026-05) |
| tRPC 路由（domain files） | `server/routers/{newsletter,favorites,browsingHistory,tours,inquiries,bookings,bookingsPayment,departures,imageLibrary,homepage,vouchers,packpoint,accounting,adminAnalytics,adminAudit,adminMonitor,adminAutonomous,adminCalibration,adminMarketing,translation,exchangeRate,affiliate,wechatAssist,visa,skills}.ts` (each ≤300 LOC) |
| Stripe webhook 中央 idempotency | `server/_core/stripeWebhookIdempotency.ts` + `stripeWebhookEvents` table in `drizzle/schema.ts` (v1 refactor 2026-05) |
```

**Important:** Use the actual list of router files that exist in `server/routers/` after Phase 4 — adjust the file enumeration to match reality, not the speculative list above. Run `ls server/routers/*.ts | wc -l` and `ls server/routers/*.ts` to capture the actual set.

If the actual count exceeds 12 files, abbreviate the cell with: `server/routers/*.ts — <N> domain files, each ≤300 LOC; see plan.md` and remove the inline enumeration.

### Step 2 — Update CLAUDE.md §九 version history

Locate the version history at the very bottom of CLAUDE.md (§九 versioning). Append a row to the version table:

```
| 1.1 | <YYYY-MM-DD> | v1 refactor complete: tsc 0 errors, Stripe webhook hardened, routers.ts split into 25 domain files. See docs/refactor/completed-<date>.md |
```

(If §九 has no version table — check first with `grep -n "版本歷史" CLAUDE.md` — add the version note at the bottom of §九 as a one-line addendum.)

### Step 3 — Write the close-out report `docs/refactor/completed-<YYYY-MM-DD>.md`

Filename uses today's actual date (use `date +%Y-%m-%d`). Target length: ≤200 lines. Template:

```markdown
# PACK&GO Refactor v1 — Completed <YYYY-MM-DD>

**Started:** 2026-05-18 (Stage 1 audit + Stage 2 plan)
**Completed:** <YYYY-MM-DD>
**Total burst window:** ~14 days (Day 0 → Day 14)
**Tag:** `refactor-v1-complete`

## TL;DR
- 5 P0-severity issues from audit-2026-05-18.md → 4 fully resolved, 1 partially resolved (P0-1 routers split done; P0-4 masterAgent split deferred to v2).
- TypeScript: 40 errors → 0; husky pre-commit hook now enforces.
- Stripe webhook: 0 tests → ~23 cases; multi-write handlers wrapped in `db.transaction`; central idempotency table replaces 6 per-handler checks.
- `server/routers.ts`: 10,122 LOC god-file → ~50 LOC composition shell + 25 domain files (each ≤300 LOC).
- Dead code purged: FloatingOpsAgent.tsx + TodayOverview.tsx (~600 LOC removed).
- New test files: ~<exact count from regression report>.
- Production deploys: ~<count> (one per phase, weekday-morning per plan).
- Production incidents during refactor: <count from incident log, ideally 0>.

## What landed, phase by phase

| Phase | Day(s) | Headline outcome | Actual cost vs plan |
|---|---|---|---|
| 0 WIP stabilize | 0 | 227 uncommitted → 0; <N> coherent commits + stashes | <Xh> / 2-4h+1-2h |
| 1 tsc 40→0 | 1 | tsconfig fix cleared ~10; clusters A/B/C closed rest; husky live | <Xh> / 4-6h+1h |
| 2 Stripe hardening | 2-3 | `stripeWebhookEvents` table; 6 handler families wrapped in tx; ~23 Vitest cases | <Xh> / 8-10h+2h |
| 3 Dead code purge | 3-4 | FloatingOpsAgent + TodayOverview deleted; `today-legacy` PageId removed | <Xh> / 1-2h+0.5h |
| 4 routers split | 4-9 | 5 sub-PRs (4A safe / 4B read-only admin / 4C customer txn / 4D money paths / 4E admin tools); final shell <N> LOC | <Xh> / 12-16h+3-4h |
| 5 P1 cleanup | 10-12 | supplierSync split + 3 tests; ToursTab + AutonomousAgentsTab helpers extracted | <Xh> / 8-12h+1.5h |
| 6 verify+smoke+docs | 13-14 | tsc 0 / vitest <N> pass / smoke <N>/<N> / docs + tag | <Xh> / 3-4h+2h |

Per-phase detail lives in each phase's task files (`docs/refactor/tasks/phase-{0..6}/`); no need to duplicate here.

## Deferred to v2 (with recommendation)

Direct from plan.md "Deferred to v2 refactor" section, with v1-experience-informed adjustments:

| Item | Audit ID | Original est. | Recommend v2 timing |
|---|---|---|---|
| TourDetailPeony.tsx split | P1-3 | 10-14h | v2 phase 1 — 3,827 LOC, customer-facing, deserves its own Vibe Coding cycle |
| Other 1000+ LOC client splits (×9 files) | P1-5 partial | 36-54h | v2 phase 2-3 — interleave between rest of v2 work |
| 116 hard-coded Chinese strings sweep | P1-9 | 4-6h | v2 phase 4 (after P1-2 i18n restructure) |
| i18n dictionary restructure | P1-2 | 6-8h | v2 phase 3 — must precede P1-9 |
| masterAgent.ts split | P0-4 | 16-24h | v2 phase 1 (parallel to TourDetailPeony) — 3,300 LOC tangled state, highest-risk v2 work |
| Full autonomous-agents file splits | P0-5 split work | 20-30h | v2 phase 2 |
| db.ts split | P1-4 | 8-12h | v2 phase 4 — prerequisite for any future routers refactor |
| agentRouter.ts split | P1-1 | 8-10h | v2 phase 2 (after autonomous-agents) |
| email.ts split | P1-5 partial | 4-6h | v2 polish phase |
| tourComparison.ts split + tests | P1-6 | 4-6h | v2 polish phase |
| scripts/ purge (102 files) | P1-8 | 6-8h | v2 polish phase — interleave as palate-cleanser |
| Skills naming consolidation | "Notes on Scope" | 2-4h | v2 polish phase |

**v2 total est:** ~120-170 h AI + ~20-25 h Jeff review. **Recommend scheduling 2-4 weeks after v1 lands** so production stability is proven first.

## Lessons learned

Concrete examples only — no platitudes. ≥3 entries each section.

- **Cost MORE than estimated:** <3+ bullets with phase + specific reason>
- **Cost LESS than estimated:** <3+ bullets>
- **Surprises:** <3+ bullets — both positive and negative>
- **Process refinements for v2:** <3+ bullets — concrete changes for the v2 Vibe Coding cycle>

## Acceptance signal for v1

- TypeScript: `pnpm check` exit 0 sustained for ≥7 days post-tag
- Stripe webhook: 5xx rate ≤ 0.1% sustained for ≥7 days post-tag (baseline pre-Phase-2 unknown — establish as new SLA)
- Customer support tickets mentioning refactor symptoms (broken pages, double-charges, missing emails): 0 for ≥7 days post-tag → v1 declared stable

## Files referenced by this report
- `docs/refactor/audit-2026-05-18.md` (input)
- `docs/refactor/plan.md` (strategy)
- `docs/refactor/progress.md` (per-phase tracking)
- `docs/refactor/phase-6-regression-report.md` (Module 1 verdict)
- `docs/refactor/phase-6-smoke-log.md` (Module 2 verdict)
- All `docs/refactor/tasks/phase-{0..6}/module-*.md` files (executed task specs)
```

### Step 4 — Tag the merge commit

```bash
cd /Users/jeff/Desktop/網站
git status --short  # must return 0 lines

# Confirm we're tagging the correct commit (the commit that includes Module 3's CLAUDE.md edit + completed-<date>.md)
git log -1 --oneline

# Create annotated tag
git tag -a refactor-v1-complete -m "Refactor v1 complete (audit 2026-05-18 → completion <today>)

Phases 0-6 all green:
- Phase 0: WIP stabilized, clean tree achieved
- Phase 1: tsc 40 → 0 errors; husky pre-commit hook live
- Phase 2: Stripe webhook idempotency table + transactions + ~23 tests
- Phase 3: FloatingOpsAgent + TodayOverview deleted
- Phase 4: routers.ts split into 25 domain files (composition shell ≤50 LOC)
- Phase 5: supplierSyncService split; ToursTab + AutonomousAgentsTab helpers extracted
- Phase 6: regression + smoke + docs

Total new test cases: ~<N>
Production incidents during refactor: <count>
Deferred to v2: see docs/refactor/completed-<date>.md"

# Verify tag
git tag -l refactor-v1-complete
git show refactor-v1-complete --stat | head -20
```

### Step 5 — Push tag (Jeff-approved only)

```bash
# Push the tag to origin (NOT --force; tag is immutable once accepted)
git push origin refactor-v1-complete

# Verify the tag is on the remote
git ls-remote --tags origin | grep refactor-v1-complete
```

**Do not push tag automatically.** Wait for Jeff's explicit go-ahead (manual intervention flag below).

### Step 6 — Final commit for Module 3

Commit the CLAUDE.md edits + the new `completed-<date>.md`:

```bash
git add CLAUDE.md docs/refactor/completed-*.md
git status  # confirm only these two files staged
git commit -m "$(cat <<'EOF'
docs(refactor): Phase 6 module 3 — close-out docs + tag v1

- CLAUDE.md §六: split tRPC路由 row into composition shell +
  domain files + Stripe webhook idempotency row.
- CLAUDE.md §九: append v1.1 version-history entry.
- New: docs/refactor/completed-<date>.md captures landed/deferred/lessons.
- Tag refactor-v1-complete points at this commit.

Refactor v1 closed. v2 backlog documented in completed file.
EOF
)"

git tag -a refactor-v1-complete -m "..." # only if not already tagged (re-tag at the new HEAD)
```

If the tag was created at a prior commit (Step 4), MOVE the tag to this final commit:

```bash
git tag -d refactor-v1-complete                    # delete local tag
git tag -a refactor-v1-complete -m "..."           # re-create at new HEAD
# (the push in step 5 is now what pushes the final state)
```

### Step 7 — Update `docs/refactor/progress.md` close-out row

Mark Phase 6 / Module 3 as DONE. Add a final "Refactor v1 closed at <date>" line at the bottom.

## Acceptance Criteria
- [ ] `CLAUDE.md` §六 contains the new 3-row structure for tRPC routing + Stripe idempotency
- [ ] `CLAUDE.md` §九 has a v1.1 version-history entry referencing today's completed-<date>.md
- [ ] `docs/refactor/completed-<YYYY-MM-DD>.md` exists, ≤200 lines, all sections filled (not template placeholders)
- [ ] Lessons-learned section has ≥3 concrete entries each in "Cost MORE" and "Cost LESS" — not empty placeholders
- [ ] Test count in completed.md matches the count in `phase-6-regression-report.md` (no discrepancy)
- [ ] `git tag refactor-v1-complete` exists locally
- [ ] Tag annotation includes the phase summary message
- [ ] Tag pushed to origin (after Jeff approval)
- [ ] `docs/refactor/progress.md` Phase 6 / Module 3 row = DONE
- [ ] `pnpm check` still exit 0 after all docs edits (sanity — docs don't typecheck but the tree must remain clean)

## Deliverable
- Modified: `CLAUDE.md` (§六 table + §九 version history)
- Modified: `docs/refactor/progress.md`
- New: `docs/refactor/completed-<YYYY-MM-DD>.md`
- New: git tag `refactor-v1-complete` (local + remote after Jeff approval)
- Two commits expected:
  1. The docs-update commit (Step 6)
  2. (No second commit if tagging the same SHA; otherwise step 6 also re-tags HEAD)

## Rollback
- Docs rollback: `git revert <commit-SHA>` restores CLAUDE.md and removes completed-<date>.md
- Tag rollback (local + remote):
  ```bash
  git tag -d refactor-v1-complete
  git push origin :refs/tags/refactor-v1-complete   # delete on remote
  ```
- **WARNING:** Once `refactor-v1-complete` is pushed and referenced externally (e.g., in a release-notes email or Slack), retracting it is awkward. Treat the push as the point of no return — Jeff must confirm Module 1 + 2 verdicts before this module runs Step 5.

## Manual intervention
- **Jeff (mandatory):** read the `completed-<date>.md` close-out and confirm the "Lessons learned" entries are honest, not boilerplate. AI cannot generate truthful retrospective content — the cost-MORE / cost-LESS bullets must come from Jeff's lived experience over the 2-week burst.
- **Jeff (mandatory):** approve `git push origin refactor-v1-complete` explicitly. AI never pushes the tag without spoken/written go-ahead.
- **AI (supervisor):** apply the CLAUDE.md edits exactly as specified above (no creative reinterpretation); generate the completed-<date>.md skeleton with placeholders that Jeff fills the lessons-learned sections of; tag locally and wait for Jeff before push.

## Test plan
- This module has no functional code change — no automated test gates beyond `pnpm check` exit 0 (which only verifies CLAUDE.md edits didn't break a typecheck-adjacent tool).
- Manual verification:
  1. Open `CLAUDE.md` § 六 in editor → confirm the new rows render correctly in markdown preview
  2. Open `docs/refactor/completed-<date>.md` → confirm structure matches step 3 template; lessons sections not empty
  3. Run `git tag -l refactor-v1-complete` → exactly one match
  4. Run `git show refactor-v1-complete` → annotation message matches Step 4
  5. After push, run `git ls-remote --tags origin | grep refactor-v1-complete` → exactly one match on remote
