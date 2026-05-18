# Phase 3 · Module 1 · Delete FloatingOpsAgent

**Parent plan:** docs/refactor/plan.md (Phase 3 · Dead Code Purge)
**Audit ref:** P1-7 (confirmed-dead half)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 0.5 h AI + 0 h Jeff review (no Jeff gate — file already retired)

## Goal
Delete the now-orphaned `FloatingOpsAgent.tsx` and scrub the four stale comments that still reference it. The component was deprecated when `AgentChatPage` was committed (commit `4ef11ca` says explicitly: *"FloatingOpsAgent retired. The slide-out Sheet was Jeff's first ask but on review he preferred the Claude-Code-style full-page chat… FloatingOpsAgent.tsx file stays in the repo until next cleanup pass"*). This module IS that next cleanup pass.

## Pre-requisites
- Phase 0 complete (clean `git status`; no in-flight WIP touching `FloatingOpsAgent.tsx`)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0 — so we have a clean baseline to revert to if a hidden import surfaces)
- Verify `AgentChatPage` + `UnifiedInbox` are mounted and functional in `client/src/pages/Admin.tsx` (they are — `agent-chat` PageId at line 386, `today` PageId at line 380). No Jeff yes/no gate needed: the file is unmounted dead weight.

## Inputs (read these before executing)
- `client/src/components/admin/FloatingOpsAgent.tsx` — the file being deleted (484 LOC, last touched 2026-05-17). Only `export default function FloatingOpsAgent()` — no other exports to worry about.
- `client/src/pages/Admin.tsx` — confirm `FloatingOpsAgent` is NOT imported (it isn't, as of current HEAD), but four stale comment blocks still mention it:
  - Line 87–91 (import-area banner: *"Round 81 (2026-05-18) — AgentChatPage replaces FloatingOpsAgent…"*)
  - Line 134–136 (inside `IA.office.primary` comment: *"FloatingOpsAgent was retired"*)
  - Line 365–372 (post-`</div>` block comment: *"Round 81 (2026-05-18) — FloatingOpsAgent retired…"*)
- `client/src/components/admin/UnifiedInbox.tsx` line 16 (comment: *"OpsAgent is NOT here — it lives in FloatingOpsAgent…"*) — stale, must be updated to point at `AgentChatPage` instead.
- `client/src/components/admin/AgentChatPage.tsx` line 5 (comment: *"Sheet (FloatingOpsAgent) per Jeff's feedback…"*) — historically accurate, can stay (it's documenting WHY AgentChatPage replaced FloatingOpsAgent). Leave alone.

## Procedure

1. **Reference scan (pre-delete safety check).** Run the residual-reference grep:
   ```bash
   grep -rn "FloatingOpsAgent" /Users/jeff/Desktop/網站/server /Users/jeff/Desktop/網站/client
   ```
   Expected: exactly 5 hits, all inside the four files listed in Inputs:
   - `client/src/components/admin/FloatingOpsAgent.tsx:2` (self-reference in JSDoc)
   - `client/src/components/admin/FloatingOpsAgent.tsx:72` (`export default function FloatingOpsAgent()`)
   - `client/src/components/admin/AgentChatPage.tsx:5` (historical comment — keep)
   - `client/src/components/admin/UnifiedInbox.tsx:16` (stale comment — fix in step 3)
   - `client/src/pages/Admin.tsx:87`, `:90`, `:135`, `:366`, `:370` (four stale comment blocks — fix in step 4)

   **If any OTHER hit appears (e.g., a `<FloatingOpsAgent />` JSX usage, or a fresh `import FloatingOpsAgent`), STOP. Report to supervisor. Do not proceed with deletion.**

2. **Delete the file.**
   ```bash
   git rm client/src/components/admin/FloatingOpsAgent.tsx
   ```

3. **Fix the UnifiedInbox stale comment** (`client/src/components/admin/UnifiedInbox.tsx` line 16). Replace the line that reads:
   ```
   * OpsAgent is NOT here — it lives in FloatingOpsAgent (always-accessible
   ```
   with:
   ```
   * OpsAgent is NOT here — it lives in AgentChatPage (the "Agent Chat"
   ```
   Update the surrounding sentence so it still parses (e.g., *"… it lives in AgentChatPage (the 'Agent Chat' tab in Office primary). UnifiedInbox is state-focused: items needing decisions, not free-form conversation."*).

4. **Scrub the four Admin.tsx comment blocks.** Replace each of these with a single one-line acknowledgement so the historical narrative is preserved without active deprecation markers:
   - **Lines 87–91** (import-area banner above `import AgentChatPage`): collapse to:
     ```
     // Full-page agent chat (Claude-Code style). Mounted as Office "agent-chat"
     // PageId. Replaced the slide-out Sheet pattern in Round 81 (2026-05-18).
     ```
   - **Lines 134–136** (inside `IA.office.primary` block): collapse the *"FloatingOpsAgent was retired"* aside to:
     ```
     // Office primary = inbox (state + decisions) + chat (free-form agent
     // conversation).
     ```
   - **Lines 365–372** (post-`</div>` block in JSX): delete the entire `{/* Round 81 (2026-05-18) — FloatingOpsAgent retired… */}` comment block. The component is gone; the comment was a placeholder explaining why nothing was mounted there. With the file deleted, no explanation is needed.

5. **Verify TypeScript still compiles.**
   ```bash
   pnpm tsc --noEmit
   ```
   Expected: exit 0. If anything errors, the most likely cause is a hidden lazy-import we missed in step 1 — restore the file with `git checkout HEAD -- client/src/components/admin/FloatingOpsAgent.tsx` and re-run the grep.

6. **Verify build.**
   ```bash
   pnpm build
   ```
   Expected: success. This catches `React.lazy()` or `import()` style dynamic refs that `tsc` misses.

7. **Verify tests.**
   ```bash
   pnpm test
   ```
   Expected: same pass count as before deletion (regression anchor). No new tests added — pure deletion.

8. **Visual smoke.** Run `pnpm dev`, log into admin, click through Office → 今日總覽, Office → Agent Chat, then one page from each of Ops / Customers / Marketing / Finance. Confirm no console errors, no "Failed to load chunk" messages, no broken nav links.

## Acceptance Criteria
- [ ] `client/src/components/admin/FloatingOpsAgent.tsx` no longer exists (`ls` returns `No such file`)
- [ ] `grep -rn "FloatingOpsAgent" /Users/jeff/Desktop/網站/server /Users/jeff/Desktop/網站/client` returns exactly 1 hit: `AgentChatPage.tsx:5` (the historical comment we deliberately kept). All other references gone.
- [ ] `client/src/components/admin/UnifiedInbox.tsx` line 16 no longer says `FloatingOpsAgent`; now references `AgentChatPage`.
- [ ] `client/src/pages/Admin.tsx` no longer contains the string `FloatingOpsAgent` anywhere.
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` pass count unchanged
- [ ] Admin panel loads in dev with no console errors

## Deliverable
- Deleted: `client/src/components/admin/FloatingOpsAgent.tsx`
- Modified: `client/src/components/admin/UnifiedInbox.tsx`, `client/src/pages/Admin.tsx`
- Single commit:
  ```
  chore(admin): Phase 3 module 1 — delete retired FloatingOpsAgent

  Commit 4ef11ca (Round 81, 2026-05-18) retired FloatingOpsAgent in
  favor of AgentChatPage (the "agent-chat" PageId mounted in Office
  primary) but left the file in the repo "until next cleanup pass".
  This is that pass.

  - Delete client/src/components/admin/FloatingOpsAgent.tsx (484 LOC).
  - Scrub four stale comment blocks in Admin.tsx that still narrate the
    deprecation.
  - Fix UnifiedInbox.tsx:16 stale reference (OpsAgent now lives in
    AgentChatPage, not FloatingOpsAgent).

  Verification: grep -rn FloatingOpsAgent leaves only the historical
  comment in AgentChatPage.tsx:5 (kept intentionally — documents WHY
  the Sheet pattern was replaced). pnpm tsc + build + test green.
  ```

## Rollback
- `git revert <commit-SHA>` restores the file and all four comment blocks. No data migration, no schema change — pure UI code. Single-step rollback.
- The component is unmounted so there is no in-flight user session to consider.

## Manual intervention
- **None required.** This is a confirmed-dead file (no JSX mount, no import in any active code path). Supervisor proceeds without Jeff approval.
- If the step-1 grep returns an unexpected reference, escalate to supervisor — do NOT delete blindly.

## Test plan
- No new Vitest. Pure deletion.
- **Regression anchor:** record `pnpm test` pass count BEFORE the deletion commit (e.g., "X/X passing"); confirm same count AFTER.
- **Manual smoke:** dev server admin walkthrough — Office (Today + Agent Chat tabs), Ops landing, Customers landing, Marketing landing, Finance landing. Each should load without console errors.
