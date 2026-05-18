// Reset Gmail integration error/processed counters for clean diagnostic baseline
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });

const [before] = await c.execute(
  `SELECT id, emailAddress, messagesProcessed, messagesFailed FROM gmailIntegration`
);
console.log("=== Before ===");
console.table(before);

await c.execute(
  `UPDATE gmailIntegration SET messagesProcessed = 0, messagesFailed = 0`
);

const [after] = await c.execute(
  `SELECT id, emailAddress, messagesProcessed, messagesFailed FROM gmailIntegration`
);
console.log("\n=== After ===");
console.table(after);

await c.end();
console.log("\n✅ Counters reset. Next 10-min tick will show clean baseline.");
