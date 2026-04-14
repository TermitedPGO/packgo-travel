import 'dotenv/config';
import mysql2 from 'mysql2/promise';

const conn = await mysql2.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(`
  SELECT t.id, t.title, t.price, t.nights, t.sourceUrl,
         cr.totalScore, cr.verdict,
         cr.contentFidelityScore, cr.translationScore, cr.imageScore,
         cr.completenessScore, cr.marketingScore
  FROM tours t
  LEFT JOIN calibrationResults cr ON cr.tourId = t.id
  WHERE t.id >= 2070051
  ORDER BY t.id DESC
`);
rows.forEach(r => {
  console.log(`ID:${r.id} | QA:${r.totalScore} | Verdict:${r.verdict} | Price:${r.price} | Days:${r.nights} | CF:${r.contentFidelityScore} | TR:${r.translationScore} | IQ:${r.imageScore} | CO:${r.completenessScore} | MK:${r.marketingScore}`);
  console.log(`  Title: ${r.title?.substring(0,60)}`);
  console.log(`  URL: ${r.sourceUrl?.substring(0,80)}`);
});
await conn.end();
