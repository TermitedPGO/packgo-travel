# v2 · Wave 3 · Module 3.13 — Rename `server/skills/` → `server/agents/_subskills/`

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.11 line 344)
**Audit ref:** v2-audit-2026-05-19.md §A lines 60–67 ("Three locations all called 'skills'")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2h AI + 0min Jeff

## Goal

Disambiguate three "skills" folders. Today:

- `server/skills/` — **MasterAgent's progressive-disclosure subskills** (details, itinerary, transport, vision, visual, content, data-fidelity, web-scraper). Only **`detailsSkill.ts`** is real TS code; the rest are SKILL.md markdown loaded at runtime via `skillLoader.ts`.
- `server/services/skills/` — **PDF/template generators** (quoteTemplate, depositTemplate, tourComparisonTemplate, skillPdfService, logoConstants).
- `server/agents/skills/` — **Agent-callable orchestrators + registry** (tourComparison.ts + 12 .SKILL.md docs + after Wave 3: registry.ts, dispatcher.ts, chinaVisa.ts, tourConfirmation.ts).

Per audit §A recommendation: **Rename `server/skills/` → `server/agents/_subskills/`**. Keep the other two. The `_subskills/` prefix matches the underscore-prefix pattern recommended elsewhere (`_pipeline/`, `_helpers/`, `_core/`).

This is a **mechanical rename + import sweep**. Zero behavior change.

## Pre-requisites

- All Wave 3 modules that create files in `server/agents/skills/` (modules 3.2, 3.3, 3.4, 3.6, 3.7) — **landed first**. The rename only touches `server/skills/`, not `server/agents/skills/`, but landing 3.13 after the other Wave 3 modules avoids merge churn on `server/agents/skills/registry.ts` etc.
- (Soft) Wave 2.3 masterAgent split — landed. After split, `server/agents/masterAgent.ts` line 29 import path will move (the path changes from `../skills/details/...` to `../_subskills/details/...`). This module updates that line.

## Inputs (read these before executing)

1. List of files to move:
   ```bash
   find /Users/jeff/Desktop/網站/server/skills -type f
   # Expected:
   # /Users/jeff/Desktop/網站/server/skills/skillLoader.ts
   # /Users/jeff/Desktop/網站/server/skills/transport/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/data-fidelity/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/web-scraper/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/details/detailsSkill.ts
   # /Users/jeff/Desktop/網站/server/skills/details/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/content/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/vision/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/visual/SKILL.md
   # /Users/jeff/Desktop/網站/server/skills/itinerary/SKILL.md
   ```

2. List of import call sites to update:
   ```bash
   grep -rn "from.*skillLoader\|from.*\"../skills\|from.*'../skills\|from.*\"\\./skills\|from.*\\./skills/details" \
     /Users/jeff/Desktop/網站/server --include="*.ts"
   ```

   Confirmed pre-task callsites (from current repo state):
   - `server/agents/trainAgent.ts:9` — `import { ... } from "./skillLoader"`
   - `server/agents/flightAgent.ts:10` — same
   - `server/agents/imagePromptAgent.ts:12` — same
   - `server/agents/imageGenerationAgent.ts:12` — same
   - `server/agents/colorThemeAgent.ts:7` — same
   - `server/agents/masterAgent.ts:29` — `import { ... } from "../skills/details/detailsSkill"`
   - `server/agents/masterAgent.ts:33` — `import { ... } from "./skillLoader"`
   - `server/agents/contentAnalyzerAgent.ts:14` — `from "./skillLoader"`
   - `server/agents/itineraryUnifiedAgent.ts:19` — `from "./skillLoader"`
   - `server/skills/details/detailsSkill.ts:17` — `from "../skillLoader"`

   Note: `./skillLoader` references are pointing at `server/agents/skillLoader.ts` (which **already exists as a sibling re-export!** — confirm). The `server/skills/skillLoader.ts` may be a separate file. **Read both** before doing the rename.

3. `server/agents/skillLoader.ts` vs `server/skills/skillLoader.ts` — confirm if one is a re-export of the other (likely), or two separate implementations.

4. CLAUDE.md §六 file map — references will need updating.

## Scope (what this module owns)

- Rename: `server/skills/` → `server/agents/_subskills/` (10 files: 2 .ts + 8 .md)
- Update imports across ~9 call sites
- Update `CLAUDE.md` §六 file map
- Update `server/agents/skillLoader.ts` if it re-exports from `../skills/skillLoader.ts` (path changes)

Does NOT:
- Touch `server/services/skills/` (PDF templates)
- Touch `server/agents/skills/` (agent-callable orchestrators)
- Change any logic — pure file move + import path update

## Procedure

1. **Read both `skillLoader.ts` files** to confirm relationship:
   ```bash
   diff /Users/jeff/Desktop/網站/server/agents/skillLoader.ts /Users/jeff/Desktop/網站/server/skills/skillLoader.ts
   ```
   - If identical: one is a duplicate; deduplicate during rename.
   - If `server/agents/skillLoader.ts` is a thin re-export of `server/skills/skillLoader.ts`: keep the re-export, just update its path.
   - If they're different files: both move (the agents-side one is just `skillLoader.ts`; the skills-side one moves with the directory rename).

