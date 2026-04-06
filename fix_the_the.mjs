import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Fix "the The" -> "The" in translations table
const [rows] = await conn.execute(
  `SELECT id, entityType, entityId, fieldName, targetLanguage, translatedText 
   FROM translations 
   WHERE translatedText LIKE '% the The %' OR translatedText LIKE '% the The%' OR translatedText LIKE '%the The %'`
);

console.log(`Found ${rows.length} rows with "the The" issue`);

let fixed = 0;
for (const row of rows) {
  const newContent = row.translatedText.replace(/ the The /g, ' The ').replace(/ the The/g, ' The').replace(/the The /g, 'The ');
  if (newContent !== row.translatedText) {
    await conn.execute('UPDATE translations SET translatedText = ? WHERE id = ?', [newContent, row.id]);
    console.log(`Fixed [${row.entityType}#${row.entityId}] ${row.fieldName} (${row.targetLanguage}): "${row.translatedText.substring(0, 80)}" -> "${newContent.substring(0, 80)}"`);
    fixed++;
  }
}

// Also fix in tours table if there are English title fields
const [tourRows] = await conn.execute(
  `SELECT id, title FROM tours WHERE title LIKE '% the The %' OR title LIKE '% the The%'`
);
for (const row of tourRows) {
  const newTitle = row.title.replace(/ the The /g, ' The ').replace(/ the The/g, ' The');
  await conn.execute('UPDATE tours SET title = ? WHERE id = ?', [newTitle, row.id]);
  console.log(`Fixed tour#${row.id} title: "${row.title}" -> "${newTitle}"`);
  fixed++;
}

console.log(`\nTotal fixed: ${fixed}`);
await conn.end();
