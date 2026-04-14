import * as dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(
  "SELECT id, title, sourceUrl, price, nights, calibrationScore FROM tours WHERE sourceUrl LIKE '%liontravel%' ORDER BY id DESC LIMIT 30"
);
console.log('=== Liontravel Tours ===');
rows.forEach(r => {
  console.log(`ID:${r.id} | QA:${r.calibrationScore} | Price:${r.price} | Days:${r.nights} | ${r.title?.slice(0,30)}`);
  console.log(`  URL: ${r.sourceUrl}`);
});
await conn.end();
