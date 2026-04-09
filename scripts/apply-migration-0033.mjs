import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("Applying migration 0033...");

try {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`calibrationResults\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`tourId\` int NOT NULL,
      \`contentFidelityScore\` int NOT NULL,
      \`translationScore\` int NOT NULL,
      \`imageScore\` int NOT NULL,
      \`completenessScore\` int NOT NULL,
      \`marketingScore\` int NOT NULL,
      \`totalScore\` int NOT NULL,
      \`verdict\` enum('approved','review','rejected') NOT NULL,
      \`issues\` text,
      \`autoFixesApplied\` text,
      \`sourceSnapshot\` text,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`calibrationResults_id\` PRIMARY KEY(\`id\`)
    )
  `);
  console.log("✓ calibrationResults table created");
} catch (e) {
  if (e.code === "ER_TABLE_EXISTS_ERROR") {
    console.log("calibrationResults table already exists, skipping");
  } else {
    throw e;
  }
}

try {
  await conn.execute(`
    ALTER TABLE \`tours\` MODIFY COLUMN \`status\` enum('active','inactive','soldout','draft','pending_review') NOT NULL DEFAULT 'draft'
  `);
  console.log("✓ tours.status enum extended");
} catch (e) {
  console.warn("tours.status alter:", e.message);
}

await conn.end();
console.log("Migration 0033 applied successfully!");
