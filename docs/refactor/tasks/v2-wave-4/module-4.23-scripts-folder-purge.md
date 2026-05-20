# v2 · Wave 4 · Module 4.23 — `scripts/` folder purge (102 mjs files → archive)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.26)
**Audit ref:** v2-audit-2026-05-19.md §K lines 669-679 (102 ad-hoc scripts in `scripts/`; ~30 candidates for archive/delete)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 30 min Jeff review (final triage decisions)
**Deploy window:** any time — repo hygiene; no runtime impact

## Goal

Reduce `scripts/` from 102 files to ~50 by:

- **Archive** ~30 one-shot mjs files (`fix-*`, `japan-sept-*`, completed migrations) to `scripts/_archive/2026-Q2/`.
- **Delete** stale `apply-migration-0033/4/5.mjs` (3 files — those migrations are in `drizzle/` already) and `wipe-all-tours.mjs` (replaced by admin procedure).
- **Promote** a few to admin endpoints (`i18n-audit.mjs`, `mobile-audit.mjs`, `inspect-recent-tours.mjs`, `llm_dashboard.mjs`) — per audit §K line 698 P2.
- **Document** what's left.

## Pre-requisites

- All prior Wave 4 modules merged.
- `git status` clean before starting.

## Inputs (read these before executing)

- `scripts/` directory full listing.
- Audit §K lines 669-680 for category breakdown.

## Scope (what this module owns)

- ✅ Move ~30 scripts to `scripts/_archive/2026-Q2/`.
- ✅ Delete 4 stale/dangerous scripts.
- ✅ Promote `i18n-audit.mjs` (Module 4.18 dep — keep at root since CI uses it; consider relocating to `scripts/lib/` for organization).
- ✅ Inventory remaining scripts in `scripts/README.md`.
- ❌ NOT in scope: promoting scripts to admin endpoints (defer to v3 per audit §K line 698); Module 4.27 (stash decision — separate module).

## Procedure

1. **Run `ls scripts/`** — full inventory.

2. **Categorize each file:**
   - **Archive** (move to `scripts/_archive/2026-Q2/`):
     - All `fix-*` files (`fix-category.mjs`, `fix-color-theme.mjs`, `fix-flights.mjs`, `fix-router.py`, `fix-taiwan-tour-*.mjs` × 4, `fix-tour-data.mjs`, `fix-train-name.mjs`)
     - All `japan-sept-*` files
     - `r67-*` file
     - Any `cleanup-*`, `purge-*`, `backfill-*` files that have run already
     - `add-departures.mjs`, `add-feature-images.mjs`, `add-hotel-details.mjs`, `add-itinerary-images.mjs`, `add-meal-details.mjs`, `add-meal-images.mjs` (one-shot data backfills)
     - Cached PNG files in `scripts/` (e.g., `basemap-switzerland.png`, `basemap-switzerland-v2.png`) — move to `scripts/_archive/test-fixtures/`
   - **Delete:**
     - `apply-migration-0033.mjs`, `apply-migration-0034.mjs`, `apply-migration-0035.mjs` (migrations already in `drizzle/`)
     - `wipe-all-tours.mjs` (dangerous; replace usage via admin procedure if needed)
     - Any obviously-broken or duplicate scripts
   - **Keep** (remain in `scripts/`):
     - `i18n-audit.mjs` (used by CI / Module 4.18)
     - `mobile-audit.mjs` (referenced by audit)
     - `inspect-recent-tours.mjs` (Jeff diagnostic tool)
     - `llm_dashboard.mjs` (diagnostic)
     - `lighthouse-pwa-check.mjs` (Module 4.6)
     - Build/release-related (if any)

3. **Create `scripts/_archive/2026-Q2/README.md`** explaining what's archived:
   ```markdown
   # scripts/_archive/2026-Q2/

   One-shot data backfills, fix-up scripts, and stale migration helpers
   archived 2026-05-19 per docs/refactor/v2-plan.md Module 4.23.

   Each file ran once against prod data; preserved for audit trail only.
   None are safe to re-run. If you find yourself reaching for one of these,
   that's a signal to write a proper admin procedure instead.
   ```

