// EMERGENCY: pull 63 placeholder-content Japan tours off the public site
// Identified by: description == "探索精彩行程，體驗難忘旅程。" (ContentAnalyzer fallback)
// 2026-05-16
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const PLACEHOLDER = "探索精彩行程，體驗難忘旅程。";
const DRY_RUN = process.env.DRY_RUN !== "0"; // default = dry-run unless DRY_RUN=0

const [before] = await conn.execute(
  `SELECT id, title, calibrationScore, destinationCountry, destinationCity
   FROM tours
   WHERE status = 'active' AND description = ?
   ORDER BY id ASC`,
  [PLACEHOLDER]
);
console.log(`Found ${before.length} active tours with placeholder description.`);
for (const r of before) {
  console.log(`  #${r.id}  cal=${r.calibrationScore}  ${r.destinationCountry}/${r.destinationCity}  ${r.title?.slice(0,50)}`);
}

if (DRY_RUN) {
  console.log("\nDRY RUN — set DRY_RUN=0 to actually flip status=inactive.");
} else {
  const [result] = await conn.execute(
    `UPDATE tours SET status = 'inactive'
     WHERE status = 'active' AND description = ?`,
    [PLACEHOLDER]
  );
  console.log(`\n✅ Updated ${result.affectedRows} rows to status='inactive'.`);
}

await conn.end();
