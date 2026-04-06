import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [tours] = await conn.query('SELECT id, title FROM tours WHERE status = "active" ORDER BY id');
const [translated] = await conn.query('SELECT DISTINCT entityId FROM translations WHERE entityType = "tour" AND targetLanguage = "en" AND fieldName = "title"');

const translatedIds = new Set(translated.map(r => r.entityId));
const missing = tours.filter(t => !translatedIds.has(t.id));

console.log('Active tours missing English title:');
missing.forEach(t => console.log(' -', t.id, t.title.substring(0, 60)));
console.log('Total missing:', missing.length, '/ Total active:', tours.length);

// Check keyFeatures translations
const [kfTranslated] = await conn.query('SELECT DISTINCT entityId FROM translations WHERE entityType = "tour" AND targetLanguage = "en" AND fieldName = "keyFeatures"');
const kfIds = new Set(kfTranslated.map(r => r.entityId));
const missingKf = tours.filter(t => !kfIds.has(t.id));
console.log('\nMissing keyFeatures EN translation:', missingKf.length, '/ Total active:', tours.length);

await conn.end();
