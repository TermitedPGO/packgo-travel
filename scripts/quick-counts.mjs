import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Count: drafts (originals) vs new PACK&GO tours
const [drafts] = await conn.execute(
  `SELECT
     CASE WHEN calibrationScore IS NULL THEN 'source_draft' ELSE 'pack&go_new' END AS type,
     status,
     COUNT(*) AS n
   FROM tours
   GROUP BY type, status
   ORDER BY type, status`
);
console.log("=== Drafts vs new tours ===");
console.table(drafts);

const [allStatus] = await conn.execute(
  `SELECT status, COUNT(*) AS n FROM tours GROUP BY status ORDER BY n DESC`
);
console.log("\n=== Overall status ===");
console.table(allStatus);

await conn.end();
