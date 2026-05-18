# Phase 3 · Module 2 · Decide + Delete TodayOverview (`today-legacy`)

**Parent plan:** docs/refactor/plan.md (Phase 3 · Dead Code Purge)
**Audit ref:** P1-7 (deprecation-pending half)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (BLOCKED on Jeff yes/no gate — see "Manual intervention")
**Est. effort:** 0.5 h AI + 5 min Jeff review

## Goal
`UnifiedInbox` replaced `TodayOverview` as the default `today` landing on 2026-05-17 evening (commit comment chain in `Admin.tsx:82-85`). `TodayOverview` was kept under a `today-legacy` PageId for rollback safety during the rollout window. If Jeff confirms the rollout is fully accepted (no rollback contingency needed), delete the file, the PageId, the IA entry, and the manifest description string. If Jeff defers, document and skip — this module becomes a no-op for v1.

## Pre-requisites
- Phase 0 complete (clean `git status`)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- **Module 1 of Phase 3 landed first** — it touches adjacent comments in `Admin.tsx`; sequencing avoids merge conflicts.
- **Jeff yes/no on UnifiedInbox rollout acceptance** (see "Manual intervention" — this is the gating decision).

## Inputs (read these before executing)
- `client/src/components/admin/TodayOverview.tsx` — the file potentially being deleted (410 LOC, last touched 2026-05-17). Default export only.
- `client/src/pages/Admin.tsx` — all the call sites:
  - **Line 81:** `import TodayOverview from "@/components/admin/TodayOverview";` — DELETE
  - **Lines 82–85:** import-area comment block explaining the legacy fallback — DELETE
  - **Lines 107:** comment `// "today-legacy" preserves access to the old TodayOverview during rollout.` — DELETE
  - **Line 109:** `| "today-legacy"` in the `PageId` union type — DELETE
  - **Lines 149–152:** `advanced` IA entry (line 149–151 is the comment, line 152 is `{ id: "today-legacy", label: "舊版總覽" }`) — DELETE both
  - **Lines 381–385:** the `renderPage` switch case (`case "today-legacy": return <TodayOverview…`) plus its 2-line comment — DELETE
- `client/src/components/admin/UnifiedInbox.tsx` line 5 (file header comment mentions `TodayOverview` as a former entry point — historical context, leave alone unless the wording is misleading; the comment is *"points (TodayOverview, OfficeInboxTab, ChatsTab) with one vertical"*, which is accurate history).
- `client/public/manifest.json` line 38 — `"description": "PACK&GO 後台管理 — TodayOverview + Agent Chats + OpsAgent"`. Update to drop the `TodayOverview` mention (replace with `UnifiedInbox` or rephrase to `Today + Agent Chat + Inbox`).
- `docs/refactor/audit-2026-05-18.md:108-112` (P1-7 entry) — the audit reasoning. Audit flagged this as "deprecation-pending" not "confirmed dead", which is why Jeff yes/no is required.

## Procedure

### Step 0 — Decision gate
Wait for Jeff's yes/no on the rollout-acceptance question (see "Manual intervention"). The remainder of the procedure has two branches:

- **If Jeff says NO (defer to v2):**
  1. Record the deferral in `docs/refactor/progress.md` (Phase 3 / Module 2 / status: `DEFERRED — Jeff requested keeping today-legacy fallback for now; re-evaluate Phase 6`).
  2. Do nothing else. Module is complete.
- **If Jeff says YES (proceed with delete):** continue to step 1.

### Step 1 — Reference scan
```bash
grep -rn "TodayOverview" /Users/jeff/Desktop/網站/server /Users/jeff/Desktop/網站/client /Users/jeff/Desktop/網站/docs
grep -rn "today-legacy" /Users/jeff/Desktop/網站/server /Users/jeff/Desktop/網站/client /Users/jeff/Desktop/網站/docs
```
Expected `TodayOverview` hits (5 in source + plan/audit doc hits):
- `client/src/components/admin/TodayOverview.tsx:2` and `:49` (self-references — going away with the file)
- `client/src/pages/Admin.tsx:81, 82, 84, 151, 381, 385` (all to be deleted in step 3)
- `client/src/components/admin/UnifiedInbox.tsx:5` (historical comment — keep)
- `client/public/manifest.json:38` (description string — fix in step 4)
- `docs/refactor/plan.md` + `docs/refactor/audit-2026-05-18.md` mentions (refactor narrative — leave alone)

Expected `today-legacy` hits (4):
- `client/src/pages/Admin.tsx:107, 109, 152, 384` (all to be deleted in step 3)

**If any OTHER hit appears (e.g., a tRPC route name, an analytics event, a feature-flag key referencing `today-legacy`), STOP. Report to supervisor.**

### Step 2 — Delete the file
```bash
git rm client/src/components/admin/TodayOverview.tsx
```

### Step 3 — Edit `client/src/pages/Admin.tsx`
Make all five edits in a single pass:

1. **Remove the import + preceding comment block (lines 78–85).** Drop the `import TodayOverview…` line and the two surrounding "Round 81 / today-legacy preserves" comment blocks. Above the surviving `import UnifiedInbox`, leave a single concise comment, e.g.: *"Default 'today' landing — single vertical: items → Pulse → activity. (Replaced an earlier TodayOverview pulse page in Round 81; legacy fallback removed in Phase 3 of 2026-05 refactor.)"*

2. **Drop `today-legacy` from the `PageId` union (lines 106–109).** Remove the `| "today-legacy"` line AND the two-line comment immediately above it. Keep `| "today"`.

