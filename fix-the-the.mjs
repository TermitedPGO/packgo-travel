import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Find all translations with "the The"
const [rows] = await conn.query(
  'SELECT id, entityId, fieldName, translatedText FROM translations WHERE translatedText LIKE "%the The%"'
);

console.log(`Found ${rows.length} translations with "the The"`);

for (const row of rows) {
  const fixed = row.translatedText.replace(/\bthe The\b/g, 'The');
  console.log(`\nFixing id=${row.id}, entityId=${row.entityId}, field=${row.fieldName}`);
  // Show context
  const idx = row.translatedText.indexOf('the The');
  console.log('  Context:', row.translatedText.substring(Math.max(0, idx-30), idx+50));
  console.log('  Fixed:  ', fixed.substring(Math.max(0, idx-30), idx+50));
  
  await conn.query('UPDATE translations SET translatedText = ? WHERE id = ?', [fixed, row.id]);
  console.log('  ✅ Updated');
}

// Also check title translations
const [titleRows] = await conn.query(
  'SELECT id, entityId, fieldName, translatedText FROM translations WHERE fieldName = "title" AND targetLanguage = "en" LIMIT 20'
);
console.log('\n--- English title translations ---');
titleRows.forEach(r => console.log(` Tour ${r.entityId}: ${r.translatedText.substring(0, 80)}`));

await conn.end();
console.log('\nDone!');
