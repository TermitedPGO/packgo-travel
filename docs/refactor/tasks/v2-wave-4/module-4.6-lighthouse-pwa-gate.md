# v2 · Wave 4 · Module 4.6 — Lighthouse PWA CI gate (score ≥ 90)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Domain L1 — Customer PWA, §Module 4.5)
**Audit ref:** v2-audit-2026-05-19.md §L (Mobile, NEW domain) + §H (perf — Lighthouse perf score also gated)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4 h AI + 15 min Jeff review (CI config + baseline approval)
**Deploy window:** any time — CI-only; no runtime impact

## Goal

Add a CI step that runs Lighthouse against the post-merge staging deploy URL and fails the merge if PWA score < 90 OR performance score < 70 (per v2-plan thresholds). The gate prevents Modules 4.1-4.5's PWA work from silently regressing as future commits land.

## Pre-requisites

- **Modules 4.1-4.5 merged** — the gate has nothing to enforce until manifest/SW/install prompt are in place.
- A staging URL accessible from CI runners (existing Fly staging app should suffice; if not, escalate).
- CI platform identified — check `.github/workflows/` for existing CI; if none, the gate runs locally via `pnpm lighthouse` and Jeff manually checks pre-deploy (escalate to Jeff if no GitHub Actions exists).

## Inputs (read these before executing)

- `.github/workflows/` — confirm existing CI structure. Look for: `tsc-check.yml` or similar from husky/CI integration (Wave 1 may have added one).
- `package.json` — check existing scripts; we'll add `lighthouse:ci`.
- `fly.toml` — staging app name (likely `packgo-staging`); we need its accessible URL.
- Wave 1 Module 1.5 result — Admin code-split should already drop Admin.js to <200 KB; that helps the perf score but isn't directly assessed here (customer pages only).

## Scope (what this module owns)

