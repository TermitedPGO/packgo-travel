// Hard-delete all 274 tours + all child rows that reference tours.id
// Jeff explicitly authorised this on 2026-05-16: "硬刪所有 274 tours"
// 0 bookings → no FK risk
//
// KEEP intact:
//   - supplierProducts / supplierDepartures (supplier-sync mirror, 56k rows)
//   - any non-tour tables
//
// DRY_RUN=1 default; set DRY_RUN=0 to actually run.
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN !== "0";
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// All tables with tourId column pointing at tours.id (per drizzle/schema.ts grep)
const childTables = [
  "tourReviews",
  "tourDepartures",
  "bookings",
  "bookingParticipants",
  "imageLibrary",         // tourId is nullable — only rows with tourId set get wiped
  "skillApplicationLogs", // tourId nullable
  "userFavorites",
  "userBrowsingHistory",
  "tourStatistics",
  "calibrationResults",
  "marketingMaterials",
  "affiliateClicks",      // tourId nullable
  "tourPriceComparisons",
  "tourMonitorLogs",
  "posterGenLogs",        // tourId nullable
  "agentMessages",        // some rows have tourId
];

// Translations table is special: entityType='tour' rows reference tours.id via entityId
// Delete those separately.

async function safeCount(table, where = "1=1") {
  try {
    const [rows] = await conn.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
    return rows[0].n;
  } catch (e) {
    return `(table missing: ${e.code})`;
  }
}

async function safeDelete(table, where = "1=1") {
  try {
    const [result] = await conn.execute(`DELETE FROM ${table} WHERE ${where}`);
    return result.affectedRows;
  } catch (e) {
    return `(error: ${e.code} ${e.sqlMessage?.slice(0, 80)})`;
  }
}

console.log("=== BEFORE ===");
for (const t of childTables) {
  const count = await safeCount(t, "tourId IS NOT NULL");
  console.log(`  ${t} (tourId rows): ${count}`);
}
console.log(`  translations (entityType='tour'): ${await safeCount("translations", "entityType='tour'")}`);
console.log(`  tours: ${await safeCount("tours")}`);

console.log("\n--- preserved (NOT wiped) ---");
console.log(`  supplierProducts: ${await safeCount("supplierProducts")}`);
console.log(`  supplierDepartures: ${await safeCount("supplierDepartures")}`);

if (DRY_RUN) {
  console.log("\n⚠️  DRY_RUN — set DRY_RUN=0 to actually delete.");
  await conn.end();
  process.exit(0);
}

console.log("\n=== DELETING ===");
for (const t of childTables) {
  const res = await safeDelete(t, "tourId IS NOT NULL");
  console.log(`  ${t}: deleted ${res}`);
}
console.log(`  translations (tour): deleted ${await safeDelete("translations", "entityType='tour' OR entityType='tour_departure'")}`);
console.log(`  tours: deleted ${await safeDelete("tours")}`);

console.log("\n=== AFTER ===");
for (const t of childTables) {
  const count = await safeCount(t, "tourId IS NOT NULL");
  console.log(`  ${t} (tourId rows): ${count}`);
}
console.log(`  translations (entityType='tour'): ${await safeCount("translations", "entityType='tour'")}`);
console.log(`  tours: ${await safeCount("tours")}`);

console.log("\n--- preserved (untouched) ---");
console.log(`  supplierProducts: ${await safeCount("supplierProducts")}`);
console.log(`  supplierDepartures: ${await safeCount("supplierDepartures")}`);

await conn.end();
console.log("\n✅ Wipe complete.");
