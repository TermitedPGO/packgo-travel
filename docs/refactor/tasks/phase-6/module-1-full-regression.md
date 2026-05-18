# Phase 6 · Module 1 · Full Regression Suite

**Parent plan:** docs/refactor/plan.md (Phase 6 · Final Verification + Smoke + Docs)
**Audit ref:** N/A (verification gate, not an audit item)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1 h AI + 0.5 h Jeff review
**Schedule slot:** Day 13 morning (before Module 2 smoke flow)

## Goal
Prove the refactor is behaviorally identical to pre-Phase-0 by running the full automated suite — `tsc --noEmit`, `vitest`, `vite build`, and (if configured) lint — and produce a single PASS/FAIL summary report. This is the entry gate for Module 2 (Jeff's manual smoke). If anything in this module fails, smoke does NOT start.

## Pre-requisites
- Phase 0 complete (clean `git status` at HEAD)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0; husky pre-commit hook live)
- Phase 2 complete (Stripe webhook idempotency table + transactions + tests landed and deployed)
- Phase 3 complete (FloatingOpsAgent / TodayOverview deletions landed)
- Phase 4A-4E complete (`server/routers.ts` ≤ 50 LOC composition shell; per-domain routers exist)
- Phase 5A complete (supplierSyncService split + tests)
- Phase 5B complete (ToursTab + AutonomousAgentsTab structural extraction)
- Current branch is the integration branch (or main) with all Phase 0-5 commits merged
- Working tree clean: `git status --short` returns 0 lines

## Inputs (read these before executing)
- `package.json` scripts — confirmed actual script names (single source of truth):
  - `pnpm check` → `tsc --noEmit`
  - `pnpm test` → `vitest run`
  - `pnpm build` → `vite build && esbuild server/_core/index.ts ... && esbuild server/scripts/sweep-place-aliases.ts ...`
  - **`pnpm lint` is NOT configured** as of this writing. If a lint script was added during Phase 0-5, run it; otherwise skip step 5 below and note "no lint script configured" in the report.
- `docs/refactor/plan.md` Phase 6 deliverable section — the source of the four green-light checks.
- `vitest.config.*` (if present at repo root) for any coverage configuration.
- Pre-Phase-0 baseline numbers (captured in Phase 0 Module 1 verification gate):
  - Baseline tsc errors: ~40 (Phase 1 brought this to 0)
  - Baseline `pnpm test` pass count: captured in `docs/refactor/progress.md` (Phase 0 row, Verification column)
  - Baseline `pnpm build` outcome: captured same place

## Procedure

1. **Confirm clean working tree:**
   ```bash
   cd /Users/jeff/Desktop/網站
   git status --short
   ```
   Must return 0 lines. If anything is uncommitted, STOP and escalate — Phase 6 cannot run on a dirty tree (would invalidate the regression result).

2. **Capture branch + commit SHA for the report:**
   ```bash
   git rev-parse --abbrev-ref HEAD > /tmp/phase6-mod1-branch.txt
   git rev-parse HEAD > /tmp/phase6-mod1-sha.txt
   echo "Verifying: $(cat /tmp/phase6-mod1-branch.txt) @ $(cat /tmp/phase6-mod1-sha.txt)"
   ```

3. **TypeScript check — `pnpm check`:**
   ```bash
   pnpm check 2>&1 | tee /tmp/phase6-mod1-tsc.log
   echo "tsc exit code: $?"
   ```
   - Acceptance: exit code 0, zero `error TS` lines in output.
   - If non-zero: STOP. Identify the offending file from the log. Determine which Phase introduced the regression (most likely Phase 4 sub-PR or Phase 5 split). Open a hotfix branch off the last green commit; revert the offending phase's last commit; re-run from step 1.

