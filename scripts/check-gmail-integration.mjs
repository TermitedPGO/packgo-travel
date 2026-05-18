// Check Gmail integration status
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

const [rows] = await c.execute(
  `SELECT id, emailAddress, isActive, lastPollAt, messagesProcessed, messagesFailed, disconnectReason
   FROM gmailIntegration
   ORDER BY createdAt DESC`
);

if (rows.length === 0) {
  console.log("❌ No Gmail integration row — Jeff needs to connect Gmail via OAuth");
} else {
  console.log(`Found ${rows.length} Gmail integration(s):`);
  for (const r of rows) {
    console.log(`  • ${r.emailAddress}`);
    console.log(`    isActive: ${r.isActive ? "✓" : "✗"}`);
    console.log(`    lastPollAt: ${r.lastPollAt ?? "(never)"}`);
    console.log(`    messages: processed=${r.messagesProcessed} failed=${r.messagesFailed}`);
    if (r.disconnectReason) console.log(`    disconnectReason: ${r.disconnectReason}`);
  }
}

await c.end();
