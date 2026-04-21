#!/usr/bin/env node
/**
 * Runtime migration runner — invoked by Fly.io's `release_command` before
 * new machines receive traffic. Uses drizzle-orm's built-in MySQL migrator so
 * we don't need `drizzle-kit` (a devDependency) in the production image.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/migrate.mjs
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] FATAL: DATABASE_URL is not set");
  process.exit(1);
}

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
