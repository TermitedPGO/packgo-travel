# Phase 0 · Module 1 · Round-80 Deletion Confirm

**Parent plan:** docs/refactor/plan.md (Phase 0 · WIP Stabilization)
**Audit ref:** N/A (Phase 0 is prerequisite)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 0.5 h AI + 0.2 h Jeff review

## Goal
Validate the 9 files marked `D` in `git status` are truly unreferenced anywhere in the repo, then land a single atomic deletion commit on a clean staging slice.

## Pre-requisites
None — this is the safest Phase 0 module; can run first in parallel with modules 2/3/4.

## Inputs (read these before executing)
- Run `git status --porcelain | grep -E '^ D '` to see the 9 candidates.
- Expected target files (from current `git status`):
  1. `client/src/components/AIAdvisor.tsx`
  2. `client/src/components/AIAssistantButton.tsx`
  3. `client/src/components/Destinations.tsx`
  4. `client/src/components/EditableHero.tsx`
  5. `client/src/components/FeaturedTours.tsx`
  6. `client/src/components/Hero.tsx`
  7. `client/src/components/HomeHeroSpotlight.tsx`
  8. `client/src/components/ManusDialog.tsx`
  9. `client/src/components/PriceDisplay.tsx`
- CLAUDE.md §六 (Key files) — confirm none of these appear in the canonical key-file table.
- `docs/refactor/plan.md` Phase 0 — Round-80 cleanup pattern reference.

## Procedure
1. **Re-confirm the working list** (do NOT trust the stale list above blindly):
   ```bash
   git status --porcelain | grep -E '^ D ' | awk '{print $2}' > /tmp/phase0-mod1-deletions.txt
   wc -l /tmp/phase0-mod1-deletions.txt
   ```
   Expect 9 lines. If not 9, STOP and escalate to supervisor — the WIP has drifted since the plan was written.

2. **Reference-check each file individually.** For every path in `/tmp/phase0-mod1-deletions.txt`, run:
   ```bash
   BASENAME=$(basename <path> .tsx)
   grep -rn "${BASENAME}" client/src server --include="*.ts" --include="*.tsx" --include="*.md" | grep -v "^Binary" | grep -v "/${BASENAME}\.tsx:"
   ```
   Expected output: **zero lines** (the file is unreferenced).
   If ANY grep returns a hit, append to `/tmp/phase0-mod1-refs.txt` with the file + the grep output. Do NOT delete that file in step 5 — escalate to supervisor instead.

3. **Build-time sanity check** — make sure no lazy import or dynamic string references one of these names:
   ```bash
   for f in $(cat /tmp/phase0-mod1-deletions.txt); do
     base=$(basename "$f" .tsx)
     grep -rn "from .*${base}['\"]\|import.*${base}\|lazy.*${base}\|/${base}['\"]" client server --include="*.ts" --include="*.tsx" || true
   done
   ```
   Expected output: empty (no remaining import).

4. **Confirm no router/route uses these as page components:**
   ```bash
   grep -rn "AIAdvisor\|AIAssistantButton\|Destinations\b\|EditableHero\|FeaturedTours\|HomeHeroSpotlight\|ManusDialog\|PriceDisplay" client/src/App.tsx client/src/pages 2>/dev/null
   ```
   Expected output: zero hits. (`Hero` excluded because the substring is too noisy — handle it separately below.)

5. **Handle the `Hero.tsx` name carefully** (it may collide with `HomeHero`, `EditableHero`, etc.):
   ```bash
   grep -rn "from .*['\"].*\\bHero['\"]\\|import .* Hero[^A-Za-z]" client/src server --include="*.ts" --include="*.tsx"
   ```
   Expected output: zero hits. If any hit is genuinely `import Hero from '@/components/Hero'`, escalate.

6. **Stage only the deletions** (do not touch other files):
   ```bash
   git add -u client/src/components/AIAdvisor.tsx \
              client/src/components/AIAssistantButton.tsx \
              client/src/components/Destinations.tsx \
              client/src/components/EditableHero.tsx \
              client/src/components/FeaturedTours.tsx \
              client/src/components/Hero.tsx \
              client/src/components/HomeHeroSpotlight.tsx \
              client/src/components/ManusDialog.tsx \
              client/src/components/PriceDisplay.tsx
   git status --short | grep -E '^D ' | wc -l
   ```
   Expect 9 lines staged.

7. **Compile sanity** (Phase 0 doesn't aim to fix tsc, but a deletion must not introduce NEW errors):
   ```bash
   pnpm tsc --noEmit 2>&1 | tee /tmp/phase0-mod1-tsc.log | tail -5
   ```
   Compare error count to the Stage 1 audit baseline (~40 errors). Equal or fewer = OK. More than 40 = STOP, unstage, escalate.

8. **Prepare commit message** (Jeff approves before push):
   ```
   chore(round-80): delete confirmed-unreferenced legacy UI components

   Remove 9 client components that were marked for deletion in Round 80 cleanup
   and have zero remaining references in client/src or server:

   - AIAdvisor.tsx, AIAssistantButton.tsx (legacy AI assistant UI)
   - Destinations.tsx, FeaturedTours.tsx (replaced by EditableDestinations + home/*)
   - Hero.tsx, EditableHero.tsx, HomeHeroSpotlight.tsx (replaced by home/HomeHero.tsx)
   - ManusDialog.tsx (Manus-platform legacy)
   - PriceDisplay.tsx (replaced by inline price formatting)

   Refs: docs/refactor/plan.md Phase 0
   ```

9. **Wait for Jeff approval, then commit:**
   ```bash
   git commit -F /tmp/phase0-mod1-commit-msg.txt
   git log -1 --stat
   ```

## Acceptance Criteria
- [ ] `git status --porcelain | grep -E '^ D '` returns 0 lines after commit
- [ ] `git log -1 --name-status | grep -c '^D'` returns `9`
- [ ] `pnpm tsc --noEmit` error count ≤ Stage 1 baseline (~40)
- [ ] `pnpm build` succeeds (catches any missed lazy import)
- [ ] No grep hit for any deleted basename in `client/src`, `server`, except inside `docs/round-80*`

## Deliverable
- 1 commit deleting 9 files. Diff: ~ -2000 to -4000 LOC total (legacy components vary in size).
- Commit message format: see step 8 above. Subject line must start `chore(round-80):`.

## Rollback
- If commit was wrong: `git reset HEAD~1` (keeps deletions unstaged) or `git revert HEAD` (creates a counter-commit restoring files).
- The 9 files remain in git history forever; no data lost.

## Manual intervention
- **Jeff approves the commit message before push.** AI does NOT push.
- **Jeff confirms yes/no on any escalation** if step 2 / 4 / 5 finds an unexpected reference (likely means a file is still wired in).

## Test plan
- No new tests (deletions only).
- Existing tests must still pass: `pnpm test` after commit. If any test imports a deleted file, that's a referenced-file escape from step 2 — escalate.
- Visual smoke (post-push, before next module): load home page, admin panel, tour-detail page in dev — verify no console error about missing module.
