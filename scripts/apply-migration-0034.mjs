import mysql from "mysql2/promise";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const sql = fs.readFileSync("drizzle/0034_polite_mimic.sql", "utf-8");
const statements = sql.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  for (const stmt of statements) {
    console.log("Executing:", stmt.substring(0, 80) + "...");
    await conn.execute(stmt);
    console.log("  ✅ OK");
  }
  // Also update drizzle journal
  try {
    const journalPath = "drizzle/meta/_journal.json";
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const migrationFile = "0034_polite_mimic";
    const alreadyExists = journal.entries.some(e => e.tag === migrationFile);
    if (!alreadyExists) {
      journal.entries.push({
        idx: journal.entries.length,
        version: "7",
        when: Date.now(),
        tag: migrationFile,
        breakpoints: true,
      });
      fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
      console.log("✅ Journal updated");
    }
  } catch (e) {
    console.log("⚠️ Journal update skipped:", e.message);
  }
  await conn.end();
  console.log("✅ All migrations applied");
}

run().catch(e => { console.error("❌", e.message); process.exit(1); });
