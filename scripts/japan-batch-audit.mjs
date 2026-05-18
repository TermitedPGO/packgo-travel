// Japan bulk-import LLM rewrite progress audit
// 2026-05-16: check what came out of the Japan keyword push
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // 1) Overall status counts among the new batch (id > 1140030 — pre-batch high-water mark)
  const [statusRows] = await conn.execute(
    `SELECT status, COUNT(*) AS n
     FROM tours
     WHERE id > 1140030
     GROUP BY status
     ORDER BY n DESC`
  );
  console.log("=== Status distribution (id > 1140030) ===");
  console.table(statusRows);

  // 2) Destination country distribution among ACTIVE new tours
  const [destRows] = await conn.execute(
    `SELECT
       destinationCountry,
       COUNT(*) AS n
     FROM tours
     WHERE id > 1140030 AND status = 'active'
     GROUP BY destinationCountry
     ORDER BY n DESC`
  );
  console.log("\n=== Destination country (active new tours) ===");
  console.table(destRows);

  // 3) Calibration score bucket among new ACTIVE
  const [calRows] = await conn.execute(
    `SELECT
       CASE
         WHEN calibrationScore >= 100 THEN '100'
         WHEN calibrationScore >= 90  THEN '90-99'
         WHEN calibrationScore >= 80  THEN '80-89'
         WHEN calibrationScore >= 70  THEN '70-79'
         WHEN calibrationScore >= 60  THEN '60-69'
         WHEN calibrationScore IS NULL THEN '(null)'
         ELSE '<60'
       END AS bucket,
       COUNT(*) AS n
     FROM tours
     WHERE id > 1140030 AND status = 'active'
     GROUP BY bucket
     ORDER BY bucket DESC`
  );
  console.log("\n=== Calibration buckets (active new tours) ===");
  console.table(calRows);

  // 4) Suspicious non-日本 active tours (the drift candidates)
  const [driftRows] = await conn.execute(
    `SELECT id, title, destinationCountry, destinationCity, calibrationScore, status
     FROM tours
     WHERE id > 1140030
       AND status = 'active'
       AND destinationCountry <> '日本'
     ORDER BY id DESC
     LIMIT 40`
  );
  console.log("\n=== Active tours NOT marked 日本 (drift suspects) ===");
  console.table(driftRows);

  // 5) Active Japan tours with calibration <= 85 (borderline)
  const [borderlineRows] = await conn.execute(
    `SELECT id, title, destinationCountry, destinationCity, calibrationScore
     FROM tours
     WHERE id > 1140030
       AND status = 'active'
       AND destinationCountry = '日本'
       AND calibrationScore <= 85
     ORDER BY calibrationScore ASC, id DESC
     LIMIT 30`
  );
  console.log("\n=== Borderline Japan tours (cal ≤ 85) ===");
  console.table(borderlineRows);

  // 6) Failed / stuck drafts among the new batch (anything not active and not inactive)
  const [oddRows] = await conn.execute(
    `SELECT id, status, title, destinationCountry, calibrationScore
     FROM tours
     WHERE id > 1140030 AND status NOT IN ('active','inactive')
     ORDER BY id DESC
     LIMIT 30`
  );
  console.log("\n=== Non-terminal status (pending_review / generating / failed) ===");
  console.table(oddRows);

  // 7) BullMQ-ish proxy: how many drafts (inactive with productCode set + supplier sourceUrl) are still unrewritten
  const [draftRows] = await conn.execute(
    `SELECT COUNT(*) AS draftsAwaitingRewrite
     FROM tours
     WHERE status = 'inactive'
       AND sourceUrl LIKE '%NormGroupID%'
       AND createdAt > NOW() - INTERVAL 7 DAY`
  );
  console.log("\n=== Lion draft backlog (Lion-style sourceUrl, last 7d) ===");
  console.table(draftRows);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
