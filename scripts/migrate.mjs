#!/usr/bin/env node
/**
 * Runtime migration runner — invoked by Fly.io's `release_command` before
 * new machines receive traffic. Uses drizzle-orm's built-in MySQL migrator so
 * we don't need `drizzle-kit` (a devDependency) in the production image.
 *
 * Credential selection (DB 硬化批, 2026-07-12):
 *   Prefer MIGRATION_DATABASE_URL (a DDL-capable `migrator` identity used ONLY
 *   here, in release_command). Fall back to DATABASE_URL when it is unset, so
 *   behaviour is byte-identical to before the split until Jeff provisions the
 *   migrator secret. This is what lets the long-running app process connect as
 *   a CRUD-only `app_runtime` identity (no CREATE/DROP/ALTER) while migrations
 *   still get the DDL grants they need. See docs/infra/db-role-hardening.md.
 *
 * Usage:
 *   MIGRATION_DATABASE_URL=... node scripts/migrate.mjs   # preferred
 *   DATABASE_URL=...           node scripts/migrate.mjs   # fallback (legacy)
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

// Prefer the dedicated migrator credential; fall back to the runtime one.
// `??` (not `||`) so an accidentally-empty-string secret still surfaces rather
// than silently falling through — an empty MIGRATION_DATABASE_URL is a config
// error we want to fail on, not paper over.
const usingMigratorUrl = process.env.MIGRATION_DATABASE_URL != null;
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[migrate] FATAL: neither MIGRATION_DATABASE_URL nor DATABASE_URL is set",
  );
  process.exit(1);
}

// Visibility only — which identity migrations run under. Never logs the URL.
console.log(
  `[migrate] credential source: ${usingMigratorUrl ? "MIGRATION_DATABASE_URL (migrator)" : "DATABASE_URL (fallback)"}`,
);
console.log("[migrate] Connecting to DB...");
const conn = await mysql.createConnection({
  uri: url,
  // TiDB Cloud serverless uses TLS; the URL already includes ?ssl parameter
  // if needed, so we just let mysql2 honour it.
  multipleStatements: true,
});

try {
  const db = drizzle(conn);
  console.log("[migrate] Running migrations from ./drizzle ...");
  const startMs = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`[migrate] ✅ Complete in ${Date.now() - startMs}ms`);
} catch (err) {
  console.error("[migrate] ❌ Failed:", err);
  process.exit(1);
} finally {
  await conn.end();
}
