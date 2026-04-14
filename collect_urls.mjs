import * as dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all unique liontravel URLs from active/pending tours
const [rows] = await conn.execute(`
  SELECT DISTINCT sourceUrl, 
    MAX(id) as latestId,
    MAX(calibrationScore) as bestQaScore,
    MAX(price) as latestPrice,
    MAX(duration) as duration,
    MAX(title) as title,
    MAX(status) as status
  FROM tours 
  WHERE sourceUrl LIKE '%liontravel%'
    AND sourceUrl IS NOT NULL
    AND sourceUrl != ''
  GROUP BY sourceUrl
  ORDER BY latestId DESC
  LIMIT 20
`);

console.log(`Found ${rows.length} unique liontravel URLs:\n`);
rows.forEach((r, i) => {
  console.log(`${i+1}. [ID:${r.latestId}] ${r.title?.substring(0, 40)}...`);
  console.log(`   URL: ${r.sourceUrl}`);
  console.log(`   QA: ${r.bestQaScore} | Price: ${r.latestPrice?.toLocaleString()} | Duration: ${r.duration}天 | Status: ${r.status}`);
  console.log('');
});

// Also get non-liontravel tours for regression test
const [nonLion] = await conn.execute(`
  SELECT DISTINCT sourceUrl, MAX(id) as latestId, MAX(title) as title, MAX(calibrationScore) as qaScore, MAX(status) as status
  FROM tours 
  WHERE (sourceUrl NOT LIKE '%liontravel%' OR sourceUrl IS NULL)
    AND sourceUrl IS NOT NULL
    AND sourceUrl != ''
    AND status IN ('active', 'pending_review')
  GROUP BY sourceUrl
  ORDER BY latestId DESC
  LIMIT 5
`);

console.log(`\nNon-liontravel URLs for regression test:`);
nonLion.forEach((r, i) => {
  console.log(`${i+1}. [ID:${r.latestId}] ${r.title?.substring(0, 40)}`);
  console.log(`   URL: ${r.sourceUrl}`);
  console.log(`   QA: ${r.qaScore} | Status: ${r.status}`);
});

await conn.end();
