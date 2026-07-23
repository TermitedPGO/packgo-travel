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

/** 把 scheme://user:password@host 這種憑證從任何字串裡遮掉。 */
const redact = (s) =>
  String(s ?? "").replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]*@/gi,
    "$1***:***@",
  );

/**
 * 日誌安全的錯誤摘要。絕不印原始 error 物件:Node 與 mysql2 會把完整連線字串
 * 掛在 own enumerable 屬性上(例如 ERR_INVALID_URL 帶 `input`),console.error(err)
 * 會把它連同密碼一起印進 Fly 的 release_command 日誌。
 */
const errSummary = (e) => {
  if (!e || typeof e !== "object") return "(non-Error thrown)";
  const parts = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno != null) parts.push(`errno=${e.errno}`);
  if (e.sqlState) parts.push(`sqlState=${e.sqlState}`);
  const msg = redact(String(e.message ?? "").split("\n")[0]);
  if (msg) parts.push(`msg=${msg}`);
  if (e.sql) parts.push(`sql=${redact(String(e.sql)).slice(0, 200)}`);
  return parts.length ? parts.join(" ") : "(no code/message)";
};

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
// 連線建立必須自己包 try:放在 try 外面時,連線字串格式錯誤會走 Node 未捕捉
// 例外路徑,把帶密碼的完整 URL(ERR_INVALID_URL 的 `input` 屬性)印進部署日誌。
let conn;
try {
  conn = await mysql.createConnection({
    uri: url,
    // TiDB Cloud serverless uses TLS; the URL already includes ?ssl parameter
    // if needed, so we just let mysql2 honour it.
    multipleStatements: true,
  });
} catch (err) {
  console.error(`[migrate] ❌ FATAL: cannot connect — ${errSummary(err)}`);
  process.exit(1);
}

try {
  const db = drizzle(conn);
  console.log("[migrate] Running migrations from ./drizzle ...");
  const startMs = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`[migrate] ✅ Complete in ${Date.now() - startMs}ms`);
} catch (err) {
  console.error(`[migrate] ❌ Failed: ${errSummary(err)}`);
  process.exit(1);
} finally {
  await conn.end();
}
