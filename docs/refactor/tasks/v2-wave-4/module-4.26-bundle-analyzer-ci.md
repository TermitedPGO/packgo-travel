# v2 · Wave 4 · Module 4.26 — Bundle analyzer + 500 KB chunk-size CI gate

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish — combines audit §H line 494)
**Audit ref:** v2-audit-2026-05-19.md §H (bundle sizes — Admin.js 990 KB, index 884 KB, TourRouteMapCanvas 798 KB, etc.)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3 h AI + 15 min Jeff review
**Deploy window:** any time — CI-only

## Goal

Add `rollup-plugin-visualizer` for human-readable bundle reports + a CI gate that fails any PR producing a chunk > 500 KB. The gate prevents regressions of Wave 1 Module 1.5's Admin code-split + Wave 2 Module 2.2's TourDetailPeony split.

## Pre-requisites

- Wave 1 Module 1.5 (Admin code-split) merged — Admin chunks should be <200 KB each now.
- Wave 2 Module 2.2 (TourDetailPeony split) merged — Tour chunks ≤600 KB.
- Module 4.6 (Lighthouse) merged — sibling perf gate.

## Inputs (read these before executing)

- `vite.config.ts` — current build config.
- Current bundle sizes:
  ```bash
  pnpm build && ls -lS dist/public/assets/*.js
  ```

## Scope (what this module owns)

- ✅ `package.json` — add `rollup-plugin-visualizer`.
- ✅ `vite.config.ts` — register visualizer plugin in `build` mode.
- ✅ `scripts/check-bundle-size.mjs` — CI script: read `dist/public/assets/*.js` sizes, fail if any >500 KB.
- ✅ `.github/workflows/bundle-size.yml` — run on PRs.
- ✅ `package.json` script `bundle:check`.
- ❌ NOT in scope: refactoring chunks that are already over 500 KB (separate task; recommend deferring to v3 if any remain).

## Procedure

1. **Install:**
   ```bash
   pnpm add -D rollup-plugin-visualizer
   ```

2. **Edit `vite.config.ts`:**
   ```ts
   import { visualizer } from 'rollup-plugin-visualizer';
   // Inside defineConfig({ plugins: [..., 
   visualizer({
     filename: 'dist/bundle-analysis.html',
     gzipSize: true,
     brotliSize: true,
     open: false,
     template: 'treemap',
   }),
   ```

3. **`scripts/check-bundle-size.mjs`:**
   ```js
   #!/usr/bin/env node
   import { readdirSync, statSync } from 'node:fs';
   import { join } from 'node:path';

   const DIST_DIR = 'dist/public/assets';
   const MAX_BYTES = 500 * 1024; // 500 KB
   const ALLOWLIST = new Set([
     // Add filenames here if Jeff intentionally permits a > 500KB chunk
     // (e.g., TourRouteMapCanvas-*.js if Wave 2 didn't fully split it).
   ]);

   const files = readdirSync(DIST_DIR).filter((f) => f.endsWith('.js'));
   const oversized = [];
   for (const f of files) {
     const size = statSync(join(DIST_DIR, f)).size;
     if (size > MAX_BYTES && !ALLOWLIST.has(f)) {
       oversized.push({ file: f, sizeKB: Math.round(size / 1024) });
     }
   }
   if (oversized.length > 0) {
     console.error('❌ Bundle size gate FAILED. Chunks over 500 KB:');
     for (const o of oversized) console.error(`  ${o.file}: ${o.sizeKB} KB`);
     console.error('\nFix by code-splitting via React.lazy() or addressing in v3.');
     process.exit(1);
   }
   console.log('✅ All chunks ≤ 500 KB.');
   ```

4. **`.github/workflows/bundle-size.yml`:**
   ```yaml
   name: Bundle Size Gate
   on:
     pull_request: { branches: [main] }
   jobs:
     bundle:
       runs-on: ubuntu-latest
       timeout-minutes: 10
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v2
           with: { version: 9 }
         - uses: actions/setup-node@v4
           with: { node-version: 20, cache: 'pnpm' }
         - run: pnpm install --frozen-lockfile
         - run: pnpm build
         - run: node scripts/check-bundle-size.mjs
         - uses: actions/upload-artifact@v4
           if: always()
           with: { name: bundle-analysis, path: dist/bundle-analysis.html }
   ```

5. **`package.json` scripts:**
   ```json
   "bundle:check": "node scripts/check-bundle-size.mjs",
   "bundle:analyze": "pnpm build && open dist/bundle-analysis.html"
   ```

6. **First run locally:**
   ```bash
   pnpm build
   node scripts/check-bundle-size.mjs
   ```
   If any chunk exceeds 500 KB despite Wave 1 + Wave 2 splits, either:
   - Add to `ALLOWLIST` (with TODO comment).
   - File follow-up task to split that chunk.

## Acceptance Criteria

- [ ] `rollup-plugin-visualizer` in package.json devDependencies.
- [ ] `vite.config.ts` registers visualizer plugin.
- [ ] `dist/bundle-analysis.html` generated after `pnpm build`.
- [ ] `scripts/check-bundle-size.mjs` exists with 500 KB threshold.
- [ ] `.github/workflows/bundle-size.yml` runs on PRs.
- [ ] First CI run on this module's PR: green (assuming Wave 1 + Wave 2 splits hold).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` count unchanged.

## Deliverable

- New: `scripts/check-bundle-size.mjs`, `.github/workflows/bundle-size.yml`
- Modified: `vite.config.ts`, `package.json`, `pnpm-lock.yaml`

**Commit message:**

```
chore(perf): Wave 4 module 4.26 — bundle size CI gate (500 KB max)

- rollup-plugin-visualizer produces dist/bundle-analysis.html on every build
- scripts/check-bundle-size.mjs fails CI if any chunk > 500 KB
- bundle-analysis.html uploaded as PR artifact for inspection
- ALLOWLIST escape hatch for intentional exceptions (currently empty)

Hardens Wave 1 Module 1.5 (Admin code-split) + Wave 2 Module 2.2
(TourDetailPeony split) against future regression.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.26, audit §H lines 438-456
```

## Rollback

- Single revert removes plugin + script + workflow. No runtime impact.

## Manual intervention

- **Jeff (~5 min):** check `dist/bundle-analysis.html` post-first-build to validate the treemap is useful.

## Test plan

**No Vitest** — config + script change.

**Manual smoke:** `pnpm build && pnpm bundle:check` exit 0.

**Regression anchor:** `pnpm test` count unchanged.

## Decisions needed (Jeff)

1. **Threshold value (500 KB)** — plan-locked. Current biggest chunks pre-fix are ~990 KB; after Wave 1/2 should be <500. Confirm.
2. **ALLOWLIST scope** — recommend keep empty; force every exception to be a discussed v3 task.
3. **Bundle analysis report visibility** — current uploads as PR artifact. Alternative: deploy `dist/bundle-analysis.html` to a public URL per PR. Recommend artifact for v2.