4. **Update `scripts/README.md`** (or create) — list the remaining scripts + their purpose:
   ```markdown
   # scripts/

   Active maintenance scripts. One-shot scripts archived to scripts/_archive/.

   ## Audit / diagnostics
   - i18n-audit.mjs — leak count + breakdown (run via `node scripts/i18n-audit.mjs --json`)
   - mobile-audit.mjs — responsive-design coverage report
   - inspect-recent-tours.mjs — last N tours summary
   - llm_dashboard.mjs — LLM call log dashboard

   ## CI / build
   - lighthouse-pwa-check.mjs — local Lighthouse PWA gate (Module 4.6)

   ## Conventions
   - One-shot scripts → archive immediately after first run.
   - Recurring scripts → promote to admin procedure or cron worker.
   - Dangerous scripts (wipes, purges) → admin procedure ONLY; never CLI.
   ```

5. **Verify nothing references the archived files:**
   ```bash
   for f in $(ls scripts/_archive/2026-Q2/); do
     grep -rn "$f" . --exclude-dir=node_modules --exclude-dir=scripts | head -3
   done
   ```
   If a `package.json` script or CI workflow references an archived file, leave it in place (or update reference).

6. **`git status` confirms ~30 moves + 4 deletes** — supervisor commits as single hygiene-only commit.

## Acceptance Criteria

- [ ] `ls scripts/*.mjs scripts/*.ts | wc -l` ≤55 (down from 102).
- [ ] `scripts/_archive/2026-Q2/` contains the archived files + a README.
- [ ] `scripts/README.md` documents the remaining active scripts.
- [ ] Deleted files: `apply-migration-0033.mjs`, `apply-migration-0034.mjs`, `apply-migration-0035.mjs`, `wipe-all-tours.mjs`.
- [ ] Cached image fixtures (basemap PNGs) moved to `scripts/_archive/test-fixtures/`.
- [ ] No CI / `package.json` script references a removed file (broken reference would fail builds).
- [ ] `pnpm build` succeeds.
- [ ] `pnpm test` green.
- [ ] No regression in existing test count.

## Deliverable

- Moved: ~30 files to `scripts/_archive/2026-Q2/` + cached PNGs to `scripts/_archive/test-fixtures/`.
- Deleted: 4 files.
- New: `scripts/_archive/2026-Q2/README.md`, `scripts/README.md`.

**Commit message:**

```
chore(scripts): Wave 4 module 4.23 — archive 30 one-shot scripts + delete 4 stale

- Archived to scripts/_archive/2026-Q2/:
  fix-* (8 files), japan-sept-* (3 files), add-* data backfills (6 files),
  r67-*, plus misc one-shot mjs
- Cached PNG fixtures (basemap-*) moved to scripts/_archive/test-fixtures/
- Deleted: apply-migration-0033/0034/0035.mjs (already in drizzle/),
  wipe-all-tours.mjs (replace via admin procedure)
- scripts/README.md inventories remaining active scripts
- No CI / package.json references broken

scripts/*.mjs count: 102 → ~50

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.23, audit §K
```

## Rollback

- Single revert restores moves + deletions (git move preserves content).
- Truly deleted files (the 4 stale ones) recoverable via git history.

## Manual intervention

- **Jeff (~20 min):** review the archive list before commit. Flag any script Jeff wants to keep active (e.g., he runs `inspect-recent-tours.mjs` weekly — confirm it stays in `scripts/`).
- **Jeff (~5 min):** decide on `i18n-audit.mjs` relocation — keep in `scripts/` (CI deps on path) vs move to `scripts/lib/`. Recommend keep.

## Test plan

**No Vitest** — file moves and deletions; no behavior.

**Manual smoke:**
- `pnpm build` succeeds.
- `pnpm test` succeeds.
- CI workflow `lighthouse.yml` (Module 4.6) and `playwright.yml` (Module 4.16) still work.
- `node scripts/i18n-audit.mjs --json` still produces output (Module 4.18 dep).

## Decisions needed (Jeff)

1. **Final archive list** — supervisor presents 30-file candidate list; Jeff approves or moves items to "keep". 20 min.
2. **Promotion vs archive for diagnostics** — `i18n-audit.mjs`, `inspect-recent-tours.mjs`, `llm_dashboard.mjs`, `mobile-audit.mjs` — keep in scripts/ (current recommend) vs promote to admin procedure (v3). Lock for v2 = keep.
3. **`wipe-all-tours.mjs` replacement** — confirm Jeff is OK deleting; if needed, the admin Tours tab can have a "Delete All" mutation (with strong confirmation UX). Defer to v3 if Jeff wants explicit replacement.
