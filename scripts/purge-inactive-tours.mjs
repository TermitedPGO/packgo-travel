// Hard-delete all status='inactive' tours + their child rows
// 2026-05-16: Jeff asked to fully purge 已下架, not just soft-hide.
// Active tours are untouched.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const DRY_RUN = process.env.DRY_RUN !== "0";
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1) collect ids
const [doomed] = await conn.execute(
  `SELECT id FROM tours WHERE status = 'inactive'`
);
const ids = doomed.map((r) => r.id);
console.log(`Targeting ${ids.length} inactive tours.`);

if (ids.length === 0) {
  console.log("Nothing to purge.");
  await conn.end();
  process.exit(0);
}

// Child tables that reference tours.id
const childTables = [
  "tourReviews", "tourDepartures", "bookings", "imageLibrary",
  "skillApplicationLogs", "userFavorites", "userBrowsingHistory",
  "tourStatistics", "calibrationResults", "marketingMaterials",
  "affiliateClicks", "tourPriceComparisons", "tourMonitorLogs",
  "posterGenLogs",
];
const placeholders = ids.map(() => "?").join(",");

async function safeCount(table, where, params) {
  try {
    const [rows] = await conn.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
    return rows[0].n;
  } catch (e) {
    return `(error: ${e.code})`;
  }
}
async function safeDelete(table, where, params) {
  try {
    const [r] = await conn.execute(`DELETE FROM ${table} WHERE ${where}`, params);
    return r.affectedRows;
  } catch (e) {
    return `(error: ${e.code})`;
  }
}

console.log("\n=== BEFORE (child rows for doomed tours) ===");
for (const t of childTables) {
  console.log(`  ${t}: ${await safeCount(t, `tourId IN (${placeholders})`, ids)}`);
}
console.log(`  translations (tour entity): ${await safeCount("translations", `entityType IN ('tour','tour_departure') AND entityId IN (${placeholders})`, ids)}`);

if (DRY_RUN) {
  console.log("\nDRY_RUN — set DRY_RUN=0 to actually delete.");
  await conn.end();
  process.exit(0);
}

console.log("\n=== DELETING ===");
for (const t of childTables) {
  console.log(`  ${t}: deleted ${await safeDelete(t, `tourId IN (${placeholders})`, ids)}`);
}
console.log(`  translations: deleted ${await safeDelete("translations", `entityType IN ('tour','tour_departure') AND entityId IN (${placeholders})`, ids)}`);
console.log(`  tours: deleted ${await safeDelete("tours", `id IN (${placeholders})`, ids)}`);

console.log("\n=== AFTER ===");
const [counts] = await conn.execute(
  `SELECT status, COUNT(*) AS n FROM tours GROUP BY status ORDER BY n DESC`
);
console.table(counts);

await conn.end();
console.log("\n✅ Purge complete.");