- ✅ `package.json` — add `lighthouse` + `@lhci/cli` as `devDependencies`; add `lighthouse:ci` script.
- ✅ `.lighthouserc.json` (or `lighthouserc.cjs`) — config file: thresholds + URLs to test.
- ✅ `.github/workflows/lighthouse.yml` — new workflow on `pull_request` → main, blocking.
- ✅ `scripts/lighthouse-pwa-check.mjs` — local-dev convenience wrapper (matches v2-plan's referenced file).
- ❌ NOT in scope: actually fixing what Lighthouse complains about (perf fixes live in Modules 4.19 lazy-load, 4.22 dashboard tile, etc.); changing the SW or manifest (Modules 4.1-4.2 own).

## Procedure

1. **Read existing CI config.** Inventory existing GitHub Actions workflows. Note conventions (PNPM setup pattern, Node version, secrets).

2. **Install deps:**
   ```bash
   pnpm add -D lighthouse @lhci/cli
   ```

3. **Create `.lighthouserc.json` at repo root:**
   ```json
   {
     "ci": {
       "collect": {
         "url": [
           "https://packgo-staging.fly.dev/",
           "https://packgo-staging.fly.dev/tours",
           "https://packgo-staging.fly.dev/tours/sample-slug"
         ],
         "numberOfRuns": 3,
         "settings": {
           "preset": "desktop",
           "skipAudits": ["uses-http2"]
         }
       },
       "assert": {
         "assertions": {
           "categories:pwa": ["error", {"minScore": 0.9}],
           "categories:performance": ["error", {"minScore": 0.7}],
           "categories:accessibility": ["warn", {"minScore": 0.85}],
           "categories:best-practices": ["warn", {"minScore": 0.85}],
           "categories:seo": ["warn", {"minScore": 0.9}]
         }
       },
       "upload": {
         "target": "temporary-public-storage"
       }
     }
   }
   ```

   **Notes:**
   - `numberOfRuns: 3` averages — single-run variance can sink a borderline PR.
   - PWA + perf are `error` (block); a11y/best-practices/seo are `warn` (visible but non-blocking, Jeff can promote to error in v3).
   - `temporary-public-storage` posts results to a public Lighthouse CI temp URL — Jeff sees the full report on each PR.
   - `skipAudits: ["uses-http2"]` because Fly's edge speaks h2 but Lighthouse over the wire may misdetect.

4. **Add `package.json` scripts:**
   ```json
   {
     "scripts": {
       "lighthouse:ci": "lhci autorun",
       "lighthouse:local": "node scripts/lighthouse-pwa-check.mjs"
     }
   }
   ```

5. **Create `scripts/lighthouse-pwa-check.mjs` (local dev convenience):**
   ```js
   #!/usr/bin/env node
   /**
    * Local-dev wrapper for Lighthouse PWA check.
    * Builds the production bundle, serves it on a temp port, runs Lighthouse,
    * prints score. Use before pushing for fast feedback.
    *
    * Usage: pnpm lighthouse:local
    */
   import { execSync } from 'node:child_process';
   import { spawn } from 'node:child_process';
   import lighthouse from 'lighthouse';
   import { launch } from 'chrome-launcher';

   const PORT = 4173;
   console.log('Building...');
   execSync('pnpm build', { stdio: 'inherit' });

   console.log(`Serving on http://localhost:${PORT}`);
   const server = spawn('pnpm', ['preview', '--port', String(PORT)], { stdio: 'pipe' });
   await new Promise((r) => setTimeout(r, 3000));

   const chrome = await launch({ chromeFlags: ['--headless'] });
   const runnerResult = await lighthouse(`http://localhost:${PORT}`, {
     port: chrome.port,
     onlyCategories: ['pwa', 'performance'],
   });

   const pwaScore = runnerResult.lhr.categories.pwa.score;
   const perfScore = runnerResult.lhr.categories.performance.score;

   await chrome.kill();
   server.kill();

   console.log(`\nPWA score: ${Math.round(pwaScore * 100)}/100 (gate: ≥90)`);
   console.log(`Performance score: ${Math.round(perfScore * 100)}/100 (gate: ≥70)`);

   if (pwaScore < 0.9 || perfScore < 0.7) {
     console.error('\n❌ Gate FAILED. See full report at:');
     console.error(runnerResult.report);
     process.exit(1);
   }
   console.log('\n✅ Gates passed.');
   ```

6. **`.github/workflows/lighthouse.yml`:**
   ```yaml
   name: Lighthouse PWA Gate
   on:
     pull_request:
       branches: [main]
     workflow_dispatch:

   jobs:
     lighthouse:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v2
           with:
             version: 9
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: 'pnpm'
         - run: pnpm install --frozen-lockfile
         # Wait for Fly auto-deploy of the PR branch to staging (assumes preview-deploy
         # is set up; if not, this step deploys via fly CLI).
         - name: Wait for staging deploy
           run: |
             echo "Waiting for staging at https://packgo-staging.fly.dev/ ..."
             for i in {1..30}; do
               curl -sf -o /dev/null https://packgo-staging.fly.dev/ && break
               sleep 10
             done
         - run: pnpm lighthouse:ci
           env:
             LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
   ```

   **Adjustments:** if `LHCI_GITHUB_APP_TOKEN` isn't set up, remove that env line; LHCI falls back to `temporary-public-storage`. The token only adds PR-comment integration.

7. **Smoke locally:**
   ```bash
   pnpm lighthouse:local
   ```
   Verify the script prints scores and exits 0 (assuming Modules 4.1-4.5 work landed). If scores fail, the diagnostic is the lighthouse report URL printed at the end.

8. **First CI run:**
   - Push this module's branch.
   - Verify the workflow runs in the PR view.
   - Click the LHCI temp-storage link to inspect the full report.

## Acceptance Criteria

- [ ] `package.json` has `lighthouse:ci` and `lighthouse:local` scripts.
- [ ] `.lighthouserc.json` exists at repo root with PWA ≥ 0.9 and perf ≥ 0.7 assertions.
- [ ] `scripts/lighthouse-pwa-check.mjs` exists and runs `pnpm lighthouse:local` succeeds locally.
- [ ] `.github/workflows/lighthouse.yml` exists and is triggered by PRs to main.
- [ ] First CI run on this module's PR passes (proves the staging URL is reachable and scores meet thresholds).
- [ ] If staging scores are below thresholds, Jeff is alerted with the LHCI report link and the gate is set to `warn` temporarily; mod 4.6 ships, and a follow-up task is filed for the score fix.
- [ ] No code changes outside CI config files.
- [ ] Existing `pnpm test` count unchanged (no Vitest impact).

## Deliverable

- New: `.lighthouserc.json`, `.github/workflows/lighthouse.yml`, `scripts/lighthouse-pwa-check.mjs`
- Modified: `package.json`, `pnpm-lock.yaml`

**Commit message:**

```
chore(ci): Wave 4 module 4.6 — Lighthouse PWA gate (≥90) + perf (≥70)

- LHCI runs on every PR to main against staging URL
- 3 URLs tested: home, /tours list, sample /tours/:slug
- 3 runs averaged to reduce variance
- Blocking: pwa score < 0.9 OR perf score < 0.7
- Warning: a11y < 0.85, best-practices < 0.85, seo < 0.9
- Local convenience: `pnpm lighthouse:local` builds + serves + checks

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.6
```

## Rollback

- Single revert removes CI workflow + config + script + deps. Zero runtime impact.
- If a future PR fails the gate and Jeff needs to ship anyway: temporarily move PWA assertion from `error` to `warn` in `.lighthouserc.json` and re-run.
- Test pass count unchanged.

## Manual intervention

- **Jeff:** approve the threshold values — PWA ≥ 90 is plan-locked; perf ≥ 70 is plan-locked. If first run is below thresholds, decide whether to ship Module 4.6 with `warn` and file a perf fix task, or block until threshold met — 10 min.
- **Jeff:** verify staging URL is the right one to test against; if there's a separate "preview deploy per PR" Fly app, the workflow URL needs updating — 2 min.
- **Jeff (optional):** install Lighthouse CI GitHub App on the repo for richer PR comments — 5 min.

## Test plan

**No Vitest** — CI config has no executable code to test.

**Manual smoke:**

1. `pnpm lighthouse:local` (after Modules 4.1-4.5 landed) — verify scores ≥ thresholds locally. If not, file follow-up tasks for the failing audits.
2. Push this module's branch → verify GitHub Actions workflow runs.
3. Inspect the LHCI temp report link printed in the workflow logs → confirm 3 URLs tested + scores rendered.
4. Intentionally break the SW (e.g., temporarily disable `vite-plugin-pwa` in `vite.config.ts`) on a test branch → push → confirm the gate fails (PWA score drops below 90 without SW registered).

**Regression anchor:** `pnpm test` count unchanged.

## Decisions needed (Jeff)

1. **PWA threshold (90)** — plan-locked. If Wave 4 lands and prod scores 88-89, Jeff may want to relax to 85 short-term. Recommend: ship at 90, file follow-up tasks if borderline.
2. **Perf threshold (70)** — plan-locked. Current production likely scores 60-75 on customer pages (TourDetailPeony has been heavy pre-split). If 70 blocks the first CI run, ship Module 4.6 with `warn` on perf and lift to `error` after Modules 4.19 (lazy-load) + 4.22 (bundle analyzer) land.
3. **Staging URL** — assumed `packgo-staging.fly.dev`. Confirm or supply the correct URL.
4. **PR-comment richness (LHCI GitHub App)** — optional install for inline PR comments showing score diffs. Recommend: skip for v2 (logs link is enough); revisit in v3.
5. **`numberOfRuns: 3`** — 3 is a compromise between accuracy and CI time (~5 min per run × 3 × 3 URLs ≈ 45 min). If CI time becomes painful, drop to 2.
