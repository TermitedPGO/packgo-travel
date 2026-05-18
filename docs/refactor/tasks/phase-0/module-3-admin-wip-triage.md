# Phase 0 · Module 3 · Admin WIP Triage

**Parent plan:** docs/refactor/plan.md (Phase 0 · WIP Stabilization)
**Audit ref:** N/A (Phase 0 is prerequisite)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.0 h AI + 0.5 h Jeff review (heaviest manual-intervention module)

## Goal
Move every modified admin file (`client/src/components/admin/**`) plus the new untracked admin primitives/tabs into one of: (a) a clean commit, (b) a named stash. Default action when uncertain is STASH — admin WIP carries higher refactor blast radius than home/page tweaks.

## Pre-requisites
- Module 1 (Round-80 deletions) ideally landed first to clear the diff surface.
- Module 2 (client UI commits) can run in parallel — disjoint file sets.

## Inputs (read these before executing)
- Run `git status --porcelain | grep -E 'client/src/components/admin'` to confirm scope.
- Modified admin files (from current `git status`):
  1. `client/src/components/admin/DashboardTab.tsx`
  2. `client/src/components/admin/DeparturePreview.tsx`
  3. `client/src/components/admin/DeparturesManagement.tsx`
  4. `client/src/components/admin/GenerationProgress.tsx`
  5. `client/src/components/admin/MonitorDashboard.tsx`
  6. `client/src/components/admin/ReviewsTab.tsx`
  7. `client/src/components/admin/ToursTab.tsx` (per audit P1-5: 1907 LOC, has tsc errors → DO NOT commit in Phase 0; STASH or leave alone for Phase 1)
- Untracked admin files (mature scaffolds vs. exploratory):
  - `client/src/components/admin/LlmCostTab.tsx`
  - `client/src/components/admin/OfficeOverviewTab.tsx`
  - `client/src/components/admin/PackpointTab.tsx`
  - `client/src/components/admin/VouchersTab.tsx`
  - `client/src/components/admin/primitives/` (CommandPalette, DataTable, EmptyState, FilterChip, KPIStrip, PageHeader, StatusDot, TopBar, index.ts) — per memory `feedback_admin_design_system.md` these are the new admin primitives, likely mature
  - `client/src/components/admin/tools/` (untracked subtree, content unknown — must inspect)
  - `client/src/components/admin/tours/` (untracked subtree, content unknown — must inspect)
- Pages that pair with admin: `client/src/pages/preview/` (untracked) — likely admin preview tool
- CLAUDE.md §六 — `ToursTab.tsx` and `TourEditDialog.tsx` are flagged as canonical key files.
- Memory: `feedback_admin_design_system.md` (admin design tokens & primitives).
- Audit P1-5: ToursTab.tsx has TSC errors (cluster C, fixed in Phase 1) → MUST NOT be committed in this phase since the diff likely includes WIP fixes that conflict with Phase 1's authoritative cluster-C work.

## Procedure
1. **Snapshot scope:**
   ```bash
   git status --porcelain | grep admin > /tmp/phase0-mod3-admin-status.txt
   wc -l /tmp/phase0-mod3-admin-status.txt
   ```
   Expect ~7 `M` + ~14 `??` admin entries.

2. **Inspect every modified admin file's diff:**
   ```bash
   for f in client/src/components/admin/DashboardTab.tsx \
            client/src/components/admin/DeparturePreview.tsx \
            client/src/components/admin/DeparturesManagement.tsx \
            client/src/components/admin/GenerationProgress.tsx \
            client/src/components/admin/MonitorDashboard.tsx \
            client/src/components/admin/ReviewsTab.tsx \
            client/src/components/admin/ToursTab.tsx; do
     echo "=== $f ==="
     git diff --stat "$f"
   done
   ```
   Then run `git diff <file> | head -120` per file to read the actual change.

3. **For each modified file, classify into:** record decision in `/tmp/phase0-mod3-decisions.txt`.
   - `COMMIT-CLEAN`: change is finished, small, single-concern, no TODO markers, no `// TEMP` / `// FIXME`. Safe to commit.
   - `COMMIT-WITH-STASH-SPLIT`: diff contains both finished and exploratory hunks. Use `git add -p` to interactively stage only the clean hunks; stash the rest.
   - `STASH-WHOLE`: diff is exploratory or paired with cross-file WIP. Stash entirely.
   - `BLOCK`: file is flagged for Phase 1 (e.g., `ToursTab.tsx` — has tsc errors that Phase 1 Cluster C owns). Stash with a label that signals "phase-1-blocks-this".

   **Default decision rule:** if uncertain, classify as `STASH-WHOLE`. Admin WIP is harder to revert than home WIP.

