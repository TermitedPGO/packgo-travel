# Phase 1 · Module 5 · Husky Pre-Commit tsc Hook

**Parent plan:** docs/refactor/plan.md (Phase 1 · tsc Error Cleanup)
**Audit ref:** P0-3 (recommendation (d): "add a `tsc --noEmit` gate to a pre-commit hook")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 0.4 h AI + 0.2 h Jeff review

## Goal
Install husky + add a pre-commit hook that runs `pnpm tsc --noEmit` and blocks commits if any tsc error exists. This is the regression anchor that prevents the 40-errors-in-codebase situation from recurring after modules 1-4 land it at 0.

## Pre-requisites
- **Modules 1-4 MUST be merged first.** Hook only makes sense once tsc is at 0 — installing it before would block all Phase 1 fix commits themselves.
- Phase 0 complete.
- `pnpm tsc --noEmit` exit 0 (verified before this module starts).
- Audit Note (P0-3): "we already have husky" — verify this is current. If not present, this module installs it from scratch.

## Inputs (read these before executing)
- `package.json` — check for existing `"husky"` devDependency and any `"prepare"` script.
- Verify state:
  ```bash
  grep -E '"husky"|"prepare"' /Users/jeff/Desktop/網站/package.json
  ls -la /Users/jeff/Desktop/網站/.husky/ 2>&1
  ```
  Current state (as of plan time): **no .husky/ directory**, **no husky in package.json**. Audit's claim "we already have husky" appears stale. Treat this module as a fresh install.

