import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Find 南美 related tours
const [rows] = await conn.execute(
  `SELECT id, title, price, duration, destinationCountry, status, calibrationScore, sourceUrl 
   FROM tours 
   WHERE title LIKE '%南美%' OR title LIKE '%秘魯%' OR title LIKE '%馬丘比丘%' OR destinationCountry LIKE '%秘魯%'
   ORDER BY id DESC LIMIT 10`
);

console.log('南美 related tours:');
for (const row of rows) {
  console.log(`  ID=${row.id}, title="${row.title}", price=${row.price}, duration=${row.duration}, country=${row.destinationCountry}, status=${row.status}, qaScore=${row.calibrationScore}`);
  if (row.sourceUrl) console.log(`    sourceUrl: ${row.sourceUrl}`);
}

await conn.end();
