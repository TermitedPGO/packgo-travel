# Phase 0 · Module 4 · Server + Infra WIP

**Parent plan:** docs/refactor/plan.md (Phase 0 · WIP Stabilization)
**Audit ref:** N/A (Phase 0 is prerequisite)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.7 h Jeff review

## Goal
Triage everything outside `client/src/components` and `client/src/pages` into commits or stashes: `Dockerfile`, `client/public/*`, `vite.config.ts`, every `M` under `server/`, plus all untracked scripts, drizzle migrations, and server helpers/services.

## Pre-requisites
- Modules 1-3 ideally landed first to clear the client-side noise, but disjoint file sets mean this module can also run in parallel.

## Inputs (read these before executing)
- Confirm scope:
  ```bash
  git status --porcelain | grep -vE '^(\sM|\?\?) client/src/(components/|pages/|hooks/|utils/|index\.css)'
  ```
- Modified infra / config files:
  - `Dockerfile`
  - `client/public/robots.txt`
  - `vite.config.ts`
- Modified `server/_core/*`:
  - `server/_core/env.ts`
  - `server/_core/imageGen.ts`
  - `server/_core/llm.ts`
  - `server/_core/vite.ts`
- Modified `server/agents/*`:
  - `contentAnalyzerAgent.ts`, `dateExtractorAgent.ts`, `diagnostics.ts`, `itineraryExtractAgent.ts`, `itineraryPolishAgent.ts`, `itineraryUnifiedAgent.ts`, `learningAgent.ts`, `masterAgent.ts`, `pdfParserAgent.ts`, `progressTracker.ts`, `skillLearnerAgent.ts`
  - `server/agents/skills/ContentAnalyzerAgent.SKILL.md`, `server/agents/skills/ItineraryAgent.SKILL.md`
- Modified server top-level / services:
  - `server/aiChatStreamRouter.ts`, `server/pdfGenerator.ts`, `server/translation.ts`, `server/utils/tagGenerator.ts`
  - `server/services/emailTemplateService.ts`, `server/services/itineraryImageService.ts`, `server/services/lionTravelApiService.ts`
  - `server/skills/details/detailsSkill.ts`
- Untracked subtrees + files:
  - `.audit/` (audit artefact dir — likely Stage 1 output)
  - `check_*.mjs`, `check_round80*.mjs`, `check_local_*.mjs`, `check_prod*.mjs` (ad-hoc audit scripts at repo root — 5 files)
  - `client/public/basemaps/`, `client/public/hillshade/` (map-tile assets)
  - `drizzle/0051_*.sql` … `drizzle/0068_*.sql` (18 new migration files) + `drizzle/meta/0051_snapshot.json`
  - `scripts/*` — ~40 new ad-hoc scripts (`backfill-tour-city.mjs`, `basemap-*.png`, `catalog-breakdown.mjs`, `check-batch-progress.mjs`, etc.)
  - `server/_core/membershipPricing.ts`, `server/_core/packpoint.ts`, `server/_core/parseLlmJson.ts`, `server/_core/referral.ts`, `server/_core/vouchers.ts`
  - `server/_helpers/`, `server/agents/_helpers/` (helper subtrees)
  - `server/agents/autonomous/agentChat.ts`, `agentReport.ts`, `agentTools.ts`, `followupAgent.ts`, `marketingAgent.ts`, `officeAssistant.ts`, `refundAgent.ts`, `reviewAgent.ts`
  - `server/agents/itineraryTypes.ts`
  - `server/agents/skills/references/Place-Name-Standardization.md`
  - `server/scripts/sweep-place-aliases.ts`
  - `server/services/skills/assets/`, `server/services/skills/logoConstants.ts`, `server/services/skills/quoteTemplate.ts`, `server/services/skills/skillPdfService.ts`
  - `server/services/tourMapGenerator.ts`
  - `docs/*.md` — ~17 untracked docs (ai-advisor-pricing, ai-agents-audit-2026-05, packpoint-policy, round-80.15/16/17-* inspection logs)
- Audit ref: P0-3 lists `server/agents/autonomous/*` and `supplierSyncService.ts` as Phase 1 Cluster A/C targets — Module 4 must NOT mass-commit those WIP edits. The autonomous-agents subtree (currently untracked) maps to Phase 1 Cluster A.
- CLAUDE.md §四 — server-side禁止事項: no hard-coded ports, no LLM in front-end, etc. (sanity check while reading diffs).
- Memory: `feedback_packgo_core_principle.md` (自動化優先 — when commenting on agent files, check that diffs maintain that principle).

