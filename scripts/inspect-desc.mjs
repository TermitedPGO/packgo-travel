// Dump the actual 42-char description of mistagged tours
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, title, destinationCountry, calibrationScore,
          description,
          LENGTH(description) AS descLen,
          poeticTitle,
          poeticSubtitle
   FROM tours
   WHERE id IN (1170194, 1170197, 1170217, 1170220, 1170225, 1170242, 1170154, 1170166, 1170211, 1170212, 1170176, 1170193)`
);
for (const r of rows) {
  console.log("─".repeat(60));
  console.log(`tour #${r.id} [${r.destinationCountry}] cal=${r.calibrationScore} descLen=${r.descLen}`);
  console.log(`  title:        ${r.title?.slice(0,60)}`);
  console.log(`  poeticTitle:  ${r.poeticTitle?.slice(0,60) ?? "(null)"}`);
  console.log(`  description:  ${JSON.stringify(r.description)}`);
}
await conn.end();
