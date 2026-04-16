// Round 59 cleanup script: delete duplicate/damaged tours and fix destination fields
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

// Step 1: Query all tours
const [rows] = await conn.execute(
  'SELECT id, title, destinationCountry, destinationCity, price, status, sourceUrl, createdAt FROM tours ORDER BY createdAt ASC'
);

console.log(`\n=== Total tours: ${rows.length} ===\n`);
rows.forEach(r => {
  console.log(`[${r.id}] ${r.title?.substring(0, 50)} | ${r.destinationCountry} | ${r.destinationCity} | NT$${r.price} | ${r.status}`);
});

// Step 2: Identify tours to DELETE
// Rules:
// - Delete: damaged Haiku tour (price ~1905249 or destination_city = '雄獅旅遊')
// - Delete: 74-score "五日輕奢假期" with empty destination (()-) 
// - Delete: duplicates - keep earliest created_at for same title+price
// - Delete: extra copies of same NormGroupID

const toDelete = [];
const toKeep = [];
const seenTitlePrice = new Map();

for (const row of rows) {
  const key = `${row.title?.trim()}|${row.price}`;
  
  // Always delete: damaged Haiku tour
  if (row.destinationCity === '雄獅旅遊' || row.price > 1000000) {
    toDelete.push({ id: row.id, reason: 'Haiku damaged data (wrong price/destination)' });
    continue;
  }
  
  // Always delete: empty destination 74-score tours
  if (row.destinationCountry === '()-' || row.destinationCountry === null || row.destinationCountry === '') {
    toDelete.push({ id: row.id, reason: 'Empty destination (()-) — test/damaged data' });
    continue;
  }
  
  // Deduplicate: keep first occurrence (earliest created_at)
  if (seenTitlePrice.has(key)) {
    toDelete.push({ id: row.id, reason: `Duplicate of earlier tour (same title+price)` });
    continue;
  }
  
  seenTitlePrice.set(key, row.id);
  toKeep.push(row);
}

console.log(`\n=== Tours to DELETE (${toDelete.length}): ===`);
toDelete.forEach(t => console.log(`  DELETE id=${t.id}: ${t.reason}`));

console.log(`\n=== Tours to KEEP (${toKeep.length}): ===`);
toKeep.forEach(r => console.log(`  KEEP id=${r.id}: ${r.title?.substring(0, 50)} | ${r.destinationCountry} · ${r.destinationCity}`));

// Step 3: Execute deletions
if (toDelete.length > 0) {
  const ids = toDelete.map(t => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await conn.execute(`DELETE FROM tours WHERE id IN (${placeholders})`, ids);
  console.log(`\n✅ Deleted ${result.affectedRows} tours`);
}

// Step 4: Fix destination fields
const fixes = [
  // Osaka tours
  {
    titleKeyword: '快閃關西三日遊',
    destinationCountry: '日本',
    destinationCity: '大阪',
  },
  {
    titleKeyword: '關西快閃雅奢三日',
    destinationCountry: '日本',
    destinationCity: '大阪',
  },
  // Cambodia
  {
    titleKeyword: '吳哥窟金邊雙城',
    destinationCountry: '柬埔寨',
    destinationCity: '暹粒',
  },
  // Austria/Czech
  {
    titleKeyword: '奧捷經典十日',
    destinationCountry: '奧地利',
    destinationCity: '維也納',
  },
];

console.log('\n=== Fixing destination fields ===');
for (const fix of fixes) {
  const [result] = await conn.execute(
    `UPDATE tours SET destinationCountry = ?, destinationCity = ? WHERE title LIKE ?`,
    [fix.destinationCountry, fix.destinationCity, `%${fix.titleKeyword}%`]
  );
  console.log(`  Fixed "${fix.titleKeyword}": ${result.affectedRows} row(s) → ${fix.destinationCountry} · ${fix.destinationCity}`);
}

// Step 5: Final count
const [finalRows] = await conn.execute('SELECT COUNT(*) as cnt FROM tours');
console.log(`\n✅ Final tour count: ${finalRows[0].cnt}`);

await conn.end();
console.log('\n=== Cleanup complete ===');