## Procedure
1. **Snapshot scope:**
   ```bash
   git status --porcelain | grep -vE 'client/src/(components/(?!admin/)|pages/|hooks/|utils/|index\.css)' | grep -vE 'client/src/components/admin' > /tmp/phase0-mod4-status.txt
   wc -l /tmp/phase0-mod4-status.txt
   ```
   Expect 130+ entries (this is the heaviest module by file count, but most are untracked scripts/migrations).

2. **Group A — Drizzle migrations** (highest safety priority — these are ordered, immutable history):
   ```bash
   ls -la drizzle/0051_*.sql drizzle/0052_*.sql drizzle/0053_*.sql drizzle/0054_*.sql \
          drizzle/0055_*.sql drizzle/0056_*.sql drizzle/0057_*.sql drizzle/0058_*.sql \
          drizzle/0059_*.sql drizzle/0060_*.sql drizzle/0061_*.sql drizzle/0062_*.sql \
          drizzle/0063_*.sql drizzle/0064_*.sql drizzle/0065_*.sql drizzle/0066_*.sql \
          drizzle/0067_*.sql drizzle/0068_*.sql 2>/dev/null
   ls -la drizzle/meta/0051_snapshot.json 2>/dev/null
   ```
   Check whether earlier 0048-0050 are committed in main:
   ```bash
   git log --oneline drizzle | head -10
   ```
   - If 0051-0068 are sequential continuations: bundle as **Commit A — `feat(db): migrations 0051-0068 (packpoint, vouchers, reviews, photos, agent messaging, gmail integration, …)`**.
   - If any number is skipped or duplicated: STOP and escalate. Migration ordering errors cause irrecoverable schema drift.
   - Include `drizzle/meta/0051_snapshot.json` in the same commit.
   - **Jeff must explicitly approve this commit before push** (CLAUDE.md §八 Schema variation = Checkpoint trigger).

3. **Group B — `.audit/` artefact directory:**
   ```bash
   ls -la .audit/
   du -sh .audit/
   ```
   - If this is Stage 1 output mentioned in `audit-2026-05-18.md`, it should be tracked. Check whether `.gitignore` lists `.audit/`:
     ```bash
     grep -n "audit" .gitignore
     ```
   - If `.audit/` is supposed to be ignored: add to `.gitignore` and DO NOT commit. Result: this becomes a `.gitignore` edit commit (bundle with Group F below).
   - If it is meant to be tracked: **Commit B — `chore(audit): add Stage 1 audit artefact directory`**. Verify no secrets / credentials inside before committing.

4. **Group C — Root-level ad-hoc check scripts (`check_*.mjs`):**
   - These 5 files (`check_local_round80.1.mjs`, `check_local_tours.mjs`, `check_prod.mjs`, `check_prod_full.mjs`, `check_round80.1_prod.mjs`, `check_round80_prod.mjs`) were used for one-shot audits. Per the v2-deferred-list in `docs/refactor/plan.md` ("scripts/ purge 102 files"), do NOT commit them as productive code.
   - Decision options (Jeff yes/no):
     - **Option C1:** Move them all into `scripts/audit-archive/` and commit as **`chore(scripts): archive round-80 / prod-audit one-shot scripts`**.
     - **Option C2:** Stash as `phase0/mod4/check-scripts-wip` and revisit in v2 scripts/ purge.
   - Default if Jeff doesn't decide: STASH (cleaner repo root for Phase 1).

5. **Group D — `scripts/*` untracked (~40 files including PNG assets):**
   - PNG basemap files (`basemap-switzerland*.png`, `fullmap-switzerland.png`): these are LARGE binary artefacts. Check size:
     ```bash
     du -sh scripts/*.png
     ```
     If > 1MB each: do NOT commit. Move to `client/public/basemaps/` or add to `.gitignore`. Jeff yes/no.
   - `.mjs` script files: sniff-test maturity:
     ```bash
     for f in scripts/*.mjs; do
       echo "=== $f ($(wc -l < "$f") lines) ==="
       grep -l 'TODO\|FIXME\|console\.log\|process\.exit' "$f" || echo "looks clean"
     done
     ```
   - Proposed split:
     - **Commit D1 — `feat(scripts): tour catalog audit + sync diagnostic scripts`** for the clean / production-leaning ones (`backfill-tour-city`, `catalog-breakdown`, `inspect-recent-tours`, `tour-state-summary`, `quick-counts`, `full-scan`).
     - **STASH `phase0/mod4/scripts-experimental`** for the obviously one-shot ones (`japan-batch-audit`, `japan-sept-*`, `quarantine-broken-japan`, `wipe-all-tours`, `pause-queue`, `purge-inactive-tours`, anything destructive).
   - Default if uncertain: STASH.

