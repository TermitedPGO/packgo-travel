# Phase 0 · Module 2 · Client UI Coherent Commits

**Parent plan:** docs/refactor/plan.md (Phase 0 · WIP Stabilization)
**Audit ref:** N/A (Phase 0 is prerequisite)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.0 h AI + 0.5 h Jeff review

## Goal
Group modified client-side UI files (non-admin) into 2-3 coherent commits whose diffs each tell one story, and stash anything that is mid-refactor exploration.

## Pre-requisites
- Module 1 (Round-80 deletions) should land first so the diff surface for this module is non-overlapping. Not strictly blocking — can run after Module 1 commit lands.

## Inputs (read these before executing)
- Run `git status --porcelain | grep -E '^ M client/src/(components/(?!admin/)|pages/|hooks/|utils/|index\.css)'` to confirm the scope.
- Expected target files (43 modified, plus a few untracked):
  - **Layout / chrome:** `client/src/components/Header.tsx`, `Footer.tsx`, `CookieConsentBanner.tsx`, `LocaleSwitcher.tsx`, `SEO.tsx`, `client/src/hooks/useSEO.ts`
  - **Home section:** `client/src/components/HomeWelcomeBack.tsx`, `client/src/components/EditableDestinations.tsx`, `client/src/components/WhyChooseUs.tsx`, `client/src/components/NewsletterSection.tsx`, `client/src/components/home/HomeHero.tsx`
  - **Tour / listing surface:** `client/src/components/TourDeparturesTable.tsx`, `client/src/components/inline-edit/EditableDayCard.tsx`, `client/src/components/tour-detail/DailyItinerarySection.tsx`
  - **Page-level edits (39 files):** every `M` under `client/src/pages/*.tsx`
  - **Global:** `client/src/index.css`, `client/src/utils/locationMapping.ts`
- New untracked home-page splits (these are mature scaffolds per the new naming pattern):
  - `client/src/components/home/HomeFeaturedSpotlight.tsx`
  - `client/src/components/home/HomeFounderStory.tsx`
  - `client/src/components/home/HomeMembershipPromo.tsx`
  - `client/src/components/home/HomeMomentsStrip.tsx`
  - `client/src/components/home/HomeSearchBar.tsx`
- CLAUDE.md §2 (Design rules) — verify any css/index.css change does not break圓角 / 字體 / 色彩 invariants.

