// Deep inspect a single mistagged tour to find why destinationCountry is wrong
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const ids = process.argv.slice(2).filter((s) => /^\d+$/.test(s));
if (!ids.length) {
  console.error("usage: node inspect-one-tour.mjs <tourId> [<tourId>...]");
  process.exit(1);
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const placeholders = ids.map(() => "?").join(",");
const [rows] = await conn.execute(
  `SELECT id, title, status, destinationCountry, destinationCity, departureCity,
          calibrationScore, sourceUrl, productCode,
          LENGTH(description) AS descLen,
          createdAt
   FROM tours
   WHERE id IN (${placeholders})`,
  ids
);

for (const r of rows) {
  console.log("─".repeat(60));
  console.log(`tour #${r.id}  [${r.status}]  cal=${r.calibrationScore}`);
  console.log(`  title: ${r.title}`);
  console.log(`  dest:  ${r.destinationCountry} / ${r.destinationCity}`);
  console.log(`  dep:   ${r.departureCity}`);
  console.log(`  url:   ${r.sourceUrl}`);
  console.log(`  prov:  ${r.sourceProvider}`);
  console.log(`  prod:  ${r.productCode}`);
  console.log(`  desc:  ${r.descLen} chars`);
  console.log(`  ts:    ${r.createdAt}`);
}

await conn.end();