6. **Group E — `client/public/basemaps/` + `client/public/hillshade/` (untracked):**
   - Per memory `project_tour_route_map.md`, the SVG route renderer + AI base-maps are in active development.
   - Check size:
     ```bash
     du -sh client/public/basemaps client/public/hillshade
     ```
   - If size < 5MB total and Jeff confirms these are production assets used by the tour route map: **Commit E — `feat(assets): tour route map basemaps + hillshade tiles`**.
   - If > 5MB or unclear: STASH and defer to a dedicated asset-pipeline commit later. Default: STASH (binary blobs in git history are forever).
   - Jeff yes/no required.

7. **Group F — `server/_core/*` new helpers (untracked):**
   - Files: `membershipPricing.ts`, `packpoint.ts`, `parseLlmJson.ts`, `referral.ts`, `vouchers.ts`
   - Per memory `feedback_packgo_core_principle.md` and Phase 4D money-paths scope, these are pre-extracted helpers that Phase 4D will consume.
   - Inspect each:
     ```bash
     for f in server/_core/membershipPricing.ts server/_core/packpoint.ts \
              server/_core/parseLlmJson.ts server/_core/referral.ts \
              server/_core/vouchers.ts; do
       wc -l "$f"
       grep -E 'TODO|FIXME|XXX' "$f" || echo "(no markers)"
     done
     ```
   - If all ≤ 300 LOC and marker-free: **Commit F — `feat(server/_core): extract membership/packpoint/voucher/referral helpers + parseLlmJson util`**.
   - Else: split into mature commit + stash.

8. **Group G — `server/agents/autonomous/*` untracked:**
   - Files: `agentChat.ts`, `agentReport.ts`, `agentTools.ts`, `followupAgent.ts`, `marketingAgent.ts`, `officeAssistant.ts`, `refundAgent.ts`, `reviewAgent.ts`
   - **BLOCK** — Phase 1 Cluster A (autonomous-agents tsc fixes) is the authoritative landing spot. `agentTools.ts` is referenced in audit P0-3 (lines 291-302). Do NOT commit in Phase 0.
   - STASH all as `phase0/mod4/autonomous-agents-wip`. Phase 1 will pop and merge.

9. **Group H — `server/agents/_helpers/`, `server/_helpers/` (untracked subtrees):**
   - `ls -la` each. If empty or single-file scaffold: STASH `phase0/mod4/server-helpers-wip` and let later phases populate.
   - If contains coherent extracted helpers used by modified agent files in step 11: include in the agent-file commit (Group I below).

10. **Group I — Modified `server/agents/*` files:**
    - Files: `contentAnalyzerAgent`, `dateExtractorAgent`, `diagnostics`, `itineraryExtractAgent`, `itineraryPolishAgent`, `itineraryUnifiedAgent`, `learningAgent`, `masterAgent`, `pdfParserAgent`, `progressTracker`, `skillLearnerAgent`
    - `masterAgent.ts` is on the v2 deferred list (P0-4) — DO NOT commit changes that move toward a split. Stash any structural edits.
    - For each, `git diff <file> | head -80` → classify `COMMIT-CLEAN` / `STASH-WHOLE`.
    - Proposed: **Commit I — `chore(agents): small fixes/logs/prompts in itinerary + diagnostics agents`** for the cohesive small-diff cluster. Stash the rest.

11. **Group J — Modified server services + `_core` + top-level:**
    - `server/_core/env.ts`, `imageGen.ts`, `llm.ts`, `vite.ts`
    - `server/aiChatStreamRouter.ts`, `server/pdfGenerator.ts`, `server/translation.ts`, `server/utils/tagGenerator.ts`
    - `server/services/emailTemplateService.ts`, `server/services/itineraryImageService.ts`
    - `server/services/lionTravelApiService.ts` — **BLOCK** — Phase 5A owns this file (supplierSyncService split + tests). STASH as `phase0/mod4/lionTravelApi-wip`.
    - `server/skills/details/detailsSkill.ts`
    - Classify each. Bundle clean ones into **Commit J — `chore(server): assorted server-side polish (env/llm/email/pdf/translation)`**.

12. **Group K — New untracked services:**
    - `server/services/skills/assets/`, `server/services/skills/logoConstants.ts`, `server/services/skills/quoteTemplate.ts`, `server/services/skills/skillPdfService.ts`
    - `server/services/tourMapGenerator.ts`
    - `server/scripts/sweep-place-aliases.ts`
    - `server/agents/itineraryTypes.ts`
    - `server/agents/skills/references/Place-Name-Standardization.md`
    - Per memory `reference_packgo_skills.md`, the skills subsystem is actively used. Inspect for maturity, then either **Commit K — `feat(skills): quote PDF service + asset constants + place-name standardization reference`** or stash per file.