3. **Drop the IA `advanced` entry (lines 149–152).** Remove the three-line comment AND the `{ id: "today-legacy", label: "舊版總覽" },` entry. `office.advanced` shrinks from 8 entries to 7 — verify trailing-comma / brace integrity.

4. **Drop the `renderPage` switch case (lines 384–385).** Remove the `case "today-legacy":` + its `return <TodayOverview…/>` line. Simplify the `case "today":` comment immediately above (currently mentions "UnifiedInbox replaces TodayOverview") to one short line, e.g. `// Default landing — items, pulse, recent activity in one vertical.`

5. **Re-grep** to confirm zero hits in `Admin.tsx`:
   ```bash
   grep -n "TodayOverview\|today-legacy" client/src/pages/Admin.tsx
   ```
   Expected: no output.

### Step 4 — Update `client/public/manifest.json`
Line 38 description: change
```
"description": "PACK&GO 後台管理 — TodayOverview + Agent Chats + OpsAgent",
```
to:
```
"description": "PACK&GO 後台管理 — Today + Agent Chat + Inbox",
```
This stays under the manifest description length budget and accurately names what users see in the app.

### Step 5 — Verify TypeScript
```bash
pnpm tsc --noEmit
```
Expected: exit 0. The `PageId` union narrowing should be exhaustive — if the switch statement in `renderPage` had a `default` branch that depended on `today-legacy`, it would surface here. (Spot check during step 3: the switch should still be exhaustive.)

### Step 6 — Verify build + tests
```bash
pnpm build
pnpm test
```
Both should succeed; test pass count unchanged.

### Step 7 — Visual smoke
Run `pnpm dev`, log into admin:
- Office → 今日總覽 loads `UnifiedInbox` (already the default — should be unchanged).
- Office → 進階 → confirm the `舊版總覽` chip is GONE.
- Try direct URL `…/admin?page=today-legacy` (if URL params are wired) — should fall back to the default page without console errors.

## Acceptance Criteria
- [ ] **Branch A (Jeff = NO):** `progress.md` records the deferral; no code changes; file remains.
- [ ] **Branch B (Jeff = YES):**
  - [ ] `client/src/components/admin/TodayOverview.tsx` deleted
  - [ ] `grep -rn "TodayOverview"` in `server/` + `client/` returns at most 1 hit (the historical comment in `UnifiedInbox.tsx:5`, which is left intentionally)
  - [ ] `grep -rn "today-legacy"` in `server/` + `client/` returns zero hits
  - [ ] `client/public/manifest.json` no longer mentions `TodayOverview`
  - [ ] `client/src/pages/Admin.tsx`: import gone, `PageId` union no longer has `today-legacy`, IA `office.advanced` entry gone, `renderPage` switch case gone
  - [ ] `pnpm tsc --noEmit` exit 0
  - [ ] `pnpm build` succeeds
  - [ ] `pnpm test` pass count unchanged
  - [ ] Admin smoke: default landing unchanged, `舊版總覽` chip removed from Office advanced

## Deliverable
- Deleted: `client/src/components/admin/TodayOverview.tsx`
- Modified: `client/src/pages/Admin.tsx`, `client/public/manifest.json`
- Single commit:
  ```
  chore(admin): Phase 3 module 2 — delete TodayOverview + today-legacy

  UnifiedInbox replaced TodayOverview as the default "today" landing on
  2026-05-17 evening (Round 81). The legacy file was kept behind a
  "today-legacy" PageId for rollback safety during the rollout window.
  Jeff confirmed the rollout is fully accepted; removing the fallback.

  - Delete client/src/components/admin/TodayOverview.tsx (410 LOC).
  - Remove "today-legacy" from PageId union, IA office.advanced, and
    renderPage switch in Admin.tsx.
  - Update manifest.json description string to match current IA.

  Verification: grep -rn confirms zero residual refs to "today-legacy";
  TodayOverview mentions reduced to one historical comment in
  UnifiedInbox.tsx (kept as deliberate context). tsc + build + test
  green.
  ```

## Rollback
- `git revert <commit-SHA>` restores the file, the PageId case, the IA entry, and the manifest string in one step. No data migration, no DB schema, no API change — pure UI.
- After revert, `today-legacy` becomes routable again exactly as before.

## Manual intervention
**Jeff yes/no gate (5 min, BLOCKING):**

> Has the UnifiedInbox rollout been accepted in production for at least a week without any need to fall back to the old TodayOverview pulse page? If yes, this module deletes the legacy file and the `today-legacy` PageId. If no, we defer to v2 and keep the fallback for another cycle.

- If **YES** → supervisor proceeds with steps 1–7.
- If **NO** → supervisor records `DEFERRED` in `progress.md` (Phase 3 / Module 2) with Jeff's reason, and the module ends as a no-op. Re-evaluate at Phase 6 entry.
- No other manual steps required; no DB ops; no production deploy gate (cosmetic admin-side change).

## Test plan
- No new Vitest. Pure deletion.
- **Regression anchor:** record `pnpm test` pass count BEFORE the deletion commit; confirm same count AFTER.
- **Manual smoke (Branch B only):**
  1. Admin loads, default landing = `UnifiedInbox` (greeting + items + pulse + activity).
  2. Office → 進階 sub-menu: `舊版總覽` chip absent. Other advanced entries (`Agent Chats (舊)`, `舊收件匣`, `AI 中心`, `QA 審查`, `任務記錄`, `審計日誌`, `AI 成本`) all present and clickable.
  3. No console errors when navigating across all 5 domains' primary pages.
