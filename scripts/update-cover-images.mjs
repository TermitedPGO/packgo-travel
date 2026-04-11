import { createConnection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const db = await createConnection(process.env.DATABASE_URL);

const updates = [
  {
    id: 1890006,
    coverImage: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/switzerland-lucerne-cover_4a6b09a8.jpg',
    name: '德瑞經典10日'
  },
  {
    id: 1890011,
    coverImage: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/italy-rome-colosseum-cover_c757992b.jpg',
    name: '義大利10日'
  }
];

for (const update of updates) {
  const [result] = await db.execute(
    'UPDATE tours SET coverImage = ? WHERE id = ?',
    [update.coverImage, update.id]
  );
  console.log(`✅ Updated ${update.name} (ID: ${update.id}): ${result.affectedRows} row(s) affected`);
}

// Verify
const [rows] = await db.execute(
  'SELECT id, title, coverImage FROM tours WHERE id IN (1890006, 1890011)'
);
console.log('\n=== Verification ===');
for (const row of rows) {
  console.log(`ID: ${row.id} | Title: ${row.title} | CoverImage: ${row.coverImage ? '✅ SET' : '❌ EMPTY'}`);
  console.log(`  URL: ${row.coverImage}`);
}

await db.end();
