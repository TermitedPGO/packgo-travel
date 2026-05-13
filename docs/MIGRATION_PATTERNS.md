# Drizzle Migration Patterns — PACK&GO

> Hard-won rules from migration 0070 silently failing on TiDB.
> Read this before writing any new migration under `drizzle/*.sql`.

## The 2026-05-13 Phase 0 incident

**What happened:**
Migration 0070 (Plaid accounting tables) deployed. Fly's release_command
exited 0. `__drizzle_migrations` table gained the row for migration 0070.
Server started. Every `plaid.*` tRPC query then 500'd with `Failed query:
select ... from linkedBankAccounts` — **the tables didn't exist**.

**Root cause:**
The migration SQL wrapped each `CREATE TABLE` in:

```sql
SET @sql := IF(
  NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE ...),
  'CREATE TABLE ... (...)',
  'SELECT ''already exists, skipping'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

The intent was idempotency (rerunnable migration).

The problem is that **TiDB Cloud silently no-ops DDL inside a PREPARE/EXECUTE
block when the prepared statement was constructed via `IF()` returning a
string literal**. The query returns success. drizzle-orm's MySQL migrator
sees no error and inserts the migration tracking row. Production now has
a "applied" migration with zero tables created.

**Recovery:**
Manual SSH + `CREATE TABLE IF NOT EXISTS …` for each table. ~5 minutes,
but only because we caught it during the same session as the deploy. Had
we shipped a customer-visible feature behind this migration, it would
have been a P0 incident with no observability hint (release_command was
exit 0).

## A SECOND independent bug from the same incident

While fixing the SQL, we found another root cause for why 0070 wasn't even
attempted on prod:

```json
// drizzle/meta/_journal.json — BAD
{ "idx": 69, "when": 1778900000000, "tag": "0069_...", "breakpoints": true },
{ "idx": 70, "when": 1778628509363, "tag": "0070_plaid_accounting", ... }
                  // ↑ OLDER than 0069's `when`
```

drizzle's MySQL migrator scans `__drizzle_migrations` for the highest
`created_at` and skips any journal entry whose `when <= maxCreatedAt`.
If 0070's `when` is less than 0069's, drizzle treats 0070 as "already
applied" and silently skips it. No row inserted into `__drizzle_migrations`
either — which explains why our prod migration count was 70 (idx 0..69)
even after deploy.

**Rule 4 (added 2026-05-13):** Every journal entry's `when` field MUST be
strictly greater than the previous entry's. Drizzle-kit generates these
correctly when you use `drizzle-kit generate` — manual edits to
_journal.json are the bug surface. If you hand-author a journal entry,
use `Date.now()` and verify it's > the previous row's `when`.

## The 3 rules

### Rule 1 — Use `CREATE TABLE IF NOT EXISTS`, never the PREPARE/IF pattern

✅ DO:
```sql
CREATE TABLE IF NOT EXISTS `myTable` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  ...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

❌ DON'T:
```sql
SET @sql := IF(NOT EXISTS(...), 'CREATE TABLE ...', 'SELECT ''skip''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

TiDB supports `CREATE TABLE IF NOT EXISTS` natively. It's the same
idempotency contract without the prepared-statement layer that silently
fails.

For column additions, MySQL doesn't have `ADD COLUMN IF NOT EXISTS` but
TiDB does — and we are TiDB. Use it:

✅ DO:
```sql
ALTER TABLE `myTable` ADD COLUMN IF NOT EXISTS `newCol` VARCHAR(128);
```

If you must support non-TiDB MySQL too (we don't, currently), use the
information_schema check pattern WITHOUT PREPARE:

```sql
-- check first, decide whether to ALTER in the application before generating SQL
```

…and generate the SQL at build time rather than at runtime.

### Rule 2 — Use `--> statement-breakpoint` between statements

drizzle's MySQL migrator splits the migration file on this exact comment
marker and runs each chunk as a separate `query()`. Without breakpoints,
multi-statement files get sent as a single string and rely on
`multipleStatements: true` to work — which is brittle on TiDB.

Migration's `_journal.json` records `breakpoints: true` for the migration
— honor that with actual breakpoints in the SQL:

```sql
CREATE TABLE IF NOT EXISTS `tableA` (...) ENGINE=InnoDB ...;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `tableB` (...) ENGINE=InnoDB ...;
```

### Rule 3 — Verify after deploy, don't trust release_command exit code

`flyctl deploy` printing `release_command completed successfully` is
**necessary but not sufficient** evidence that the migration ran. Always
spot-check immediately after:

```bash
flyctl ssh console -a packgo-travel -C \
  "sh -c 'cd /app && node -e \"import(\\\"mysql2/promise\\\").then(async m => {
    const c = await m.createConnection({uri: process.env.DATABASE_URL});
    const [r] = await c.execute(\\\"SHOW TABLES LIKE \\x27%newTable%\\x27\\\");
    console.log(JSON.stringify(r));
    await c.end();
  })\"'"
```

For a column-added migration, `SHOW COLUMNS FROM tableName LIKE 'newCol'`.

If the table/column isn't there but `__drizzle_migrations` has the row,
you've hit the silent-failure pattern. Fix-forward:

1. Manually `CREATE TABLE IF NOT EXISTS …` or `ALTER TABLE …` via SSH
2. Rewrite the migration SQL to remove the PREPARE/IF pattern
3. Commit the rewrite — drizzle won't re-run it (hash already in table)
4. Future deploys are clean

## When you actually need conditional DDL

Three real reasons to need "if exists" gating:

1. **Re-running the same migration on a fresh DB** — solved by `IF NOT EXISTS` keyword (Rule 1).

2. **Multi-env where prod already has the table but dev doesn't** — usually means your migration history is corrupted. Run a script to compare both DBs and emit a manual reconciliation migration, not a runtime gate.

3. **Renaming a column** — there is no `IF EXISTS` for column renames. Use two migrations: `ADD COLUMN IF NOT EXISTS newCol`, copy data in a deploy, then `DROP COLUMN IF EXISTS oldCol` in a later one.

## When you must run dynamic SQL anyway

If you're certain you need PREPARE/EXECUTE (e.g. building DDL from a config
table — rare):

1. Run a SELECT before the PREPARE to confirm the desired DDL string.
2. After the EXECUTE, query `SHOW WARNINGS` and fail the migration if any
   exist.
3. After the migration, the migrate.mjs script should `SHOW TABLES LIKE`
   the expected names and `process.exit(1)` if they're missing.

We have NOT implemented (3) yet. Adding it would catch a future silent
failure at deploy time rather than at first user click. Tracked as a
follow-up but lower-priority than just following Rule 1.

## See also

- `scripts/migrate.mjs` — runtime migration runner invoked by Fly release_command
- `drizzle/meta/_journal.json` — drizzle's manifest of migration order
- `drizzle/0070_plaid_accounting.sql` — the migration that caused this doc