13. **Group L — Infrastructure files:**
    - `Dockerfile` — `git diff Dockerfile`. Likely a small build tweak. If self-contained and Jeff confirms (this affects production builds!): **Commit L1 — `chore(docker): <one-line summary>`**.
    - `client/public/robots.txt` — `git diff client/public/robots.txt`. Usually trivial. **Commit L2 — `chore(seo): update robots.txt`** (can bundle into Commit L1 only if single concern).
    - `vite.config.ts` — `git diff vite.config.ts`. Build-config changes need Jeff approval; **Commit L3 — `chore(vite): <summary>`**.

14. **Group M — Documentation:**
    - 17 untracked `docs/*.md` (ai-advisor-pricing, packpoint-policy, round-80.15/16/17-* inspections).
    - Bundle as **Commit M — `docs: round-80 inspection logs + packpoint policy + ai-advisor pricing`**. Docs are zero-risk so commit liberally.

15. **Execute commits in this order:** A (migrations, requires Jeff approval) → B/C/D (audit + scripts) → E (assets, if approved) → F (core helpers) → I (agent file polish) → J (server polish) → K (skills) → L (infra) → M (docs). All STASH groups (G autonomous, H helpers, J's lionTravelApi piece) executed AFTER all commits land so working tree ends empty.

16. **Per commit:**
    ```bash
    git add <files>
    git diff --cached --stat
    pnpm tsc --noEmit 2>&1 | tail -3   # baseline ≤ ~40 errors
    pnpm build > /tmp/phase0-mod4-build-<group>.log 2>&1 || (echo "build broke"; exit 1)
    git commit -F /tmp/phase0-mod4-commit-<group>.txt
    ```

17. **Per stash:**
    ```bash
    git stash push --keep-index -m "phase0/mod4/<label>" -- <file(s)>
    git stash list | grep phase0/mod4
    ```

18. **Final state:**
    ```bash
    git status --short
    ```
    Should be empty.

## Acceptance Criteria
- [ ] Every server / infra / migration / script / docs file from the start state is either in a commit or labelled stash
- [ ] Migrations 0051-0068 ship as a single sequential commit (or escalation note exists)
- [ ] `server/agents/autonomous/*` files are STASHED (Phase 1 owns)
- [ ] `server/services/lionTravelApiService.ts` is STASHED (Phase 5A owns)
- [ ] `server/agents/masterAgent.ts` structural edits are STASHED (v2 owns)
- [ ] `pnpm tsc --noEmit` error count after final commit ≤ Stage 1 baseline (~40)
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` regression-anchor pass count unchanged
- [ ] `git status --short` empty
- [ ] `git stash list | grep phase0/mod4` lists every deferred file with a clear label

## Deliverable
- 6-12 commits depending on Jeff's yes/no on Groups B/C/D/E. Most likely set: A (migrations) + F (core helpers) + I (agent polish) + J (server polish) + K (skills) + L1/L2/L3 (infra) + M (docs) = 8 commits.
- 3-5 named stashes.
- Commit message subjects follow Conventional Commits (`feat(...)`, `chore(...)`, `docs:`).

## Rollback
- Per commit: `git revert <SHA>` (preferred — forward revert keeps history linear) or `git reset HEAD~1` (only if not yet pushed).
- Per migration commit (Group A): rolling back live migrations requires a counter-migration. Do NOT revert the commit if migrations have already run in production. Coordinate with Jeff before any rollback.
- Per stash: `git stash pop` / `git stash apply` / `git stash drop`.

## Manual intervention
- **Jeff approves the migration commit (Group A) before push** — schema changes are Checkpoint-triggering per CLAUDE.md §八.
- **Jeff yes/no on Groups B, C, D, E** — these involve repo-root cruft / large binary assets where AI cannot judge intent.
- **Jeff approves every infra commit (Group L: Dockerfile, vite.config, robots.txt)** — these affect production builds.
- **Jeff explicitly confirms autonomous-agents subtree STAYS stashed** so Phase 1 Cluster A applies on clean base.

## Test plan
- No new tests (Phase 0 is git hygiene).
- Existing tests must still pass: `pnpm test` after each commit.
- Migration sanity: `pnpm drizzle-kit check` (if available) to verify ordering integrity. Do NOT run migrations against any live DB in Phase 0.
- Build sanity: `pnpm build` after final commit must succeed (catches `vite.config.ts` regressions).
- Manual smoke (post-push, before Phase 1 starts): start dev server, hit a tRPC endpoint that touches the new `_core/*` helpers (e.g., membership pricing or voucher list) to verify they wire correctly when re-imported.
