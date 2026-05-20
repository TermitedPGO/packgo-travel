# v2 · Wave 1 · Module 1.6 — Delete ComponentShowcase (1,436 LOC dead)

**Parent plan:** docs/refactor/v2-plan.md (Wave 1 · Module 1.9, renumbered here to 1.6 for kebab-slug clarity — see report)
**Audit ref:** v2-audit-2026-05-19.md §H (line 488 mentions "drop bundle weight"); plan §1.9 says "delete client/src/pages/ComponentShowcase.tsx (1,436 LOC)"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 0.5h AI

## Goal
Delete `client/src/pages/ComponentShowcase.tsx` (1,436 LOC dead code). Verified zero references repo-wide via `grep -rn "ComponentShowcase" client/src` → no matches outside the file itself. Bundle weight + cognitive load both drop with zero risk.

## Pre-requisites
- Working tree clean.
- **No dependency on other Wave 1 modules.** Pure delete.
- Independent of Module 1.5 (admin code-split); ComponentShowcase is a customer-side page, not admin.

## Inputs (read these before executing)
- `client/src/pages/ComponentShowcase.tsx` — confirm it exists and is 1,436 LOC. (Verified via `wc -l`.)
- `client/src/App.tsx` — confirm there is NO route referencing ComponentShowcase. Currently grep returns 0 matches.
- Any other files referencing the name:
  ```bash
  cd /Users/jeff/Desktop/網站
  grep -rn "ComponentShowcase\|component-showcase" client/src/ 2>&1
  # MUST return only matches inside ComponentShowcase.tsx itself, or 0 matches total.
  ```

## Scope (what this module owns)
1. **Delete `client/src/pages/ComponentShowcase.tsx`.**
2. **No other changes.** If grep reveals a reference (route, import, doc), STOP and escalate to supervisor.

## Procedure
1. **Run reference scan first:**
   ```bash
   cd /Users/jeff/Desktop/網站
   grep -rn "ComponentShowcase" client/src/ docs/ scripts/ server/ 2>&1
   ```
2. **If any reference outside `client/src/pages/ComponentShowcase.tsx` exists** → STOP. Output the grep result to supervisor and exit. Do not delete.
3. **If grep is clean,** delete the file:
   ```bash
   rm /Users/jeff/Desktop/網站/client/src/pages/ComponentShowcase.tsx
   ```
4. **Verify tsc:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
   ```
5. **Verify build:**
   ```bash
   pnpm build
   ```
6. **Verify tests:**
   ```bash
   pnpm test
   ```

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` all green
- [ ] `grep -rn "ComponentShowcase" client/src/` returns 0 matches
- [ ] `client/src/pages/ComponentShowcase.tsx` no longer exists
- [ ] No Vitest test required — pure deletion of dead code with zero references

## Deliverable
- **Deleted files:**
  - `client/src/pages/ComponentShowcase.tsx`
- **Expected commit message:**
  ```
  chore(client): delete ComponentShowcase page (1,436 LOC dead)

  Zero references in repo (grep clean across client/, server/, scripts/,
  docs/). Page was not routed in App.tsx. Removing reduces customer-side
  bundle weight + cognitive load.

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.9
  ```

## Rollback
- Single `git revert <SHA>` resurrects the file with full history.

## Manual intervention
- **None.** Pure deletion.

## Test plan
- **No new test required** (CLAUDE.md §九 exemption for pure-deletion modules where the deleted code has zero references and tsc + build pass).
- Regression anchor: existing tests continue to pass.

## Decisions needed (Jeff)
- **None.** This is mechanical. If grep finds a reference at step 1, escalate; otherwise proceed.