2. **Move the directory** (preserves git history per file via `git mv`):
   ```bash
   git mv /Users/jeff/Desktop/網站/server/skills /Users/jeff/Desktop/網站/server/agents/_subskills
   ```

3. **Verify the move via git status:**
   ```bash
   git status --short | head -20
   ```
   Should show R (rename) for all 10 files.

4. **Find + replace all import paths.** Two patterns to update:

   **Pattern A — `../skills/<sub>/...`** (from outside the skills folder):
   ```
   ../skills/details/detailsSkill   →   ../_subskills/details/detailsSkill
   ```
   Affects: `server/agents/masterAgent.ts:29`.

   **Pattern B — `../skillLoader`** (from inside the renamed folder):
   ```
   ../skillLoader   →   ../skillLoader (unchanged because masterAgent's skillLoader is in server/agents/, not in _subskills/)
   ```
   Actually: read `server/skills/details/detailsSkill.ts:17` — it does `from "../skillLoader"`. After rename, the file is at `server/agents/_subskills/details/detailsSkill.ts` and `../skillLoader` resolves to `server/agents/_subskills/skillLoader.ts`. If that file exists (it does — the renamed `server/skills/skillLoader.ts` is now there), this import stays the same. **Verify by listing post-rename `server/agents/_subskills/`**.

5. **Use `Edit replace_all`** for each affected file. **No `sed`** per CLAUDE.md guidance.

6. **Update CLAUDE.md §六 file map**:
   ```
   | MasterAgent 子技能 (subskills) | `server/agents/_subskills/{details,itinerary,...}/SKILL.md` |
   ```
   Remove any old `server/skills/` references.

7. **Run tsc gate:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
   ```
   Expected: 0 errors. If any errors reference unresolved imports, those are call sites this module missed — find via:
   ```bash
   grep -rn "from.*server/skills\|from.*['\"].*skills/" /Users/jeff/Desktop/網站/server --include="*.ts" | grep -v "agents/skills" | grep -v "services/skills" | grep -v "_subskills"
   ```
   Should return empty.

8. **Run tests:**
   ```bash
   pnpm test
   ```
   Existing tests should pass unchanged.

## Acceptance Criteria

- [ ] `server/skills/` directory no longer exists (`ls server/skills` returns ENOENT)
- [ ] `server/agents/_subskills/` exists with all 10 moved files (`find server/agents/_subskills -type f | wc -l == 10`)
- [ ] All ~9 import call sites updated to new paths
- [ ] `pnpm tsc --noEmit` exits 0 (no unresolved imports)
- [ ] `pnpm test` all green (no test changes; tests still find their source)
- [ ] CLAUDE.md §六 updated to reference new path
- [ ] `grep -rn "from.*server/skills" server --include="*.ts"` returns 0 hits (matched against the OLD path)
- [ ] `git status --short` shows R (renames), not D+A (delete + add) — confirms `git mv` preserved history

## Deliverable

- Renamed: 10 files moved from `server/skills/` to `server/agents/_subskills/`
- Modified: ~9 import statements across `server/agents/*.ts`
- Modified: `CLAUDE.md` §六

Commit message:
```
refactor(agents): Wave 3 Module 3.13 — rename server/skills → server/agents/_subskills

Disambiguates the three "skills" folders flagged in v2-audit §A:

  server/skills/                    — RENAMED → server/agents/_subskills/
  server/services/skills/           — unchanged (PDF/template generators)
  server/agents/skills/             — unchanged (agent-callable orchestrators
                                       + registry from Wave 3)

The renamed folder holds MasterAgent's progressive-disclosure subskills
(details, itinerary, transport, vision, visual, content, data-fidelity,
web-scraper) — these are internal to MasterAgent, not autonomous-
discoverable, hence the underscore prefix (matches _pipeline/, _helpers/,
_core/ pattern elsewhere).

Mechanical rename + import sweep across 9 call sites. Zero logic change.
All tests green. tsc 0 errors.

Refs: docs/refactor/tasks/v2-wave-3/module-3.13-skills-folder-rename.md
```

## Rollback

- Single revert. `git revert <SHA>` restores both the directory location and the import paths in one commit.
- No DB / no runtime / no schema.

## Manual intervention

- **None.** Fully autonomous.

## Test plan

- Existing test suite must pass (regression-anchor).
- No new tests — pure rename.

## Decisions needed (Jeff)

1. **New folder name** — `_subskills` proposed. Alternatives:
   - `_masterAgentSubskills` — verbose but precise.
   - `_progressiveDisclosure` — describes the pattern, not the role.
   - `_internalSkills` — generic.
   Recommend: **`_subskills`** (concise, paired with `_pipeline/_helpers/_core`).

(Module proceeds with `_subskills` if Jeff defers.)

## Dependency note for supervisor

This module touches paths that Wave 2.3 (masterAgent split) also touches. **Sequence:** Wave 2.3 → this module 3.13. If 3.13 lands before 2.3, the masterAgent supervisor split (2.3) will have to re-resolve the `_subskills` paths — fine, but creates merge churn. Prefer landing 2.3 first.