4. **For each untracked admin file:** run a maturity sniff test:
   ```bash
   wc -l <file>
   grep -E 'TODO|FIXME|TEMP|XXX|console\.log' <file>
   grep -E 'export default|export function|export const' <file>
   ```
   `primitives/*.tsx` are documented in memory as the new admin design-system primitives → these are `COMMIT-CLEAN`.
   `tools/` and `tours/` subtrees: `ls -la` them, sample 1-2 files, and ask Jeff yes/no whether the subtree is ready to commit. Until Jeff approves, treat as `STASH-WHOLE`.

5. **Proposed commit groups** (assuming step 3 + 4 classifications):
   - **Commit A — `feat(admin): design-system primitives + index export`**
     - All `client/src/components/admin/primitives/*.tsx` + `index.ts` (untracked, mature)
     - Only land this commit if Jeff confirms primitives are the production set per memory `feedback_admin_design_system.md`.
   - **Commit B — `feat(admin): new tabs (LlmCost, OfficeOverview, Packpoint, Vouchers)`** (conditional)
     - The 4 new untracked tab files — ONLY if all 4 compile, have no `TODO`, and Jeff confirms each is wired to a route or admin nav.
     - If any one fails: drop that one to a stash, ship the rest.
   - **Commit C — `chore(admin): MonitorDashboard / ReviewsTab / DashboardTab polish`** (conditional)
     - Only files classified `COMMIT-CLEAN` in step 3.
   - **STASH `phase0/mod3/tours-tab-wip`** — `ToursTab.tsx` (per audit P1-5 blocked by Phase 1)
   - **STASH `phase0/mod3/<file>-wip`** for each `STASH-WHOLE` classification.

6. **Execute the plan after supervisor + Jeff approval.** Per commit:
   ```bash
   git add <files for this commit>
   git diff --cached --stat
   pnpm tsc --noEmit 2>&1 | tail -3   # error count MUST NOT increase vs Stage 1 baseline (~40)
   git commit -F /tmp/phase0-mod3-commit-<A|B|C>.txt
   ```
   Per stash:
   ```bash
   git stash push --keep-index -m "phase0/mod3/<label>" -- <file(s)>
   git stash list | tail -5
   ```

7. **Special handling for `pages/preview/`** (untracked dir): if it pairs with an admin tab in step 5, bundle it into that commit. If standalone (admin-only preview tool), stash with label `phase0/mod3/preview-pages-wip` and revisit in a later phase.

8. **Final state check:**
   ```bash
   git status --porcelain | grep admin
   git status --porcelain | grep -E '^\?\? client/src/components/admin/(tools|tours)/'
   git status --porcelain | grep -E '^\?\? client/src/pages/preview/'
   ```
   All three should print 0 lines after this module completes.

## Acceptance Criteria
- [ ] Every modified/untracked admin file is either in a commit or in a labelled stash
- [ ] `ToursTab.tsx` is NOT in any new commit (it's blocked by Phase 1 Cluster C)
- [ ] `pnpm tsc --noEmit` error count after the final commit ≤ Stage 1 baseline
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] `pnpm build` succeeds (catches any half-imported new tab)
- [ ] `git stash list | grep phase0/mod3` shows every deferred file with a clear label
- [ ] Visual smoke (post-commit, pre-push): admin panel still loads at every tab listed in `client/src/pages/Admin.tsx`

## Deliverable
- 0-3 commits (typical: 2). Plus up to 5 named stashes.
- Commit message subjects follow `feat(admin):` or `chore(admin):` Conventional Commits format.
- A `/tmp/phase0-mod3-decisions.txt` file recording the classification for each file, kept as audit trail.

## Rollback
- Per commit: `git reset HEAD~1` or `git revert <SHA>`.
- Per stash: `git stash pop stash@{N}` to restore.
- If Phase 1 later needs `ToursTab.tsx` baseline restored: `git stash apply phase0/mod3/tours-tab-wip` after `git status` is clean.

## Manual intervention
- **Jeff approves each classification in `/tmp/phase0-mod3-decisions.txt` before any `git add`.** AI must NOT auto-classify any admin file as `COMMIT-CLEAN` without Jeff yes/no — admin WIP is the highest-stakes Phase 0 bucket.
- **Jeff yes/no on `tools/`, `tours/`, `pages/preview/` untracked subtrees** — these were not in the audit and may be experimental.
- **Jeff explicitly confirms `ToursTab.tsx` stays uncommitted** so Phase 1 Cluster C can apply the authoritative tsc fix on a clean base.

## Test plan
- No new tests (Phase 0 is git hygiene).
- Existing admin tests must still pass: `pnpm test client/src/components/admin` (or full `pnpm test`).
- Smoke: open admin panel locally, click every left-nav tab listed in `client/src/pages/Admin.tsx`, verify each loads without console error. Especially check Dashboard, Departures, Reviews, Monitor tabs whose source files were modified.
