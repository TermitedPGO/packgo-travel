# v2 · Wave 1 · Module 1.7 — Migration 0077 + remove emergency enum cast

**Parent plan:** docs/refactor/v2-plan.md (Wave 1 · Module 1.6, renumbered here to 1.7 — see report)
**Audit ref:** v2-audit-2026-05-19.md §K "Migration 0070 (emergency enum)" (lines 618-650) — confirmed cast at `server/routers/inquiries.ts:235` "inquiryType: 'emergency' as 'other'"; SQL spec provided in audit lines 638-648.
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1h AI + 5min Jeff approval

## Goal
Add `"emergency"` to the `inquiries.inquiryType` MySQL enum via new migration `0077_inquiry_type_emergency.sql`. Remove the `as "other"` type-narrowing cast at `server/routers/inquiries.ts:235`. After this lands, emergency inquiries are persisted with the correct enum value (not bucketed under `"other"`) — Jeff's admin Inbox can sort `inquiryType: "emergency"` natively instead of grep-matching subject prefix.

## Pre-requisites
- Working tree clean.
- **No dependency on other Wave 1 modules.** Standalone migration.
- Drizzle migrations counter is at **0076** (verified: latest is `drizzle/0076_stripe_webhook_idempotency.sql`). Next number is **0077**.
- Jeff approval before migration runs in prod (Fly `release_command` will apply on next deploy; he should review the SQL).

## Inputs (read these before executing)
- `drizzle/schema.ts` lines 805-820 — current `inquiryType` mysqlEnum declaration:
  ```ts
  inquiryType: mysqlEnum("inquiryType", [
    "general",       // General inquiry
    "custom_tour",   // Custom tour planning
    "visa",          // Visa application service
    "group_booking", // Group booking inquiry
    "complaint",     // Complaint
    "other"
  ]).notNull(),
  ```
  After this module: 7 values including `"emergency"`.
- `server/routers/inquiries.ts` lines 27-40 — leading docstring documents the cast workaround. **Update the docstring** to reflect migration 0077 applied.
- `server/routers/inquiries.ts` lines 229-238 — the actual cast site:
  ```ts
  // TODO(migration 0070): add "emergency" to inquiryType enum in
  // drizzle/schema.ts + corresponding ALTER TABLE migration. Cast
  // is a temporary type-narrowing while migration is pending Jeff
  // approval. ...
  inquiryType: "emergency" as "other",
  ```
  This becomes `inquiryType: "emergency"` after the schema change.
- `server/routers/inquiries.test.ts` — locate the existing `createEmergency` test. **Must update** assertion to expect `inquiryType: "emergency"` (not `"other"`).
- `drizzle/0076_stripe_webhook_idempotency.sql` — example of a recent migration. Follow the same comment-header conventions.
- Migration approach reference: audit lines 638-648 has the SQL Jeff approved:
  ```sql
  ALTER TABLE inquiries
    MODIFY COLUMN inquiryType ENUM(
      'general','custom_tour','visa','group_booking',
      'complaint','emergency','other'
    ) NOT NULL;

  UPDATE inquiries SET inquiryType = 'emergency'
  WHERE inquiryType = 'other' AND subject LIKE '%emergency%';
  ```
- `drizzle.config.ts` — for understanding how journal is updated.
- `drizzle/meta/_journal.json` — must add the 0077 entry.

## Scope (what this module owns)
1. **Modified: `drizzle/schema.ts` line 811-818** — add `"emergency"` to the `inquiryType` enum literal **between** `"complaint"` and `"other"` (so default ordering still puts `"other"` last):
   ```ts
   inquiryType: mysqlEnum("inquiryType", [
     "general", "custom_tour", "visa", "group_booking",
     "complaint", "emergency", "other"
   ]).notNull(),
   ```
2. **New file: `drizzle/0077_inquiry_type_emergency.sql`** with:
   - Header comment block (mirror style of `0076`)
   - `ALTER TABLE inquiries MODIFY COLUMN inquiryType ENUM(...)` adding `'emergency'` between `'complaint'` and `'other'`
   - Backfill `UPDATE` for rows previously persisted as `'other' AND subject LIKE '[緊急%'` (use the actual subject prefix from `createEmergency` — line 227: `subject: '[緊急 · ${labelZh}] ${input.currentLocation}'`). LIKE pattern: `'[緊急%'`.