4. **Vitest full suite — `pnpm test`:**
   ```bash
   pnpm test 2>&1 | tee /tmp/phase6-mod1-vitest.log
   echo "vitest exit code: $?"
   ```
   - Acceptance: exit code 0. Test count must be ≥ (baseline pass count + 30) — the refactor added these new test files (approximate, exact count by phase):
     - Phase 2: ≥5 cases in `stripeWebhookIdempotency.test.ts` + ≥18 cases across `stripeWebhook.test.ts` handler families (bookings/refunds/subscriptions/visa)
     - Phase 4A: ≥4 happy-path cases (newsletter, favorites, browsingHistory, tours-read)
     - Phase 4B: ≥4 happy-path cases (analytics, audit, monitor, stats)
     - Phase 4C: ≥5 happy-path cases (inquiries, bookings-non-pay, departures, imageLibrary, homepage)
     - Phase 4D: ≥9 cases — happy + failure + idempotent-retry per money domain (bookings-pay × 3, vouchers × 3, packpoint × 3, accounting × 3)
     - Phase 4E: ≥5 happy-path cases across admin tools routers
     - Phase 5A: ≥3 supplierSync cases (happy / malformed-payload / date-string edge)
     - Phase 5B: ≥2 admin-tab helper cases
     - **Expected total new tests: ~50-60.** Note: the plan estimated "30-50" — the actual lower bound after Stage 3 task expansion is ~50.
   - If any test fails: capture the failing test name + the phase that introduced it (`grep -rn '<test name>' server client`); open hotfix branch off last green commit; revert the offending phase's commit; re-run from step 1.
   - If pass count is below baseline: a previously-passing test was deleted or skipped — STOP, find which Phase removed it via `git log --diff-filter=D -- '**/*.test.ts'`, escalate to supervisor.

5. **Build — `pnpm build`:**
   ```bash
   pnpm build 2>&1 | tee /tmp/phase6-mod1-build.log
   echo "build exit code: $?"
   ```
   - Acceptance: exit code 0. The build pipeline runs `vite build` (client) then two `esbuild` invocations (server + sweep-place-aliases script). All three must succeed.
   - Watch for: lazy-import warnings (often surface dead-code refs from Phase 3 deletions that grep missed); circular-import warnings from Phase 4 router split.
   - If failure: capture the error, identify file, revert the offending phase's commit, re-run from step 1.

6. **Lint (CONDITIONAL):**
   ```bash
   if grep -q '"lint"' package.json; then
     pnpm lint 2>&1 | tee /tmp/phase6-mod1-lint.log
     echo "lint exit code: $?"
   else
     echo "no lint script configured — skipping (consistent with package.json at plan time)" | tee /tmp/phase6-mod1-lint.log
   fi
   ```
   - Acceptance: either exit code 0, or the "no lint script" note. Do NOT add a lint script in this module — that's a v2 task.

7. **Coverage spot-check on money paths (advisory, not gating):**
   ```bash
   pnpm test --coverage 2>&1 | tee /tmp/phase6-mod1-coverage.log || echo "coverage flag not configured — skipping"
   ```
   - If `vitest --coverage` works, inspect the coverage report for these files and confirm money-path files are ≥80% covered:
     - `server/_core/stripeWebhook.ts`
     - `server/_core/stripeWebhookIdempotency.ts`
     - `server/routers/bookingsPayment.ts` (or `bookings.ts` if not split)
     - `server/routers/vouchers.ts`
     - `server/routers/packpoint.ts`
     - `server/routers/accounting.ts`
   - If below 80% on any money file: NOT a Module 1 blocker, but flag in the report for follow-up in v2 (or hotfix during Phase 6 Module 3 if time permits).
   - If `vitest --coverage` is not configured: skip and note "coverage report not configured — verify by code review during Module 2 smoke".