## Procedure
1. **Snapshot scope:** Save the file list for traceability.
   ```bash
   git status --porcelain > /tmp/phase0-mod2-status-before.txt
   git status --porcelain | grep -E '^ M client/' | grep -v admin | awk '{print $2}' > /tmp/phase0-mod2-targets.txt
   wc -l /tmp/phase0-mod2-targets.txt
   ```
   Expect ~50 client modified files (excluding admin/*).

2. **Inspect every diff before grouping.** For each file in `/tmp/phase0-mod2-targets.txt`:
   ```bash
   git diff --stat "$f"
   git diff "$f" | head -60
   ```
   For each file decide one of three buckets and record in `/tmp/phase0-mod2-buckets.txt`:
   - `COHERENT` → goes into a commit (changes look intentional, finished, ≤ ~50 line diff or a clear single-concern bigger one)
   - `EXPLORATORY` → stash separately (looks half-done; e.g., commented-out blocks, TODO markers added, partial component rewrites)
   - `TRIVIAL` → bundle into a "misc i18n/copy/style polish" commit

3. **Propose commit groups** in `/tmp/phase0-mod2-plan.md`. Recommended grouping:
   - **Commit A — `feat(home): home page section split + spotlight/founder/moments scaffold`**
     - All 5 new `client/src/components/home/Home*.tsx` untracked files
     - Modifications to `client/src/components/home/HomeHero.tsx`, `client/src/components/HomeWelcomeBack.tsx`, `client/src/components/EditableDestinations.tsx`, `client/src/components/NewsletterSection.tsx`, `client/src/components/WhyChooseUs.tsx`
     - `client/src/pages/Home.tsx` if it now imports these new sections
   - **Commit B — `chore(chrome): header/footer/locale/cookies/seo polish`**
     - `client/src/components/Header.tsx`, `Footer.tsx`, `LocaleSwitcher.tsx`, `CookieConsentBanner.tsx`, `SEO.tsx`, `client/src/hooks/useSEO.ts`
     - `client/src/index.css` (only if changes are global typography/spacing — verify with `git diff`)
   - **Commit C — `chore(pages): copy / i18n / layout tweaks across non-flagship pages`**
     - All page edits that are ≤ ~20 lines of diff and look like routine copy / class-list polish: `AboutUs, AirportTransfer, ChinaVisa, ChinaVisaStatus, ChinaVisaSuccess, ContactUs, CruisePage, CustomTourRequest, CustomTours, FAQ, FlightBooking, ForgotPassword, GroupPackages, HotelBooking, Login, NotFound, PaymentFailure, PaymentSuccess, PrivacyPolicy, QuickInquiry, ResetPassword, TermsOfService, TourPrintView`
     - `client/src/utils/locationMapping.ts` if it is a data-only tweak
   - **Commit D — `feat(tour): departure table + day card + itinerary section`** (only if diffs are coherent)
     - `client/src/components/TourDeparturesTable.tsx`
     - `client/src/components/inline-edit/EditableDayCard.tsx`
     - `client/src/components/tour-detail/DailyItinerarySection.tsx`
   - **STASH bucket:** Anything in `EXPLORATORY` from step 2 — likely candidates: `TourDetailPeony.tsx`, `BookTour.tsx`, `BookingDetail.tsx`, `Profile.tsx`, `Tours.tsx`, `SearchResults.tsx` (heavy flagship pages where mid-flight edits are likely). Stash as:
     ```bash
     git stash push --keep-index -m "phase0/mod2/exploratory-<page-name>" -- <file>
     ```
     One stash per logical group; not one global mega-stash.

4. **Submit the grouping plan to supervisor** before any `git add`. Supervisor approves or revises buckets. Jeff has final yes/no per commit.

5. **Execute commits in order A → B → C → D.** For each:
   ```bash
   git add <only the listed files>
   git diff --cached --stat
   git diff --cached | wc -l   # sanity: not too huge (each commit ≤ ~800 diff lines ideal)
   pnpm tsc --noEmit 2>&1 | tail -3   # error count must not increase
   git commit -F /tmp/phase0-mod2-commit-<A|B|C|D>.txt
   ```

6. **For the STASH bucket:** Use `git stash push --keep-index -m "<name>" -- <file1> <file2>` so the stash carries only the chosen file. Verify recoverable:
   ```bash
   git stash list | grep phase0/mod2
   ```

7. **Final state check:**
   ```bash
   git status --porcelain | grep -E '^ M client/' | grep -v admin
   ```
   Should now be empty (everything committed or stashed).

## Acceptance Criteria
- [ ] Every `M client/src/...` (excluding `admin/`) file from the start state is either in a commit or in a named stash
- [ ] Each commit's `git show --stat` tells one story (no surprise files)
- [ ] `pnpm tsc --noEmit` error count after the final commit ≤ Stage 1 baseline (~40)
- [ ] `pnpm test` pass count unchanged from baseline
- [ ] `git stash list` shows clearly labelled `phase0/mod2/*` entries (if any)

## Deliverable
- 2-4 commits (typical: 3) on client UI files. Total diff in the 50-1500 LOC range per commit.
- Zero or more named stashes for exploratory work.
- Commit message subjects follow `feat(<scope>):` or `chore(<scope>):` Conventional Commits format.

## Rollback
- Per commit: `git reset HEAD~1` (soft, keeps changes in WD) or `git revert <SHA>` (forward revert).
- Per stash: `git stash pop stash@{N}` restores; `git stash drop stash@{N}` deletes.
- 90-day reflog window protects all commits even after rebase.

## Manual intervention
- **Jeff personally approves each commit's grouping AND message before push.** AI cannot reliably decide "is this UI tweak done enough to ship?" — that's Jeff's call per the Phase 0 plan section.
- **Jeff yes/no on every stash candidate** (step 3 EXPLORATORY list). A file Jeff thinks is finished should move to a commit instead.

## Test plan
- No new tests. Phase 0 is git hygiene only.
- Existing tests must still pass: `pnpm test` after each commit.
- Visual smoke after final commit: open dev server, click through `/`, `/tours`, `/about`, `/contact`, `/faq`, language switcher EN ↔ ZH. No new console errors vs. pre-Phase-0 baseline.
