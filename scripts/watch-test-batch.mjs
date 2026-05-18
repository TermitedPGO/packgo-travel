// Watch the 30-tour test batch — status counts + calibration distribution
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [statusCounts] = await conn.execute(
  `SELECT status, COUNT(*) AS n FROM tours GROUP BY status ORDER BY n DESC`
);
console.log("=== Status counts ===");
console.table(statusCounts);

const [calBuckets] = await conn.execute(
  `SELECT
     CASE
       WHEN calibrationScore IS NULL THEN '(processing)'
       WHEN calibrationScore >= 90 THEN '90+'
       WHEN calibrationScore >= 80 THEN '80-89'
       WHEN calibrationScore >= 60 THEN '60-79'
       ELSE '<60'
     END AS bucket,
     status,
     COUNT(*) AS n
   FROM tours
   GROUP BY bucket, status
   ORDER BY bucket DESC, status`
);
console.log("\n=== Calibration buckets ===");
console.table(calBuckets);

// Verdict (calibrationVerdict column)
const [verdicts] = await conn.execute(
  `SELECT calibrationVerdict, status, COUNT(*) AS n
   FROM tours
   WHERE calibrationVerdict IS NOT NULL
   GROUP BY calibrationVerdict, status
   ORDER BY calibrationVerdict, status`
);
console.log("\n=== Verdict × status ===");
console.table(verdicts);

// Quick quality sample of any active tours so far
const [sample] = await conn.execute(
  `SELECT id, status, calibrationScore, calibrationVerdict,
          destinationCountry, destinationCity, title,
          LENGTH(description) AS descLen, poeticTitle
   FROM tours
   WHERE status = 'active'
   ORDER BY id DESC
   LIMIT 10`
);
console.log("\n=== Active tour sample ===");
for (const r of sample) {
  console.log(`#${r.id} ${r.calibrationScore} ${r.calibrationVerdict} | ${r.destinationCountry}/${r.destinationCity} | descLen=${r.descLen} | ${r.title?.slice(0, 50)}`);
  console.log(`    poetic: ${r.poeticTitle}`);
}

// Drift suspects (active + non-日本 country)
const [drift] = await conn.execute(
  `SELECT id, destinationCountry, destinationCity, calibrationScore, title
   FROM tours
   WHERE status = 'active' AND destinationCountry NOT IN ('日本', '')
   ORDER BY id DESC LIMIT 20`
);
console.log("\n=== Drift suspects (active non-日本) ===");
if (drift.length === 0) {
  console.log("  (none) ✓");
} else {
  for (const r of drift) {
    console.log(`#${r.id} cal=${r.calibrationScore} ${r.destinationCountry}/${r.destinationCity} | ${r.title?.slice(0, 60)}`);
  }
}

// Placeholder detection
const [placeholder] = await conn.execute(
  `SELECT COUNT(*) AS n FROM tours
   WHERE status = 'active'
     AND (description = '探索精彩行程，體驗難忘旅程。'
          OR poeticTitle REGEXP '^[一-鿿]+[0-9]+日精選之旅$')`
);
console.log(`\n=== Active tours with placeholder content: ${placeholder[0].n} ===`);

await conn.end();
