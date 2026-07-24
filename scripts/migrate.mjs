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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

// 憑證遮蔽的正規式(URL 解析失敗時的退場網)。
// 舊版只有一條 /([a-z][a-z0-9+.-]*:\/\/)[^\s\/@]*:[^\s\/@]*@/,問題是 password 段的
// [^\s\/@]* 遇到裸 @ 就停手 —— 密碼是 p@ssXXXX 時只遮到第一個 @(mysql://***:***@ssXXXX@host),
// 後半段 ssXXXX 整個外洩。改成同一行貪婪吃到【最後一個】@,含 @ 的密碼也整段遮掉。
const RE_URL_SAMELINE = /([a-z][a-z0-9+.-]*:\/\/)[^\r\n]*@/gi;
// 憑證被折行(終端機/編輯器折行)時,退回吃到第一個 @,長度設上限免得吃掉整篇。
const RE_URL_MULTILINE = /([a-z][a-z0-9+.-]*:\/\/)[^@]{1,512}@/gi;
// 沒有 :// 的 user:pw@host 形狀(連線字串少一條斜線時漏出來的就是這種)。
// 前置那組是邊界字元,不吃 scheme 的 `:` 與 `/`,已遮成 ***:***@ 的字串不會被再啃。
const RE_BARE_SAMELINE =
  /(^|[^A-Za-z0-9._~%+\-:/])([A-Za-z0-9._~%+-]{1,64}):([^\s@/]{1,256})@/g;
const RE_BARE_MULTILINE =
  /(^|[^A-Za-z0-9._~%+\-:/])([A-Za-z0-9._~%+-]{1,64}):([^@]{0,256}[\r\n][^@]{0,256})@/g;

/**
 * 把 scheme://user:password@host 這種憑證從任何字串裡遮掉。
 *
 * 先試「整條就是一條 URL」的情況:交給 Node 的 URL 解析器把帳密清成 ***,這條路
 * 不管密碼裡有幾個 @ 都吃得下(URL 解析器認得 userinfo 的邊界)。解析失敗(憑證夾在
 * 錯誤訊息中間、或形狀不是單獨一條 URL)才退回上面的正規式。
 */
export const redact = (s) => {
  const str = String(s ?? "");
  const trimmed = str.trim();
  if (trimmed) {
    try {
      const u = new URL(trimmed);
      if (u.username || u.password) {
        u.username = "***";
        u.password = "***";
        return u.toString();
      }
    } catch {
      /* 不是單獨一條 URL,往下走正規式 */
    }
  }
  return str
    .replace(RE_URL_SAMELINE, "$1***:***@")
    .replace(RE_URL_MULTILINE, "$1***:***@")
    .replace(RE_BARE_SAMELINE, "$1***:***@")
    .replace(RE_BARE_MULTILINE, "$1***:***@");
};

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

// 只有被直接執行(Fly 的 release_command 跑 `node scripts/migrate.mjs`)時才連線與
// migrate;被 import(redact 的 regression 測試)時只提供上面的純函式,不碰資料庫。
// 用 resolve + fileURLToPath 比對(同 canary 腳本、同 safe-deploy.mjs 的寫法):
// repo 路徑含中文,手工拼 file:// URL 會因百分號編碼差異比對不到。
// 直接執行時的行為與這道 guard 之前 byte-identical(env、連線、migrate、退場碼全不變)。
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
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
}