## Procedure
1. **Confirm tsc baseline is 0** (sanity gate — do not proceed if any cluster module didn't finish):
   ```bash
   cd /Users/jeff/Desktop/網站
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit 2>&1 | grep -cE "error TS"
   ```
   Expected: **0**. If non-zero, ESCALATE — modules 1-4 didn't all complete.

2. **Install husky:**
   ```bash
   pnpm add -D husky
   ```
   This adds husky to devDependencies. Sub-agent has dependency-add authority only if supervisor pre-approves; otherwise supervisor lands this install as a precursor commit.

3. **Initialize husky** (creates `.husky/` directory + adds `prepare` script to package.json):
   ```bash
   pnpm exec husky init
   ```
   This step creates `.husky/pre-commit` with a default `pnpm test` line — we'll replace that.

4. **Verify the install:**
   ```bash
   ls -la /Users/jeff/Desktop/網站/.husky/
   grep '"prepare"' /Users/jeff/Desktop/網站/package.json
   ```
   Expected: `.husky/pre-commit` file exists; `"prepare": "husky"` in scripts.

5. **Write the pre-commit hook.** Replace contents of `.husky/pre-commit` with:
   ```bash
   #!/usr/bin/env sh
   # PACK&GO pre-commit hook
   # Enforces CLAUDE.md §九 red-line: "tsc must pass before commit"
   # Installed: docs/refactor/plan.md Phase 1 · Module 5

   echo "🔍 Running tsc --noEmit (Phase 1 regression anchor)..."
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
   TSC_EXIT=$?

   if [ $TSC_EXIT -ne 0 ]; then
     echo ""
     echo "❌ tsc errors detected — commit blocked."
     echo "   Run 'pnpm tsc --noEmit' to see the errors, fix them, then re-commit."
     echo "   To bypass in emergencies (NOT recommended): git commit --no-verify"
     exit 1
   fi

   echo "✅ tsc clean — commit proceeding."
   ```

6. **Make it executable:**
   ```bash
   chmod +x /Users/jeff/Desktop/網站/.husky/pre-commit
   ```

7. **Smoke-test the hook end-to-end** (negative test then positive test):
   ```bash
   # Negative test: introduce a deliberate tsc error temporarily
   echo "const x: number = 'string';" >> /tmp/hook-test.ts
   cp /tmp/hook-test.ts client/src/_hook_test_temp.ts
   git add client/src/_hook_test_temp.ts
   git commit -m "test: trigger hook" 2>&1 | tail -5
   # Expected: commit BLOCKED with "tsc errors detected"
   # Cleanup:
   git reset HEAD client/src/_hook_test_temp.ts
   rm client/src/_hook_test_temp.ts
   ```

   ```bash
   # Positive test: clean commit must succeed
   echo "// hook positive test" > /tmp/hook-positive.txt
   touch /tmp/.touch-for-test
   # Make a trivial harmless change — e.g. add a newline to a doc
   git diff --quiet || echo "WARN: working tree dirty; supervisor must verify cleanly"
   # If clean, supervisor can confirm hook activates on next real commit
   ```

   **Note:** Sub-agent must NOT leave test artifacts in the repo. Clean up `client/src/_hook_test_temp.ts` before finalizing.

8. **Update `.gitignore` if needed** — `.husky/_/` (husky's internal scripts dir) might want to be ignored, but modern husky (v9+) handles this via npm pack. Verify:
   ```bash
   grep -E "^\.husky/_" /Users/jeff/Desktop/網站/.gitignore || echo "no entry"
   ```
   If husky v9+ is installed (default with `pnpm exec husky init` today), no .gitignore change needed. If husky v8, add `.husky/_` to .gitignore.

9. **Document the hook in CLAUDE.md** — Update §九 (Vibe Coding workflow) or §五 (常見問題修復模式) with a one-line note:
   ```
   ## Pre-commit hook
   Husky enforces `pnpm tsc --noEmit` on every commit. To bypass in an emergency,
   use `git commit --no-verify` (but the next commit must restore tsc-green or CI
   will fail on push).
   ```
   Append this to CLAUDE.md in the appropriate section. Keep edit minimal (1 paragraph).

## Acceptance Criteria
- [ ] `.husky/pre-commit` file exists, is executable, runs tsc
- [ ] `package.json` has `"prepare": "husky"` script and `husky` in devDependencies
- [ ] Smoke test: a commit with a deliberate tsc error is BLOCKED with exit code 1
- [ ] Smoke test: a clean commit (no tsc errors) PROCEEDS normally
- [ ] CLAUDE.md updated with one paragraph documenting the hook + `--no-verify` escape
- [ ] No test artifacts left in the repo (cleaned up after smoke test)
- [ ] `pnpm tsc --noEmit` still exit 0 (this module didn't break the baseline)

## Deliverable
- New: `.husky/pre-commit` (~15 lines)
- Modified: `package.json` (+1 line: `"prepare": "husky"` + `husky` in devDependencies)
- Modified: `pnpm-lock.yaml` (auto-generated)
- Modified: `CLAUDE.md` (+1 paragraph)
- Commit message:
  ```
  chore(husky): add pre-commit tsc gate to prevent error-count regression

  Enforces CLAUDE.md §九 red-line "tsc must pass before commit" automatically.
  Now that Phase 1 brings tsc to 0 errors, this hook prevents the codebase
  from drifting back into the 40-errors state that prompted P0-3.

  - .husky/pre-commit: runs pnpm tsc --noEmit, blocks commit on non-zero exit
  - package.json: husky devDep + prepare script
  - CLAUDE.md: documents the hook + emergency --no-verify escape

  To bypass in a genuine emergency: git commit --no-verify
  (but the next commit must restore tsc-green or CI rejects the push)

  Refs: docs/refactor/plan.md Phase 1 · Module 5
  Closes: P0-3 recommendation (d)
  ```

## Rollback
- Hook can be disabled instantly: `chmod -x .husky/pre-commit` (still in repo, just inert).
- Full revert: `git revert <SHA>` removes the hook + husky dep + CLAUDE.md note.
- No data risk.

## Manual intervention
- **Jeff approves the husky install** (new devDep). Routine.
- **Jeff confirms the hook performance is acceptable** — `pnpm tsc --noEmit` on this codebase takes ~30-60 seconds. If that's annoying mid-flow, options:
  - (a) Use `tsc --incremental` (already enabled in tsconfig — should be near-instant after warmup)
  - (b) Switch to `tsc -b --noEmit` for project-references-style incremental
  - (c) Use a fast-path tool like `tsc-files` to only typecheck staged files
- Recommend (a) — already enabled, just measure: `time pnpm tsc --noEmit` after the install and report to Jeff in the commit description.

## Test plan
- No new Vitest tests required (hook is dev tooling, not runtime).
- Smoke test described in step 7 IS the test — must execute and pass before this module's commit lands.
- Long-term verification: the hook proves itself over time by blocking the next person who tries to commit a tsc error. Track in progress.md.
