// Verify migration 0075 applied — check new tables + columns exist
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

for (const t of ["tourGroupNotes", "customerDocuments", "membershipTrials"]) {
  try {
    const [r] = await c.execute(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ✓ ${t}: ${r[0].n} rows`);
  } catch (e) { console.log(`  ✗ ${t}: ${e.message}`); }
}

for (const [table, col] of [
  ["tourDepartures", "opsStatus"],
  ["tourDepartures", "internalCode"],
  ["tourDepartures", "groupName"],
  ["customerProfiles", "preferences"],
  ["customerProfiles", "keyFacts"],
  ["customerProfiles", "jeffPersonalNote"],
  ["users", "inquiryCount"],
  ["users", "bookingCount"],
  ["users", "plusTrialUsedAt"],
]) {
  const [r] = await c.execute(`SHOW COLUMNS FROM ${table} LIKE ?`, [col]);
  console.log(`  ${r.length ? "✓" : "✗"} ${table}.${col}`);
}
await c.end();