3. **New file: `drizzle/0077_inquiry_type_emergency.down.sql`** — rollback migration (matches the .down.sql pattern from 0076):
   - `UPDATE inquiries SET inquiryType = 'other' WHERE inquiryType = 'emergency';`
   - `ALTER TABLE inquiries MODIFY COLUMN inquiryType ENUM('general',...,'complaint','other') NOT NULL;`
4. **Modified: `drizzle/meta/_journal.json`** — add 0077 entry (drizzle-kit typically auto-generates this — confirm by running `pnpm drizzle-kit generate` and reviewing the diff).
5. **Modified: `server/routers/inquiries.ts`**:
   - Line 27-40 docstring: remove the "IMPORTANT: cast workaround" block; document instead "Migration 0077 applied — inquiryType: 'emergency' is now a first-class enum value".
   - Line 229-237 inline TODO comment: delete.
   - Line 235: `inquiryType: "emergency" as "other",` → `inquiryType: "emergency",`.
6. **Modified: `server/routers/inquiries.test.ts`** — locate `createEmergency` test; assert `inquiryType: "emergency"` not `"other"`.

## Procedure
1. **Read** the three files: `drizzle/schema.ts` (lines 800-830), `server/routers/inquiries.ts` (lines 1-50 + 220-260), `server/routers/inquiries.test.ts` (find the createEmergency test). Confirm structure.
2. **Edit `drizzle/schema.ts`:** add `"emergency"` to the enum literal.
3. **Generate the migration:**
   ```bash
   cd /Users/jeff/Desktop/網站
   pnpm drizzle-kit generate
   ```
   This should produce `drizzle/0077_<auto_name>.sql` and update `_journal.json`. If the auto-name isn't `inquiry_type_emergency`, **rename it manually** to `0077_inquiry_type_emergency.sql` and update `_journal.json` to match.
4. **Verify the generated SQL.** It should be exactly the ALTER TABLE shown above. If drizzle-kit emits something different (e.g., a DROP-and-RECREATE pattern), STOP and consult Jeff — MySQL ENUM additions are well-supported by `MODIFY COLUMN` and shouldn't need recreation.
5. **Append the backfill UPDATE** to the generated SQL (drizzle-kit won't auto-generate this — it's a data backfill, not a schema diff):
   ```sql
   -- Backfill: prior emergency inquiries persisted as 'other' due to
   -- the as-cast workaround in inquiriesRouter.createEmergency.
   -- Match by createEmergency's subject prefix '[緊急'.
   UPDATE inquiries
     SET inquiryType = 'emergency'
     WHERE inquiryType = 'other' AND subject LIKE '[緊急%';
   ```
