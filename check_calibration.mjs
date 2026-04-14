import * as dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get calibration result for tour 2070051 (new one with 95 score)
const [rows] = await conn.execute(
  'SELECT * FROM calibrationResults WHERE tourId = ? ORDER BY id DESC LIMIT 1',
  [2070051]
);

if (rows.length > 0) {
  const r = rows[0];
  console.log('=== Calibration Result for Tour 2070051 ===');
  console.log('qaScore:', r.qa_score);
  console.log('contentFidelity:', r.content_fidelity_score);
  console.log('translationQuality:', r.translation_quality_score);
  console.log('imageQuality:', r.image_quality_score);
  console.log('completeness:', r.completeness_score);
  console.log('flightAccuracy:', r.flight_accuracy_score);
  
  // Parse issues
  try {
    const issues = JSON.parse(r.issues || '[]');
    console.log('\nIssues:', JSON.stringify(issues, null, 2));
  } catch(e) {
    console.log('Issues raw:', r.issues?.substring(0, 500));
  }
  
  // Parse full result
  try {
    const full = JSON.parse(r.full_result || '{}');
    console.log('\nFull result keys:', Object.keys(full));
    if (full.contentFidelity) {
      console.log('\nContent Fidelity details:', JSON.stringify(full.contentFidelity, null, 2));
    }
  } catch(e) {
    console.log('Full result parse error:', e.message);
  }
} else {
  console.log('No calibration result found for tour 2070051');
}

await conn.end();
