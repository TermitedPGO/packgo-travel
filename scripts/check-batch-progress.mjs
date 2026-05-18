// Quick check on the 200-tour batch progress
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

const [statusRows] = await c.execute(
  `SELECT status, COUNT(*) AS n FROM tours GROUP BY status ORDER BY n DESC`
);
console.log("=== Current tour status ===");
console.table(statusRows);

const [recentRows] = await c.execute(
  `SELECT id, status, calibrationScore, calibrationVerdict,
          destinationCountry, destinationCity,
          LEFT(title, 50) AS title
   FROM tours
   WHERE createdAt > NOW() - INTERVAL 2 HOUR
   ORDER BY id DESC
   LIMIT 15`
);
console.log("\n=== Recently created tours (last 2h) ===");
for (const r of recentRows) {
  console.log(`  #${r.id} ${r.status} cal=${r.calibrationScore ?? "(none)"} ${r.calibrationVerdict ?? "(none)"} ${r.destinationCountry ?? "-"}/${r.destinationCity ?? "-"} | ${r.title}`);
}

const [recentMessagesRows] = await c.execute(
  `SELECT agentName, messageType, LEFT(title, 60) AS title, createdAt
   FROM agentMessages
   WHERE agentName = 'catalog'
     AND createdAt > NOW() - INTERVAL 1 HOUR
   ORDER BY createdAt DESC
   LIMIT 10`
);
console.log("\n=== Recent #catalog channel messages ===");
for (const r of recentMessagesRows) {
  console.log(`  ${r.createdAt} ${r.messageType}: ${r.title}`);
}

await c.end();
