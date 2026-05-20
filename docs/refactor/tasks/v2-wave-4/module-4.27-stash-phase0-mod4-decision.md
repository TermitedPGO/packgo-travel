# v2 · Wave 4 · Module 4.27 — Stash `phase0/mod4/root-check-scripts` decision

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish, §Module 4.26 tail) + Stage 3 entry decision #8
**Audit ref:** v2-audit-2026-05-19.md §K lines 653-667 (stash with 6 root-level check_*.mjs scripts)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO — **Jeff-only triage decision; AI-side cheap**
**Est. effort:** 30 min AI + 30 min Jeff review
**Deploy window:** any time — repo hygiene only

## Goal

Resolve the dormant `phase0/mod4/root-check-scripts` git stash. Per Stage 3 entry decision #8 default: **drop** unless Jeff identifies reusable content. This module:
1. Inspects the stash contents (a list of 6 check_*.mjs files at repo root, per audit §K line 657).
2. Jeff decides per-file: keep / archive / delete.
3. Applies the decision; clears the stash.

## Pre-requisites

- All other Wave 4 modules merged (so we're not racing other ongoing work).
- Module 4.23 (scripts purge) merged — establishes the `scripts/_archive/2026-Q2/` location for archives.
- Working tree clean.

## Inputs (read these before executing)

- The stash itself: `git stash list` → confirm 1 entry with name `phase0/mod4/root-check-scripts`.
- `git stash show -p stash@{0}` — full diff inspection.
- Audit §K line 655-667 — context: 6 ad-hoc check scripts at repo root from Phase 0 WIP.

## Scope (what this module owns)

- ✅ Inspect stash content.
- ✅ Triage each file (Jeff decides).
- ✅ Apply or drop the stash.
- ✅ If applying: move each script per its decision (delete / archive / promote to admin endpoint stub).
- ❌ NOT in scope: implementing admin endpoint replacements for any script Jeff wants to keep functional (file separate v3 task).

## Procedure

1. **Inspect the stash:**
   ```bash
   git stash list
   git stash show -p stash@{0} | head -200
   git stash show --stat stash@{0}
   ```
   Document the 6 files + size + intent (from script comments).

2. **Present triage matrix to Jeff:**
   For each file, table form:
   | File | Size | Apparent intent | Recommendation |
   |---|---|---|---|
   | (e.g.) check_tour_data.mjs | 2 KB | One-shot tour data validation | Archive |
   | check_membership.mjs | 1.5 KB | Sanity check on membership rows | Delete (no recurring use) |
   | ... | ... | ... | ... |

3. **Jeff decides per file** (one of):
   - **Delete:** file goes away forever.
   - **Archive:** move to `scripts/_archive/2026-Q2/phase0-mod4/`.
   - **Promote:** keep at root for now; file v3 task to convert to admin endpoint.

4. **Apply the stash to working tree:**
   ```bash
   git stash apply stash@{0}
   ```
   The 6 files now exist as untracked changes.

5. **Per Jeff's decisions, execute:**
   ```bash
   # For each "delete":
   rm <file>
   # For each "archive":
   mv <file> scripts/_archive/2026-Q2/phase0-mod4/
   # For each "promote":
   git add <file> -- leave at root
   ```

6. **Drop the stash:**
   ```bash
   git stash drop stash@{0}
   git stash list  # should be empty
   ```

7. **Commit:** see deliverable section.

## Acceptance Criteria

- [ ] `git stash list` returns empty.
- [ ] Per-file decisions documented in commit message (Jeff approved).
- [ ] Archived files (if any) live under `scripts/_archive/2026-Q2/phase0-mod4/`.
- [ ] Deleted files (if any) are gone.
- [ ] Promoted files (if any) at root with TODO comment + v3 follow-up task filed.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm test` green.

## Deliverable

- Modified: per Jeff's decisions (mix of delete + move + keep).

**Commit message:**

```
chore(stash): Wave 4 module 4.27 — resolve phase0/mod4/root-check-scripts stash

Per Stage 3 entry decision #8 + Jeff triage:

- check_tour_data.mjs       → archived (one-shot, kept for audit trail)
- check_membership.mjs      → deleted (no recurring use)
- check_payments.mjs        → archived
- check_users.mjs           → deleted
- check_inquiries.mjs       → promoted (TODO: v3 admin endpoint)
- check_audit_log.mjs       → archived

(Adjust per Jeff's actual decisions during this module's execution.)

git stash dropped; repo no longer carries the Phase 0 WIP stash.

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.27, audit §K lines 653-667
```

## Rollback

- If Jeff regrets a deletion: `git stash list` is empty after this module, BUT the stash content is recoverable from `git fsck --no-reflog --lost-found` within ~30 days. Document this in case.
- For archived files: a single `git revert` brings them back to original location.

## Manual intervention

- **Jeff (CRITICAL, ~20 min):** review the 6 scripts (supervisor presents inline diff) → make per-file decision (delete/archive/promote).
- **Jeff (~5 min):** sign off final commit message.

## Test plan

**No Vitest** — repo hygiene.

**Manual smoke:**
- `pnpm build` succeeds (no broken references).
- `pnpm test` green.
- `git stash list` empty.

## Decisions needed (Jeff)

1. **Per-file decisions** — the actual triage table (6 rows) — Jeff fills in during execution.
2. **`scripts/_archive/2026-Q2/phase0-mod4/` sub-folder vs flat** — recommend sub-folder so the Phase 0 origin is visible. Lock.
3. **Stash recoverability** — if Jeff later finds a script he deleted should have been kept, `git fsck --lost-found` within 30 days. Confirm Jeff aware before commit.
