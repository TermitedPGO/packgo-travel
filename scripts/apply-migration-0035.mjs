import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = readFileSync(
  join(__dirname, "../drizzle/0035_flaky_victor_mancha.sql"),
  "utf-8"
);

const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const conn = await mysql.createConnection(DATABASE_URL);

for (const stmt of statements) {
  try {
    console.log("Executing:", stmt.slice(0, 80) + "...");
    await conn.execute(stmt);
    console.log("  ✅ OK");
  } catch (err) {
    if (err.code === "ER_TABLE_EXISTS_ERROR") {
      console.log("  ⚠️  Table already exists, skipping");
    } else {
      console.error("  ❌ Error:", err.message);
    }
  }
}

await conn.end();
console.log("Migration 0035 complete.");