8. **Write the regression report `docs/refactor/phase-6-regression-report.md`** (≤120 lines) with this structure:
   ```markdown
   # Phase 6 · Module 1 · Regression Report

   **Date:** <YYYY-MM-DD>
   **Branch:** <from /tmp/phase6-mod1-branch.txt>
   **Commit SHA:** <from /tmp/phase6-mod1-sha.txt>
   **Total runtime:** <sum of step 3-6 wall clock>

   ## Results

   | Check | Command | Exit | Result |
   |---|---|---|---|
   | TypeScript | `pnpm check` | 0 | PASS — zero errors |
   | Vitest | `pnpm test` | 0 | PASS — <N> tests pass (<delta from baseline>) |
   | Build | `pnpm build` | 0 | PASS — client + server + scripts bundled |
   | Lint | `pnpm lint` | N/A | SKIP (not configured) |

   ## Test count breakdown

   | Phase | New test files | New test cases |
   |---|---|---|
   | 2 (Stripe webhook) | stripeWebhookIdempotency.test.ts + stripeWebhook.test.ts | ~23 |
   | 4A-4E (routers split) | <N> files × happy-path + 9 money-path | ~27 |
   | 5A (supplierSync) | supplierSync.test.ts | ~3 |
   | 5B (admin tabs) | helpers.test.ts | ~2 |
   | **Total new** |  | **~55** |

   ## Money-path coverage spot-check

   | File | Coverage | Status |
   |---|---|---|
   | server/_core/stripeWebhook.ts | <N%> | <PASS ≥80% / FLAG <80%> |
   | server/_core/stripeWebhookIdempotency.ts | <N%> | <…> |
   | server/routers/bookingsPayment.ts | <N%> | <…> |
   | server/routers/vouchers.ts | <N%> | <…> |
   | server/routers/packpoint.ts | <N%> | <…> |
   | server/routers/accounting.ts | <N%> | <…> |

   ## Verdict
   **<PASS — proceed to Module 2 smoke checklist | FAIL — see Blockers below>**

   ## Blockers (if FAIL)
   - <file>:<line> — <one-line description> — likely from Phase <N> commit <SHA>
   - Rollback action: `git revert <SHA>`; re-run Module 1 from step 1.
   ```

9. **Update `docs/refactor/progress.md`** Phase 6 / Module 1 row with PASS/FAIL + report link. If FAIL, set Module 2 status to BLOCKED.

## Acceptance Criteria
- [ ] `git status --short` returns 0 lines before any check runs
- [ ] `pnpm check` exit 0; zero `error TS` lines in log
- [ ] `pnpm test` exit 0; pass count ≥ (baseline + 30) and equals expected ~50-60 new cases
- [ ] `pnpm build` exit 0; client + server + sweep-place-aliases script all bundle
- [ ] Lint either passes or is documented as "not configured"
- [ ] Coverage spot-check report written for the 6 money-path files (advisory, not gating)
- [ ] `docs/refactor/phase-6-regression-report.md` exists, structured per step 8
- [ ] `docs/refactor/progress.md` Phase 6 / Module 1 row updated
- [ ] No `/tmp/phase6-mod1-*.log` files left behind that contain secrets (Stripe keys, DB creds) — review and rm if any leaked

## Deliverable
- New: `docs/refactor/phase-6-regression-report.md`
- Modified: `docs/refactor/progress.md` (Phase 6 Module 1 row)
- Single commit (no code changes, docs only):
  ```
  docs(refactor): Phase 6 module 1 — full regression report

  - pnpm check: 0 errors
  - pnpm test: <N> pass (+<delta> from baseline)
  - pnpm build: success
  - Coverage spot-check on 6 money-path files included.

  Verdict: PASS — Module 2 smoke checklist unblocked.
  ```

## Rollback
- This module is verification-only — no rollback needed for the module itself.
- If a check FAILS, rollback applies to the offending **earlier phase**, not Module 1:
  - tsc failure → revert latest commit of the phase that introduced the type drift (most likely Phase 4 or 5)
  - Vitest failure → revert the commit that added/changed the failing test or the production code path it covers
  - Build failure → revert latest Phase 3/4 commit (most likely a dangling import from a deletion or router split)
- Always re-run Module 1 from step 1 after any rollback.

## Manual intervention
- **Jeff:** review the final regression report before Module 2 starts. Spot-check the test count breakdown (does it match memory of which phases added tests?). Approve the PASS verdict in writing (`progress.md` update is sufficient).
- **Supervisor (not Jeff):** all the bash command execution.

## Test plan
- This module IS the test plan for the refactor as a whole. The test plan for this module itself:
  1. Run all 6 steps in order against the integration branch.
  2. Confirm exit codes match the table in step 8.
  3. Confirm the report file exists and is well-formed (the markdown verdict line says PASS or FAIL — no ambiguity).
- Dry-run verification (optional, before Day 13): run steps 3-5 on the latest commit during Phase 5 close to confirm tests/build are still green; this catches issues a day early.