6. **Create the `.down.sql`** file manually (drizzle-kit doesn't auto-emit it; mirror `0076_stripe_webhook_idempotency.down.sql`).
7. **Edit `server/routers/inquiries.ts`:**
   - Remove the multi-line `IMPORTANT:` block in the leading docstring (lines 27-33).
   - Remove the inline TODO block (lines 229-234).
   - Change line 235 from `inquiryType: "emergency" as "other",` to `inquiryType: "emergency",`.
8. **Edit `server/routers/inquiries.test.ts`** — update the assertion.
9. **Run tsc:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
   ```
10. **Run tests:**
    ```bash
    pnpm test inquiries
    ```
11. **Apply migration locally (optional dev verification):**
    ```bash
    pnpm drizzle-kit migrate
    ```
    Confirm no errors. Verify in DB:
    ```sql
    SHOW COLUMNS FROM inquiries LIKE 'inquiryType';
    -- Expect: enum('general','custom_tour','visa','group_booking','complaint','emergency','other')
    ```

## Acceptance Criteria
- [ ] `drizzle/0077_inquiry_type_emergency.sql` exists with the ALTER + UPDATE statements.
- [ ] `drizzle/0077_inquiry_type_emergency.down.sql` exists with rollback.
- [ ] `drizzle/meta/_journal.json` includes the 0077 entry.
- [ ] `drizzle/schema.ts` lists `"emergency"` in the `inquiryType` enum.
- [ ] `server/routers/inquiries.ts:235` is `inquiryType: "emergency",` — no more cast.
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test inquiries` green
- [ ] **Per CLAUDE.md §九:** `inquiries.test.ts` has at least one case asserting `createEmergency` result row has `inquiryType: "emergency"`. (Required: this is a test update, not a new test file.)
- [ ] Post-deploy verification (Jeff manual): `SELECT DISTINCT inquiryType FROM inquiries` on prod includes `'emergency'`.
- [ ] Post-deploy verification: any historical row with `subject LIKE '[緊急%'` and `inquiryType='other'` is now `'emergency'` (backfill ran).

## Deliverable
- **New files:**
  - `drizzle/0077_inquiry_type_emergency.sql`
  - `drizzle/0077_inquiry_type_emergency.down.sql`
- **Modified files:**
  - `drizzle/schema.ts`
  - `drizzle/meta/_journal.json` (auto by drizzle-kit)
  - `server/routers/inquiries.ts`
  - `server/routers/inquiries.test.ts`
- **Expected commit message:**
  ```
  feat(db): migration 0077 — add 'emergency' to inquiryType enum

  - drizzle/0077_inquiry_type_emergency.sql: ALTER inquiries.inquiryType
    ENUM adds 'emergency' between 'complaint' and 'other'; UPDATE
    backfill reclassifies rows with subject LIKE '[緊急%' from 'other'
    to 'emergency'
  - schema.ts: enum literal updated to match
  - inquiriesRouter.createEmergency: remove `as "other"` cast (line 235);
    leading docstring TODO + inline TODO blocks removed (now historical)
  - inquiries.test.ts: assertion updated to expect inquiryType:'emergency'

  Resolves migration deferred since round 70 (originally docketed as
  0070 but that slot was reassigned to plaid_accounting; now landing
  as 0077). Emergency inquiries can now be sorted natively in admin
  Inbox instead of subject-string-match.

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.6
  Audit: docs/refactor/v2-audit-2026-05-19.md §K (lines 618-650)
  ```

## Rollback
- `drizzle/0077_inquiry_type_emergency.down.sql` reverses the ALTER + UPDATE.
- **Caveat:** rows that were `inquiryType='emergency'` post-rollback go back to `'other'` (lossy). Acceptable for an immediate rollback within the same day; not safe after a week of new emergency inquiries.
- Code revert: `git revert <SHA>` puts the `as "other"` cast back; harmless if migration is also reverted.

## Manual intervention
1. **Jeff approves migration SQL** (~5min review).
2. **Apply via Fly `release_command`** (already configured per repo's deploy pattern — confirm in `fly.toml`).
3. **Post-deploy verification:** Jeff runs (or Claude runs via admin SQL endpoint if available):
   ```sql
   SELECT inquiryType, COUNT(*) FROM inquiries GROUP BY inquiryType;
   ```
   Expect a row for `'emergency'` (possibly with count > 0 if backfill ran).

## Test plan
- **`server/routers/inquiries.test.ts` — update existing `createEmergency` test:**
  - Existing assertion likely: `expect(inquiry.inquiryType).toBe("other")` or similar.
  - New assertion: `expect(inquiry.inquiryType).toBe("emergency")`.
- **NO new test file** — modification of existing test is sufficient.
- **Regression anchor:** other inquiryType branches (`general`, `custom_tour`, etc.) tests must still pass — verifies the enum modification didn't break existing values.

## Decisions needed (Jeff)
1. **Backfill scope.** Default (per audit + plan): backfill rows with `subject LIKE '[緊急%'`. Alternative: skip backfill (historical rows stay tagged 'other'). Default: run the backfill — small one-time UPDATE.
2. **Migration window.** Default: apply during Wave 1 deploy (Tue-Thu 9-11am PT per plan calendar). MySQL `MODIFY COLUMN` on an enum is fast (metadata-only on small tables) — no expected downtime. Confirm.
3. **`.down.sql` retention.** Default: ship it. v1 phase 2 introduced the .down.sql pattern with 0076; continue.
